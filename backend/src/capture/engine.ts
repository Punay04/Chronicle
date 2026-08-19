import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { CAPTURE_INTERVAL_MS, TMP_DIR } from "../config.js";
import { insertFrame, insertOcrText } from "../db/index.js";
import type { EngineState } from "../types.js";
import { extractText, terminateOcr } from "./ocr.js";
import { captureAllMonitors } from "./screen.js";
import { cacheRecentFrame, videoChunkStore } from "./video.js";
import { getActiveWindow } from "./window.js";

interface OcrJob {
  frameId: number;
  buffer: Buffer;
}

/** Max pending OCR jobs before oldest are dropped (CPU safety valve). */
const OCR_QUEUE_MAX = 3;

export class CaptureEngine {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastHashes = new Map<string, string>();
  private capturing = false;
  private ocrQueue: OcrJob[] = [];
  private ocrBusy = false;
  private ocrDropped = 0;

  readonly state: EngineState = {
    running: false,
    paused: false,
    audioRecording: false,
    framesCaptured: 0,
    startedAt: null,
    lastError: null,
  };

  start(): void {
    if (this.state.running) return;
    this.state.running = true;
    this.state.paused = false;
    this.state.startedAt = Date.now();
    this.state.lastError = null;

    console.log(`[engine] started (interval ${CAPTURE_INTERVAL_MS}ms)`);
    this.timer = setInterval(() => {
      void this.tick();
    }, CAPTURE_INTERVAL_MS);

    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.state.running = false;
    this.state.paused = false;
    this.ocrQueue = [];
    void terminateOcr();
    void videoChunkStore.closeAll();
    console.log("[engine] stopped");
  }

  pause(): void {
    this.state.paused = true;
    console.log("[engine] paused");
  }

  resume(): void {
    this.state.paused = false;
    console.log("[engine] resumed");
  }

  private enqueueOcr(job: OcrJob): void {
    this.ocrQueue.push(job);
    while (this.ocrQueue.length > OCR_QUEUE_MAX) {
      this.ocrQueue.shift();
      this.ocrDropped += 1;
      console.warn(
        `[engine] ocr backlog full, dropped oldest job (total dropped: ${this.ocrDropped})`
      );
    }
    void this.drainOcrQueue();
  }

  private async drainOcrQueue(): Promise<void> {
    if (this.ocrBusy) return;
    this.ocrBusy = true;
    try {
      while (this.ocrQueue.length > 0) {
        const job = this.ocrQueue.shift()!;
        // Native OCR needs a file path; frames now live in video chunks,
        // so stage the buffer in a temp file for the duration of the job.
        const tmpPath = path.join(TMP_DIR, `ocr_${job.frameId}.jpg`);
        try {
          fs.mkdirSync(TMP_DIR, { recursive: true });
          fs.writeFileSync(tmpPath, job.buffer);
          const { text, confidence } = await extractText(tmpPath, job.buffer);
          if (text) insertOcrText(job.frameId, text, confidence);
        } catch (err) {
          console.error("[engine] ocr job failed:", err);
        } finally {
          fs.rmSync(tmpPath, { force: true });
        }
      }
    } finally {
      this.ocrBusy = false;
    }
  }

  private async tick(): Promise<void> {
    if (!this.state.running || this.state.paused || this.capturing) return;
    this.capturing = true;

    try {
      const activeWindow = await getActiveWindow();
      const captures = await captureAllMonitors();

      for (const { monitorId, buffer } of captures) {
        const hash = createHash("md5").update(buffer).digest("hex");
        const monitorKey = String(monitorId);
        const prev = this.lastHashes.get(monitorKey);
        if (prev === hash) continue;
        this.lastHashes.set(monitorKey, hash);

        const timestamp = new Date().toISOString();
        const { chunkId, offsetIndex } = await videoChunkStore.append(
          monitorId,
          buffer
        );
        const frameId = insertFrame({
          timestamp,
          appName: activeWindow?.app ?? null,
          windowName: activeWindow?.title ?? null,
          browserUrl: activeWindow?.browserUrl ?? null,
          monitorId: typeof monitorId === "number" ? monitorId : 0,
          imagePath: "",
          videoChunkId: chunkId,
          offsetIndex,
          focused: String(monitorId).includes("DISPLAY1") || monitorId === 0,
        });

        cacheRecentFrame(frameId, buffer);

        // OCR runs async off the tick path so capture cadence never blocks
        this.enqueueOcr({ frameId, buffer });

        this.state.framesCaptured += 1;
      }
    } catch (err) {
      this.state.lastError = err instanceof Error ? err.message : String(err);
      console.error("[engine] capture error:", err);
    } finally {
      this.capturing = false;
    }
  }
}

export const captureEngine = new CaptureEngine();
