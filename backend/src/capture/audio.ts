import { execFile, spawn, type ChildProcess } from "child_process";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { AUDIO_CHUNK_SEC, AUDIO_DIR, AUDIO_ENABLED } from "../config.js";
import { insertAudioTranscription } from "../db/index.js";
import {
  closeMeeting,
  closeOrphanOpenMeetings,
  createMeeting,
} from "../db/meetings.js";
import { transcribeChunk as transcribeChunkAudio } from "./stt.js";
import { resolvePackagedExecutable } from "./executable-path.js";
import { ensureMacSystemAudioBinary } from "./system-audio-macos.js";
import type { AudioDeviceInfo } from "../types.js";

const execFileAsync = promisify(execFile);
const FFMPEG = resolvePackagedExecutable(ffmpegInstaller.path);

class AudioRecorder {
  private recording = false;
  private loopRunning = false;
  private currentProcesses = new Set<ChildProcess>();
  private inputDevice: string | null = null;
  private outputMonitorDevice: string | null = null;
  private chunkIndex = 0;
  private currentMeetingId: number | null = null;

  isRecording(): boolean {
    return this.recording;
  }

  async start(): Promise<void> {
    if (!AUDIO_ENABLED || this.recording) return;

    if (process.platform === "darwin") {
      // Compile/resolve before the meeting clock starts so the first chunk does
      // not silently lose audio while the native helper is being prepared.
      await ensureMacSystemAudioBinary();
    }
    this.inputDevice = await resolveInputDevice();
    this.outputMonitorDevice =
      process.platform === "linux" ? await resolveLinuxMonitorDevice() : null;
    this.recording = true;
    this.chunkIndex = 0;
    closeOrphanOpenMeetings();
    this.currentMeetingId = createMeeting(new Date().toISOString());
    console.log(
      `[audio] recording started (microphone: ${this.inputDevice ?? "default"}, system: ${this.outputMonitorDevice ?? (process.platform === "darwin" ? "ScreenCaptureKit" : "unavailable")}, chunk ${AUDIO_CHUNK_SEC}s)`
    );

    if (!this.loopRunning) {
      this.loopRunning = true;
      void this.recordLoop();
    }
  }

  stop(): void {
    this.recording = false;
    for (const process of this.currentProcesses) {
      process.kill("SIGTERM");
    }
    this.currentProcesses.clear();
    if (this.currentMeetingId !== null) {
      closeMeeting(this.currentMeetingId, new Date().toISOString());
      this.currentMeetingId = null;
    }
    console.log("[audio] recording stopped");
  }

  private async recordLoop(): Promise<void> {
    while (this.recording) {
      try {
        await this.recordOneChunk();
      } catch (err) {
        console.error("[audio] chunk error:", err);
        await sleep(2000);
      }
    }
    this.loopRunning = false;
  }

  private async recordOneChunk(): Promise<void> {
    if (!this.recording) return;

    const filename = `audio_${Date.now()}_c${this.chunkIndex++}.wav`;
    const filePath = path.join(AUDIO_DIR, filename);
    // Capture before recording: transcription may finish after stop()
    const meetingId = this.currentMeetingId;
    let systemAudioIncluded = false;
    if (process.platform === "darwin") {
      systemAudioIncluded = await this.recordMacMixedChunk(filePath);
    } else if (process.platform === "linux" && this.outputMonitorDevice) {
      systemAudioIncluded = await this.recordLinuxMixedChunk(
        filePath,
        this.outputMonitorDevice
      );
    } else {
      await this.runProcess(
        FFMPEG,
        buildRecordArgs(this.inputDevice, filePath, AUDIO_CHUNK_SEC),
        "microphone"
      );
    }

    if (!this.recording || !fs.existsSync(filePath)) return;

    const stat = fs.statSync(filePath);
    if (stat.size < 1000) {
      fs.unlinkSync(filePath);
      return;
    }

    void this.transcribeChunk(
      filePath,
      filename,
      meetingId,
      systemAudioIncluded
        ? "microphone + system audio"
        : this.inputDevice ?? "default microphone"
    );
  }

  private async recordMacMixedChunk(outputPath: string): Promise<boolean> {
    const helper = await ensureMacSystemAudioBinary();
    if (!helper) {
      await this.runProcess(
        FFMPEG,
        buildRecordArgs(this.inputDevice, outputPath, AUDIO_CHUNK_SEC),
        "microphone"
      );
      return false;
    }

    const stem = outputPath.replace(/\.wav$/i, "");
    const micPath = `${stem}.mic.wav`;
    const systemPath = `${stem}.system.wav`;

    try {
      const [micOk, systemOk] = await Promise.all([
        this.runProcess(
          FFMPEG,
          buildRecordArgs(this.inputDevice, micPath, AUDIO_CHUNK_SEC),
          "microphone"
        ),
        this.runProcess(
          helper,
          [systemPath, String(AUDIO_CHUNK_SEC)],
          "system audio"
        ),
      ]);

      if (!this.recording) return false;
      return await this.combineCapturedAudio(
        outputPath,
        micPath,
        systemPath,
        micOk,
        systemOk
      );
    } finally {
      fs.rmSync(micPath, { force: true });
      fs.rmSync(systemPath, { force: true });
    }
  }

  private async recordLinuxMixedChunk(
    outputPath: string,
    monitorDevice: string
  ): Promise<boolean> {
    const stem = outputPath.replace(/\.wav$/i, "");
    const micPath = `${stem}.mic.wav`;
    const systemPath = `${stem}.system.wav`;

    try {
      const [micOk, systemOk] = await Promise.all([
        this.runProcess(
          FFMPEG,
          buildRecordArgs(this.inputDevice, micPath, AUDIO_CHUNK_SEC),
          "microphone"
        ),
        this.runProcess(
          FFMPEG,
          buildPulseRecordArgs(monitorDevice, systemPath, AUDIO_CHUNK_SEC, 2, 48_000),
          "system audio"
        ),
      ]);

      if (!this.recording) return false;
      return await this.combineCapturedAudio(
        outputPath,
        micPath,
        systemPath,
        micOk,
        systemOk
      );
    } finally {
      fs.rmSync(micPath, { force: true });
      fs.rmSync(systemPath, { force: true });
    }
  }

  private async combineCapturedAudio(
    outputPath: string,
    micPath: string,
    systemPath: string,
    micOk: boolean,
    systemOk: boolean
  ): Promise<boolean> {
    const hasMic = micOk && isUsableAudioFile(micPath);
    const hasSystem = systemOk && isUsableAudioFile(systemPath);

    if (hasMic && hasSystem) {
      const mixed = await this.runProcess(
        FFMPEG,
        [
          "-i",
          micPath,
          "-i",
          systemPath,
          "-filter_complex",
          "[0:a][1:a]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95[a]",
          "-map",
          "[a]",
          "-ac",
          "1",
          "-ar",
          "16000",
          "-y",
          outputPath,
        ],
        "audio mixer"
      );
      if (mixed && isUsableAudioFile(outputPath)) return true;
    }

    if (hasSystem && !hasMic) {
      const converted = await this.runProcess(
        FFMPEG,
        ["-i", systemPath, "-vn", "-ac", "1", "-ar", "16000", "-y", outputPath],
        "system audio converter"
      );
      return converted && isUsableAudioFile(outputPath);
    }

    if (hasMic) {
      fs.renameSync(micPath, outputPath);
    }
    return false;
  }

  private runProcess(
    command: string,
    args: string[],
    label: string
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
      this.currentProcesses.add(proc);
      let stderr = "";
      let settled = false;

      proc.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      proc.on("error", (err) => {
        if (settled) return;
        settled = true;
        this.currentProcesses.delete(proc);
        console.warn(`[audio] ${label} failed: ${err.message}`);
        resolve(false);
      });
      proc.on("close", (code) => {
        if (settled) return;
        settled = true;
        this.currentProcesses.delete(proc);
        if (code !== 0) {
          console.warn(
            `[audio] ${label} exited ${code ?? "by signal"}: ${stderr.slice(-500)}`
          );
        }
        resolve(code === 0);
      });
    });
  }

  private async transcribeChunk(
    filePath: string,
    filename: string,
    meetingId: number | null,
    deviceName: string
  ): Promise<void> {
    try {
      const text = await transcribeChunkAudio(filePath);
      const cleaned = text.trim();
      // Gemini sometimes answers "No speech detected." instead of an empty
      // string; also skip punctuation-only results.
      if (
        !cleaned ||
        /^no speech( was)? detected\.?$/i.test(cleaned) ||
        !/[\p{L}\p{N}]/u.test(cleaned)
      ) {
        console.log(`[audio] chunk ${filename}: no speech detected`);
        return;
      }

      insertAudioTranscription({
        timestamp: new Date().toISOString(),
        transcription: cleaned,
        filePath,
        deviceName,
        durationSecs: AUDIO_CHUNK_SEC,
        meetingId,
      });

      console.log(`[audio] transcribed chunk ${filename} (${text.length} chars)`);
    } catch (err) {
      console.error(`[audio] transcription failed for ${filename}:`, err);
    }
  }
}

function isUsableAudioFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).size >= 1000;
  } catch {
    return false;
  }
}

const audioRecorder = new AudioRecorder();

export function isAudioRecording(): boolean {
  return audioRecorder.isRecording();
}

export async function startAudioRecording(): Promise<void> {
  await audioRecorder.start();
}

export function stopAudioRecording(): void {
  audioRecorder.stop();
}

export async function listAudioDevices(): Promise<AudioDeviceInfo[]> {
  if (!AUDIO_ENABLED) return [];

  if (process.platform === "win32") {
    try {
      const devices = await listDshowAudioDevices();
      if (devices.length > 0) {
        return devices.map((name, i) => ({
          name,
          device_type: i % 2 === 0 ? "input" : "output",
          is_default: i === 0,
        })) as AudioDeviceInfo[];
      }
    } catch {
      /* fall through */
    }

    try {
      const ps = `
Get-CimInstance Win32_SoundDevice | Select-Object Name, Status | ConvertTo-Json -Compress
`.trim();
      const { stdout } = await execFileAsync("powershell", [
        "-NoProfile",
        "-Command",
        ps,
      ]);
      const parsed = JSON.parse(stdout.trim());
      const devices = Array.isArray(parsed) ? parsed : [parsed];
      return devices.map((d: { Name: string }, i: number) => ({
        name: d.Name || `audio device ${i + 1}`,
        device_type: i % 2 === 0 ? "input" : "output",
        is_default: i === 0,
      })) as AudioDeviceInfo[];
    } catch {
      return [
        { name: "default microphone", device_type: "input", is_default: true },
        { name: "default speakers", device_type: "output", is_default: true },
      ];
    }
  }

  return [
    { name: "default microphone", device_type: "input", is_default: true },
    { name: "default speakers", device_type: "output", is_default: true },
  ];
}

async function listDshowAudioDevices(): Promise<string[]> {
  return new Promise((resolve) => {
    const proc = spawn(FFMPEG, ["-list_devices", "true", "-f", "dshow", "-i", "dummy"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    proc.on("close", () => {
      const devices: string[] = [];
      const lines = output.split("\n");
      let inAudio = false;
      for (const line of lines) {
        if (line.includes("DirectShow audio devices")) inAudio = true;
        else if (line.includes("DirectShow video devices")) inAudio = false;
        else if (inAudio) {
          const match = line.match(/"([^"]+)"/);
          if (match) devices.push(match[1]);
        }
      }
      resolve(devices);
    });
    proc.on("error", () => resolve([]));
  });
}

async function resolveInputDevice(): Promise<string | null> {
  if (process.platform === "win32") {
    const devices = await listDshowAudioDevices();
    const mic = devices.find(
      (d) =>
        /microphone|mic|input|array|headset/i.test(d) &&
        !/speaker|output|loopback/i.test(d)
    );
    return mic ?? devices[0] ?? null;
  }
  if (process.platform === "darwin") return ":0";
  return "default";
}

async function resolveLinuxMonitorDevice(): Promise<string | null> {
  if (process.platform !== "linux") return null;

  try {
    let defaultSink = "";
    try {
      const { stdout } = await execFileAsync("pactl", ["get-default-sink"], {
        timeout: 5000,
      });
      defaultSink = stdout.trim();
    } catch {
      const { stdout } = await execFileAsync("pactl", ["info"], {
        timeout: 5000,
      });
      defaultSink =
        stdout.match(/^Default Sink:\s*(.+)$/m)?.[1]?.trim() ?? "";
    }

    const { stdout: sourcesOutput } = await execFileAsync(
      "pactl",
      ["list", "short", "sources"],
      { timeout: 5000 }
    );
    const sourceNames = sourcesOutput
      .split(/\r?\n/)
      .map((line) => line.split(/\s+/)[1])
      .filter((name): name is string => Boolean(name));

    const exactMonitor = defaultSink ? `${defaultSink}.monitor` : null;
    if (exactMonitor && sourceNames.includes(exactMonitor)) return exactMonitor;

    const matchingMonitor = defaultSink
      ? sourceNames.find(
          (name) => name.endsWith(".monitor") && name.includes(defaultSink)
        )
      : null;
    return matchingMonitor ?? sourceNames.find((name) => name.endsWith(".monitor")) ?? null;
  } catch (err) {
    console.warn(
      "[system-audio] could not inspect PulseAudio/PipeWire monitor sources; trying the default monitor:",
      err instanceof Error ? err.message : err
    );
    // PulseAudio and PipeWire's PulseAudio compatibility layer resolve this
    // symbolic source when supported. If not, the mic recording still wins.
    return "@DEFAULT_MONITOR@";
  }
}

function buildRecordArgs(
  device: string | null,
  outputPath: string,
  durationSec: number
): string[] {
  const common = ["-t", String(durationSec), "-ac", "1", "-ar", "16000", "-y", outputPath];

  if (process.platform === "win32") {
    const input = device ? `audio=${device}` : "audio=Microphone";
    return ["-f", "dshow", "-i", input, ...common];
  }
  if (process.platform === "darwin") {
    return ["-f", "avfoundation", "-i", device ?? ":0", ...common];
  }
  return ["-f", "pulse", "-i", device ?? "default", ...common];
}

function buildPulseRecordArgs(
  device: string,
  outputPath: string,
  durationSec: number,
  channels: 1 | 2,
  sampleRate: number
): string[] {
  return [
    "-f",
    "pulse",
    "-i",
    device,
    "-t",
    String(durationSec),
    "-ac",
    String(channels),
    "-ar",
    String(sampleRate),
    "-y",
    outputPath,
  ];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
