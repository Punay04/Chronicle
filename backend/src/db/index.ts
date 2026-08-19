import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { AUDIO_DIR, DATA_DIR, DB_PATH, FRAMES_DIR } from "../config.js";
import { SCHEMA_SQL } from "./schema.js";
import type { ContentType, FrameRow, SearchResultItem } from "../types.js";

let db: DatabaseSync | null = null;

export function initDatabase(): DatabaseSync {
  if (db) return db;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
  fs.mkdirSync(AUDIO_DIR, { recursive: true });

  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA busy_timeout = 10000");

  // Migration: audio_transcriptions predating the meetings feature lacks meeting_id
  const audioCols = db
    .prepare(`PRAGMA table_info(audio_transcriptions)`)
    .all() as Array<{ name: string }>;
  if (audioCols.length > 0 && !audioCols.some((c) => c.name === "meeting_id")) {
    db.exec(`ALTER TABLE audio_transcriptions ADD COLUMN meeting_id INTEGER`);
  }

  // Migration: frames predating video-chunk storage lack the pointer columns
  const frameCols = db
    .prepare(`PRAGMA table_info(frames)`)
    .all() as Array<{ name: string }>;
  if (frameCols.length > 0 && !frameCols.some((c) => c.name === "video_chunk_id")) {
    db.exec(`ALTER TABLE frames ADD COLUMN video_chunk_id INTEGER`);
    db.exec(`ALTER TABLE frames ADD COLUMN offset_index INTEGER`);
  }

  db.exec(SCHEMA_SQL);
  return db;
}

export function getDb(): DatabaseSync {
  if (!db) return initDatabase();
  return db;
}

function lastInsertId(): number {
  const row = getDb()
    .prepare(`SELECT last_insert_rowid() as id`)
    .get() as { id: number };
  return row.id;
}

export function insertFrame(params: {
  timestamp: string;
  appName: string | null;
  windowName: string | null;
  browserUrl: string | null;
  monitorId: number;
  imagePath: string;
  focused: boolean;
  videoChunkId?: number | null;
  offsetIndex?: number | null;
}): number {
  getDb()
    .prepare(
      `INSERT INTO frames (timestamp, app_name, window_name, browser_url, monitor_id, image_path, focused, video_chunk_id, offset_index)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      params.timestamp,
      params.appName,
      params.windowName,
      params.browserUrl,
      params.monitorId,
      params.imagePath,
      params.focused ? 1 : 0,
      params.videoChunkId ?? null,
      params.offsetIndex ?? null
    );
  return lastInsertId();
}

export function insertVideoChunk(params: {
  filePath: string;
  monitorId: number;
  startedAt: string;
}): number {
  getDb()
    .prepare(
      `INSERT INTO video_chunks (file_path, monitor_id, started_at) VALUES (?, ?, ?)`
    )
    .run(params.filePath, params.monitorId, params.startedAt);
  return lastInsertId();
}

export function finalizeVideoChunk(
  id: number,
  endedAt: string,
  frameCount: number
): void {
  getDb()
    .prepare(`UPDATE video_chunks SET ended_at = ?, frame_count = ? WHERE id = ?`)
    .run(endedAt, frameCount, id);
}

export function getVideoChunkPath(id: number): string | null {
  const row = getDb()
    .prepare(`SELECT file_path FROM video_chunks WHERE id = ?`)
    .get(id) as { file_path: string } | undefined;
  return row?.file_path ?? null;
}

export function insertOcrText(
  frameId: number,
  text: string,
  confidence = 0
): void {
  getDb()
    .prepare(
      `INSERT INTO ocr_text (frame_id, text, text_length, confidence) VALUES (?, ?, ?, ?)`
    )
    .run(frameId, text, text.length, confidence);
  indexSearchContent({
    content: text,
    contentType: "ocr",
    frameId,
    timestamp: getFrameTimestamp(frameId),
    appName: getFrameAppName(frameId),
    windowName: getFrameWindowName(frameId),
  });

  void import("../memory/index.js")
    .then(({ ingestScreenCapture }) =>
      ingestScreenCapture({
        frameId,
        text,
        appName: getFrameAppName(frameId),
        windowName: getFrameWindowName(frameId),
        timestamp: getFrameTimestamp(frameId) ?? new Date().toISOString(),
      })
    )
    .catch(() => {});
}

export function insertAudioTranscription(params: {
  timestamp: string;
  transcription: string;
  filePath?: string;
  deviceName?: string;
  durationSecs?: number;
  meetingId?: number | null;
}): number {
  getDb()
    .prepare(
      `INSERT INTO audio_transcriptions (timestamp, transcription, file_path, device_name, duration_secs, meeting_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      params.timestamp,
      params.transcription,
      params.filePath ?? null,
      params.deviceName ?? null,
      params.durationSecs ?? null,
      params.meetingId ?? null
    );
  const audioId = lastInsertId();
  indexSearchContent({
    content: params.transcription,
    contentType: "audio",
    audioId,
    timestamp: params.timestamp,
    appName: null,
    windowName: null,
  });

  void import("../memory/index.js")
    .then(({ ingestAudioChunk }) =>
      ingestAudioChunk({
        audioId,
        transcription: params.transcription,
        meetingId: params.meetingId,
        timestamp: params.timestamp,
      })
    )
    .catch(() => {});

  return audioId;
}

function indexSearchContent(params: {
  content: string;
  contentType: string;
  frameId?: number;
  audioId?: number;
  timestamp: string | null;
  appName: string | null;
  windowName: string | null;
}): void {
  if (!params.content.trim()) return;
  getDb()
    .prepare(
      `INSERT INTO search_fts (content, content_type, frame_id, audio_id, timestamp, app_name, window_name)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      params.content,
      params.contentType,
      params.frameId ?? null,
      params.audioId ?? null,
      params.timestamp,
      params.appName,
      params.windowName
    );
}

function getFrameTimestamp(frameId: number): string | null {
  const row = getDb()
    .prepare(`SELECT timestamp FROM frames WHERE id = ?`)
    .get(frameId) as { timestamp: string } | undefined;
  return row?.timestamp ?? null;
}

function getFrameAppName(frameId: number): string | null {
  const row = getDb()
    .prepare(`SELECT app_name FROM frames WHERE id = ?`)
    .get(frameId) as { app_name: string | null } | undefined;
  return row?.app_name ?? null;
}

function getFrameWindowName(frameId: number): string | null {
  const row = getDb()
    .prepare(`SELECT window_name FROM frames WHERE id = ?`)
    .get(frameId) as { window_name: string | null } | undefined;
  return row?.window_name ?? null;
}

export function getFrameById(id: number): FrameRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM frames WHERE id = ?`)
    .get(id) as FrameRow | undefined;
  return row ?? null;
}

export function getFrameText(id: number): { ocr: string | null } {
  const ocr = getDb()
    .prepare(`SELECT text FROM ocr_text WHERE frame_id = ? ORDER BY id DESC LIMIT 1`)
    .get(id) as { text: string } | undefined;
  return { ocr: ocr?.text ?? null };
}

export function listFrames(params: {
  limit: number;
  offset: number;
  startTime?: string;
  endTime?: string;
}): { frames: FrameRow[]; total: number } {
  const conditions: string[] = [];
  const values: (string | number)[] = [];

  if (params.startTime) {
    conditions.push("timestamp >= ?");
    values.push(params.startTime);
  }
  if (params.endTime) {
    conditions.push("timestamp <= ?");
    values.push(params.endTime);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = (
    getDb().prepare(`SELECT COUNT(*) as count FROM frames ${where}`).get(...values) as {
      count: number;
    }
  ).count;

  const frames = getDb()
    .prepare(
      `SELECT * FROM frames ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
    )
    .all(...values, params.limit, params.offset) as FrameRow[];

  return { frames, total };
}

export function searchContent(params: {
  q?: string;
  limit: number;
  offset: number;
  contentType: ContentType;
  startTime?: string;
  endTime?: string;
  appName?: string;
  windowName?: string;
  minLength?: number;
}): { data: SearchResultItem[]; total: number } {
  const conditions: string[] = [];
  const values: (string | number)[] = [];

  if (params.q?.trim()) {
    conditions.push("search_fts MATCH ?");
    values.push(params.q.trim().split(/\s+/).map((w) => `"${w}"`).join(" AND "));
  }

  if (params.contentType !== "all") {
    conditions.push("content_type = ?");
    values.push(params.contentType);
  }

  if (params.startTime) {
    conditions.push("timestamp >= ?");
    values.push(params.startTime);
  }
  if (params.endTime) {
    conditions.push("timestamp <= ?");
    values.push(params.endTime);
  }
  if (params.appName) {
    conditions.push("app_name LIKE ?");
    values.push(`%${params.appName}%`);
  }
  if (params.windowName) {
    conditions.push("window_name LIKE ?");
    values.push(`%${params.windowName}%`);
  }
  if (params.minLength) {
    conditions.push("length(content) >= ?");
    values.push(params.minLength);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const total = (
    getDb()
      .prepare(`SELECT COUNT(*) as count FROM search_fts ${where}`)
      .get(...values) as { count: number }
  ).count;

  const rows = getDb()
    .prepare(
      `SELECT content, content_type, frame_id, audio_id, timestamp, app_name, window_name
       FROM search_fts ${where}
       ORDER BY timestamp DESC
       LIMIT ? OFFSET ?`
    )
    .all(...values, params.limit, params.offset) as Array<{
      content: string;
      content_type: string;
      frame_id: number | null;
      audio_id: number | null;
      timestamp: string | null;
      app_name: string | null;
      window_name: string | null;
    }>;

  const data: SearchResultItem[] = rows.map((row) => ({
    type:
      row.content_type === "audio"
        ? "Audio"
        : row.content_type === "accessibility"
          ? "Accessibility"
          : row.content_type === "ocr"
            ? "OCR"
            : "UI",
    content: {
      frame_id: row.frame_id ?? undefined,
      audio_chunk_id: row.audio_id ?? undefined,
      timestamp: row.timestamp ?? new Date().toISOString(),
      text: row.content,
      app_name: row.app_name,
      window_name: row.window_name,
    },
  }));

  return { data, total };
}

export function keywordSearch(params: {
  q: string;
  limit: number;
  offset: number;
}): { data: SearchResultItem[]; total: number } {
  return searchContent({
    q: params.q,
    limit: params.limit,
    offset: params.offset,
    contentType: "all",
  });
}

export interface RecentContextItem {
  timestamp: string;
  app_name: string | null;
  window_name: string | null;
  text: string;
  source: "screen" | "audio";
}

/** Latest captured screen text for chat context (not keyword-dependent). */
export function getRecentScreenContext(limit = 10): RecentContextItem[] {
  const rows = getDb()
    .prepare(
      `SELECT f.timestamp, f.app_name, f.window_name,
        COALESCE(
          (SELECT substr(text, 1, 2000) FROM ocr_text WHERE frame_id = f.id ORDER BY id DESC LIMIT 1),
          f.window_name,
          f.app_name
        ) AS text
       FROM frames f
       ORDER BY f.timestamp DESC
       LIMIT ?`
    )
    .all(limit) as Array<Omit<RecentContextItem, "source">>;

  return rows
    .filter((row) => row.text?.trim().length > 0)
    .map((row) => ({ ...row, source: "screen" as const }));
}

/** Latest audio transcriptions for chat context. */
export function getRecentAudioContext(limit = 5): RecentContextItem[] {
  const rows = getDb()
    .prepare(
      `SELECT timestamp, NULL as app_name, NULL as window_name, transcription as text
       FROM audio_transcriptions
       WHERE length(trim(transcription)) > 0
       ORDER BY timestamp DESC
       LIMIT ?`
    )
    .all(limit) as Array<Omit<RecentContextItem, "source">>;

  return rows.map((row) => ({ ...row, source: "audio" as const }));
}

/** Merged recent screen + audio context, newest first. */
export function getRecentContext(limit = 12): RecentContextItem[] {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const combined = [
        ...getRecentScreenContext(limit),
        ...getRecentAudioContext(5),
      ].sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      // Collapse consecutive near-duplicate frames (same app, same text prefix)
      const deduped: RecentContextItem[] = [];
      for (const item of combined) {
        const prev = deduped[deduped.length - 1];
        if (
          prev &&
          prev.source === item.source &&
          prev.app_name === item.app_name &&
          prev.text.slice(0, 200) === item.text.slice(0, 200)
        ) {
          continue;
        }
        deduped.push(item);
      }
      return deduped.slice(0, limit);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("locked") || attempt === 2) throw err;
    }
  }
  return [];
}

export function getStats(): {
  framesCaptured: number;
  audioChunks: number;
  lastFrameTimestamp: string | null;
} {
  const framesCaptured = (
    getDb().prepare(`SELECT COUNT(*) as count FROM frames`).get() as { count: number }
  ).count;
  const audioChunks = (
    getDb().prepare(`SELECT COUNT(*) as count FROM audio_transcriptions`).get() as {
      count: number;
    }
  ).count;
  const last = getDb()
    .prepare(`SELECT timestamp FROM frames ORDER BY timestamp DESC LIMIT 1`)
    .get() as { timestamp: string } | undefined;
  return {
    framesCaptured,
    audioChunks,
    lastFrameTimestamp: last?.timestamp ?? null,
  };
}

export function runReadOnlySql(sql: string): unknown[] {
  const trimmed = sql.trim().toLowerCase();
  if (
    trimmed.startsWith("insert") ||
    trimmed.startsWith("update") ||
    trimmed.startsWith("delete") ||
    trimmed.startsWith("drop") ||
    trimmed.startsWith("alter") ||
    trimmed.startsWith("create") ||
    trimmed.startsWith("pragma")
  ) {
    throw new Error("Only read-only SELECT queries are allowed");
  }
  if (!trimmed.startsWith("select")) {
    throw new Error("Only SELECT queries are allowed");
  }
  return getDb().prepare(sql).all() as unknown[];
}

export function getActivitySummary(startTime: string, endTime: string) {
  const apps = getDb()
    .prepare(
      `SELECT app_name, COUNT(*) as frame_count
       FROM frames
       WHERE timestamp >= ? AND timestamp <= ? AND app_name IS NOT NULL
       GROUP BY app_name
       ORDER BY frame_count DESC
       LIMIT 20`
    )
    .all(startTime, endTime) as Array<{ app_name: string; frame_count: number }>;

  const frameCount = (
    getDb()
      .prepare(
        `SELECT COUNT(*) as count FROM frames WHERE timestamp >= ? AND timestamp <= ?`
      )
      .get(startTime, endTime) as { count: number }
  ).count;

  return {
    start_time: startTime,
    end_time: endTime,
    frame_count: frameCount,
    apps,
  };
}

