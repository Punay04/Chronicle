export type ContentType =
  | "ocr"
  | "audio"
  | "input"
  | "accessibility"
  | "all";

export interface FrameRow {
  id: number;
  timestamp: string;
  app_name: string | null;
  window_name: string | null;
  browser_url: string | null;
  monitor_id: number;
  image_path: string;
  video_chunk_id: number | null;
  offset_index: number | null;
  focused: number;
  created_at: string;
}

export interface SearchResultItem {
  type: "OCR" | "Audio" | "UI" | "Accessibility";
  content: {
    frame_id?: number;
    audio_chunk_id?: number;
    timestamp: string;
    text: string;
    app_name?: string | null;
    window_name?: string | null;
    browser_url?: string | null;
    file_path?: string;
    device_name?: string;
  };
}

export interface SearchResponse {
  data: SearchResultItem[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
}

export interface HealthResponse {
  status: "healthy" | "degraded" | "offline";
  last_frame_timestamp: string | null;
  frame_status: "ok" | "paused" | "error" | "disabled";
  audio_status: "ok" | "paused" | "error" | "disabled";
  ui_status: "ok" | "error";
  message: string;
  version: string;
  uptime_seconds: number;
  frames_captured: number;
  audio_chunks: number;
}

export interface MonitorInfo {
  id: number | string;
  name: string;
  width: number;
  height: number;
  active: boolean;
}

export interface AudioDeviceInfo {
  name: string;
  device_type: "input" | "output";
  is_default: boolean;
}

export interface EngineState {
  running: boolean;
  paused: boolean;
  audioRecording: boolean;
  framesCaptured: number;
  startedAt: number | null;
  lastError: string | null;
}
