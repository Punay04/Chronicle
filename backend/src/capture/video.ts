import { execFile, spawn, type ChildProcess } from "child_process";
import { promisify } from "util";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import fs from "fs";
import path from "path";
import { VIDEO_CHUNK_MAX_FRAMES, VIDEO_DIR, VIDEO_MAX_WIDTH } from "../config.js";
import { finalizeVideoChunk, insertVideoChunk } from "../db/index.js";
import { resolvePackagedExecutable } from "./executable-path.js";

const execFileAsync = promisify(execFile);
const FFMPEG = resolvePackagedExecutable(ffmpegInstaller.path);

interface OpenChunk {
  chunkId: number;
  proc: ChildProcess;
  frameCount: number;
  closed: Promise<void>;
}

/**
 * Appends JPEG frames into fragmented MP4 chunks (one stream per monitor).
 * Fragmented MP4 (frag_keyframe+empty_moov) stays readable while being
 * written and survives a crash mid-chunk.
 */
class VideoChunkStore {
  private chunks = new Map<string, OpenChunk>();
  private rotating: Promise<void>[] = [];

  private openChunk(monitorId: number | string): OpenChunk {
    fs.mkdirSync(VIDEO_DIR, { recursive: true });
    const safeId = String(monitorId).replace(/[^a-zA-Z0-9_-]/g, "_");
    const filePath = path.join(VIDEO_DIR, `chunk_${Date.now()}_m${safeId}.mp4`);
    const chunkId = insertVideoChunk({
      filePath,
      monitorId: typeof monitorId === "number" ? monitorId : 0,
      startedAt: new Date().toISOString(),
    });

    const proc = spawn(
      FFMPEG,
      [
        "-hide_banner", "-loglevel", "error",
        "-f", "image2pipe",
        "-c:v", "mjpeg",
        "-framerate", "0.5",
        "-i", "-",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "26",
        // zerolatency disables lookahead/frame-thread buffering so packets
        // reach the muxer immediately; GOP 10 bounds fragment-flush latency
        // and per-frame extraction cost. Without these, open chunks hold
        // 20+ frames in the encoder and stay unreadable.
        "-tune", "zerolatency",
        "-g", "10",
        "-vf", `scale='trunc(min(iw,${VIDEO_MAX_WIDTH})/2)*2':-2,format=yuv420p`,
        "-bf", "0",
        "-movflags", "frag_keyframe+empty_moov+default_base_moof",
        // Write moov/fragments to disk immediately instead of buffering,
        // so open chunks are readable by the timeline
        "-flush_packets", "1",
        "-y", filePath,
      ],
      { stdio: ["pipe", "ignore", "pipe"] }
    );

    let stderr = "";
    proc.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString();
    });

    const chunk: OpenChunk = {
      chunkId,
      proc,
      frameCount: 0,
      closed: new Promise<void>((resolve) => {
        proc.on("close", (code) => {
          if (code !== 0 && code !== null) {
            console.warn(`[video] ffmpeg exited ${code}: ${stderr.slice(-300)}`);
          }
          finalizeVideoChunk(chunkId, new Date().toISOString(), chunk.frameCount);
          resolve();
        });
        proc.on("error", (err) => {
          console.error("[video] ffmpeg spawn error:", err.message);
          resolve();
        });
      }),
    };
    return chunk;
  }

  /** Append a JPEG frame; returns its chunk id and offset within the chunk. */
  async append(
    monitorId: number | string,
    jpeg: Buffer
  ): Promise<{ chunkId: number; offsetIndex: number }> {
    const key = String(monitorId);
    let chunk = this.chunks.get(key);
    if (!chunk || chunk.proc.stdin?.destroyed) {
      chunk = this.openChunk(monitorId);
      this.chunks.set(key, chunk);
    }

    const offsetIndex = chunk.frameCount;
    const stdin = chunk.proc.stdin!;
    if (!stdin.write(jpeg)) {
      await new Promise<void>((resolve) => stdin.once("drain", resolve));
    }
    chunk.frameCount += 1;

    if (chunk.frameCount >= VIDEO_CHUNK_MAX_FRAMES) {
      this.chunks.delete(key);
      this.rotating.push(chunk.closed);
      stdin.end();
    }

    return { chunkId: chunk.chunkId, offsetIndex };
  }

  /** Finalize all open chunks (engine stop / shutdown). */
  async closeAll(): Promise<void> {
    const open = [...this.chunks.values()];
    this.chunks.clear();
    for (const chunk of open) {
      chunk.proc.stdin?.end();
    }
    const rotating = this.rotating;
    this.rotating = [];
    await Promise.all([...open.map((c) => c.closed), ...rotating]);
  }
}

export const videoChunkStore = new VideoChunkStore();

/**
 * In-memory cache of the newest frames. The encoder/muxer holds recent
 * frames until a fragment flushes, so the live timeline reads from here.
 */
// Must cover encoder lookahead (~10) + GOP (10) per monitor
const RECENT_FRAME_MAX = 48;
const recentFrames = new Map<number, Buffer>();

export function cacheRecentFrame(frameId: number, jpeg: Buffer): void {
  recentFrames.set(frameId, jpeg);
  while (recentFrames.size > RECENT_FRAME_MAX) {
    const oldest = recentFrames.keys().next().value as number;
    recentFrames.delete(oldest);
  }
}

export function getRecentFrame(frameId: number): Buffer | null {
  return recentFrames.get(frameId) ?? null;
}

/** Extract one frame (by append order) from a chunk as a JPEG buffer. */
export async function extractFrameJpeg(
  chunkPath: string,
  offsetIndex: number
): Promise<Buffer> {
  const { stdout } = await execFileAsync(
    FFMPEG,
    [
      "-hide_banner", "-loglevel", "error",
      "-i", chunkPath,
      "-vf", `select=eq(n\\,${offsetIndex})`,
      "-vsync", "0",
      "-frames:v", "1",
      "-f", "image2pipe",
      "-c:v", "mjpeg",
      "-q:v", "4",
      "-",
    ],
    { encoding: "buffer", timeout: 20_000, maxBuffer: 32 * 1024 * 1024 }
  );
  if (!stdout || stdout.length === 0) {
    throw new Error(`no frame at offset ${offsetIndex} in ${chunkPath}`);
  }
  return stdout as unknown as Buffer;
}
