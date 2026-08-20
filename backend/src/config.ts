import os from "os";
import path from "path";
import { loadRootEnv } from "./load-env.js";

loadRootEnv();

export const API_PORT = Number(process.env.CHRONICLE_PORT ?? 3030);
export const API_HOST = process.env.CHRONICLE_HOST ?? "127.0.0.1";

export const DATA_DIR =
  process.env.CHRONICLE_DATA_DIR ??
  path.join(os.homedir(), ".chronicle");

export const DB_PATH = path.join(DATA_DIR, "db.sqlite");
export const FRAMES_DIR = path.join(DATA_DIR, "frames");
export const AUDIO_DIR = path.join(DATA_DIR, "audio");
export const VIDEO_DIR = path.join(DATA_DIR, "video");
export const TMP_DIR = path.join(DATA_DIR, "tmp");

/** Frames per MP4 chunk before rotating to a new file */
export const VIDEO_CHUNK_MAX_FRAMES = Number(
  process.env.CHRONICLE_VIDEO_CHUNK_FRAMES ?? 150
);

/**
 * Stored video is downscaled to this width (never upscaled). OCR runs on the
 * full-resolution capture before encoding, so search quality is unaffected.
 */
export const VIDEO_MAX_WIDTH = Number(
  process.env.CHRONICLE_VIDEO_MAX_WIDTH ?? 1920
);

/** Capture interval in ms — event-driven lite via frame dedup */
export const CAPTURE_INTERVAL_MS = Number(
  process.env.CHRONICLE_CAPTURE_INTERVAL ?? 2000
);

export const OCR_ENABLED = process.env.CHRONICLE_OCR !== "0";

/** OCR engine override: "native" (platform default), "tesseract", or "off" */
export const OCR_ENGINE = (process.env.CHRONICLE_OCR_ENGINE ?? "native") as
  | "native"
  | "tesseract"
  | "off";
export const AUDIO_ENABLED = process.env.CHRONICLE_AUDIO !== "0";
export const AUTO_START_CAPTURE = process.env.CHRONICLE_AUTO_START !== "0";

/** Audio chunk length in seconds before transcription */
export const AUDIO_CHUNK_SEC = Number(
  process.env.CHRONICLE_AUDIO_CHUNK_SEC ?? 30
);

export const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "";
export const GEMINI_MODEL =
  process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

/**
 * Fallback models tried in order when the primary is overloaded.
 *
 * Free-tier capacity pressure returns 503 "high demand" per model, and which
 * model is saturated rotates minute to minute — pinning a single "better" one
 * does not help. Each entry is only tried after the previous one exhausts its
 * retries, so a healthy primary costs nothing.
 */
export const GEMINI_FALLBACK_MODELS = (
  process.env.GEMINI_FALLBACK_MODELS ??
  "gemini-3.6-flash,gemini-flash-latest,gemini-2.5-flash"
)
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

/**
 * Transcription model. Split from GEMINI_MODEL so meeting audio can be tuned
 * without changing the chat/summary model (and vice versa).
 */
export const GEMINI_STT_MODEL = process.env.GEMINI_STT_MODEL ?? GEMINI_MODEL;
/** Native-audio Live model — same as Snappy (`gemini-3.1-flash-live-preview`). */
export const GEMINI_LIVE_MODEL =
  process.env.GEMINI_LIVE_MODEL ?? "models/gemini-3.1-flash-live-preview";
/** Prebuilt Live voice (Snappy uses Aoede). */
export const GEMINI_LIVE_VOICE =
  process.env.GEMINI_LIVE_VOICE ?? "Aoede";

/** HydraDB graph-node HTTP query API */
export const HYDRADB_HTTP_URL =
  process.env.HYDRADB_HTTP_URL ?? "http://127.0.0.1:8443";

/** HydraDB admin/readiness endpoint */
export const HYDRADB_ADMIN_URL =
  process.env.HYDRADB_ADMIN_URL ?? "http://127.0.0.1:9090";

export const HYDRADB_AUTH_TOKEN = process.env.HYDRADB_AUTH_TOKEN ?? "";
export const HYDRADB_NAMESPACE = process.env.HYDRADB_NAMESPACE ?? "default";
export const HYDRADB_GRAPH_ID = process.env.HYDRADB_GRAPH_ID ?? "default";
export const HYDRADB_CELL_ID = process.env.HYDRADB_CELL_ID ?? "cell-0";
