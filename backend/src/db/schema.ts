export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Migration: window metadata used to be stored as fake "accessibility" text,
-- polluting search. Drop the table and purge its FTS rows.
DROP TABLE IF EXISTS accessibility_text;
DROP INDEX IF EXISTS idx_ax_frame;

CREATE TABLE IF NOT EXISTS video_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  monitor_id INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  frame_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS frames (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  app_name TEXT,
  window_name TEXT,
  browser_url TEXT,
  monitor_id INTEGER NOT NULL DEFAULT 0,
  image_path TEXT NOT NULL,
  video_chunk_id INTEGER REFERENCES video_chunks(id),
  offset_index INTEGER,
  focused INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ocr_text (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  frame_id INTEGER NOT NULL REFERENCES frames(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  text_length INTEGER NOT NULL,
  confidence REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ui_elements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  frame_id INTEGER NOT NULL REFERENCES frames(id) ON DELETE CASCADE,
  element_type TEXT,
  text TEXT,
  bounds_json TEXT
);

CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  title TEXT,
  summary TEXT,
  action_items TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audio_transcriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  transcription TEXT NOT NULL,
  file_path TEXT,
  device_name TEXT,
  duration_secs REAL,
  speaker_id TEXT,
  meeting_id INTEGER REFERENCES meetings(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_frames_timestamp ON frames(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_frames_app ON frames(app_name);
CREATE INDEX IF NOT EXISTS idx_ocr_frame ON ocr_text(frame_id);
CREATE INDEX IF NOT EXISTS idx_audio_timestamp ON audio_transcriptions(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audio_meeting ON audio_transcriptions(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meetings_started ON meetings(started_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
  content,
  content_type,
  frame_id UNINDEXED,
  audio_id UNINDEXED,
  timestamp UNINDEXED,
  app_name UNINDEXED,
  window_name UNINDEXED,
  tokenize='porter unicode61'
);

DELETE FROM search_fts WHERE content_type = 'accessibility';

CREATE TABLE IF NOT EXISTS pipe_state (
  pipe_id TEXT PRIMARY KEY,
  installed INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 0,
  last_run_at TEXT,
  last_run_status TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pipe_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pipe_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  output TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pipe_runs_pipe ON pipe_runs(pipe_id, started_at DESC);
`;
