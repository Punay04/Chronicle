import { electron } from "../electron";

const FALLBACK_API = "http://127.0.0.1:3030";

export interface SearchResultItem {
  type: "OCR" | "Audio" | "UI" | "Accessibility";
  content: {
    frame_id?: number;
    audio_chunk_id?: number;
    timestamp: string;
    text: string;
    app_name?: string | null;
    window_name?: string | null;
  };
}

export interface SearchResponse {
  data: SearchResultItem[];
  pagination: { limit: number; offset: number; total: number };
}

export interface AppConfig {
  model: string;
  ocr_enabled: boolean;
  audio_enabled: boolean;
  stt_engine: string;
  data_dir: string;
}

export interface HealthResponse {
  status: string;
  last_frame_timestamp: string | null;
  frame_status: string;
  audio_status: string;
  frames_captured: number;
  audio_chunks: number;
  uptime_seconds: number;
}

export interface FrameRow {
  id: number;
  timestamp: string;
  app_name: string | null;
  window_name: string | null;
  browser_url: string | null;
  monitor_id: number;
  image_path: string;
  focused: number;
}

export interface FramesResponse {
  data: FrameRow[];
  pagination: { limit: number; offset: number; total: number };
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

export interface EngineStatus {
  running: boolean;
  paused: boolean;
  audioRecording: boolean;
  framesCaptured: number;
  startedAt: number | null;
  lastError: string | null;
}

export interface MeetingListItem {
  id: number;
  started_at: string;
  ended_at: string | null;
  title: string | null;
  summary: string | null;
  action_items: string[] | null;
  notes: string | null;
  chunk_count: number;
  audio_secs: number;
  live: boolean;
}

export interface TranscriptChunk {
  id: number;
  timestamp: string;
  transcription: string;
  duration_secs: number | null;
}

export interface MeetingDetail extends Omit<MeetingListItem, "chunk_count" | "audio_secs"> {
  transcript: TranscriptChunk[];
}

export interface ChatRequest {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  context_query?: string;
}

export interface ChatResponse {
  content: string;
  model: string;
  provider: string;
}

export interface LiveSessionRequest {
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  context_query?: string;
}

export interface LiveSessionResponse {
  token: string;
  model: string;
  voice: string;
  systemInstruction: string;
  provider: string;
}

export interface MemoryNode {
  id: string;
  type: string;
  title: string | null;
  content: string;
  metadata: Record<string, unknown> | null;
  source_type: string | null;
  source_id: number | null;
  app_name: string | null;
  window_name: string | null;
  salience: number;
  created_at: string;
  updated_at: string;
}

export interface MemoryGraphResponse {
  node: MemoryNode;
  edges: Array<{
    id: string;
    from_id: string;
    to_id: string;
    relation: string;
    weight: number;
    created_at: string;
    neighbor: MemoryNode;
  }>;
}

export interface MemoryListResponse {
  data: MemoryNode[];
  pagination: { limit: number; offset: number; total: number };
}

export interface MemoryProfileResponse {
  persona: string[];
  aims: string[];
}

export interface MemoryStatsResponse {
  nodes: number;
  edges: number;
  by_type: Record<string, number>;
}

export type PipeId =
  | "daily-summary"
  | "meeting-recap"
  | "focus-tracker"
  | "action-items";

export interface PipeListItem {
  id: PipeId;
  name: string;
  description: string;
  schedule: string;
  installed: boolean;
  enabled: boolean;
  last_run_at: string | null;
  last_run_status: string | null;
  running: boolean;
}

export interface PipeRunLog {
  id: number;
  pipe_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  output: string | null;
  error: string | null;
}

export interface PipeRunResponse {
  status: "ok" | "error";
  run_id: number;
  output?: string;
  error?: string;
}

async function getBaseUrl(): Promise<string> {
  if (electron?.getApiUrl) {
    return electron.getApiUrl();
  }
  return FALLBACK_API;
}

export async function getApiBaseUrl(): Promise<string> {
  return getBaseUrl();
}

export async function frameImageUrl(id: number): Promise<string> {
  const base = await getBaseUrl();
  return `${base}/frames/${id}/image`;
}

export interface ConnectorInfo {
  toolkit: string;
  name: string;
  connected: boolean;
  status: string | null;
  connectedAccountId: string | null;
  configured: boolean;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  if (electron?.apiRequest) {
    return electron.apiRequest(method, path, body) as Promise<T>;
  }

  const base = await getBaseUrl();
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    throw new Error(`API ${method} ${path} failed: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export const api = {
  config: () => request<AppConfig>("GET", "/config"),
  health: () => request<HealthResponse>("GET", "/health"),
  search: (params: {
    q?: string;
    limit?: number;
    offset?: number;
    content_type?: string;
  }) => {
    const query = new URLSearchParams();
    if (params.q) query.set("q", params.q);
    if (params.limit) query.set("limit", String(params.limit));
    if (params.offset) query.set("offset", String(params.offset));
    if (params.content_type) query.set("content_type", params.content_type);
    const qs = query.toString();
    return request<SearchResponse>("GET", `/search${qs ? `?${qs}` : ""}`);
  },
  frames: (params?: { limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.offset) query.set("offset", String(params.offset));
    const qs = query.toString();
    return request<FramesResponse>("GET", `/frames${qs ? `?${qs}` : ""}`);
  },
  frameImage: (id: number) =>
    request<FrameRow & { image_base64?: string }>(
      "GET",
      `/frames/${id}?include_image=true`
    ),
  frameText: (id: number) =>
    request<{ text: string; app_name: string | null; window_name: string | null }>(
      "GET",
      `/frames/${id}/text`
    ),
  visionList: () =>
    request<{ data: MonitorInfo[] }>("GET", "/vision/list"),
  audioList: () =>
    request<{ data: AudioDeviceInfo[] }>("GET", "/audio/list"),
  engineStatus: () => request<EngineStatus>("GET", "/engine/status"),
  engineStart: () => request<{ running: boolean }>("POST", "/engine/start"),
  engineStop: () => request<{ running: boolean }>("POST", "/engine/stop"),
  enginePause: () => request<{ paused: boolean }>("POST", "/engine/pause"),
  engineResume: () => request<{ paused: boolean }>("POST", "/engine/resume"),
  audioStart: () => request<{ recording: boolean }>("POST", "/audio/start"),
  audioStop: () => request<{ recording: boolean }>("POST", "/audio/stop"),
  chat: (body: ChatRequest) => request<ChatResponse>("POST", "/chat", body),
  liveSession: (body: LiveSessionRequest) =>
    request<LiveSessionResponse>("POST", "/chat/live/session", body),
  meetings: () => request<{ data: MeetingListItem[] }>("GET", "/meetings"),
  meeting: (id: number) => request<MeetingDetail>("GET", `/meetings/${id}`),
  updateMeeting: (id: number, body: { title?: string | null; notes?: string | null }) =>
    request<MeetingDetail>("PATCH", `/meetings/${id}`, body),
  summarizeMeeting: (id: number) =>
    request<{ title: string; summary: string; action_items: string[] }>(
      "POST",
      `/meetings/${id}/summarize`
    ),
  memory: (params?: { q?: string; type?: string; limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (params?.q) query.set("q", params.q);
    if (params?.type) query.set("type", params.type);
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.offset) query.set("offset", String(params.offset));
    const qs = query.toString();
    return request<MemoryListResponse>("GET", `/memory${qs ? `?${qs}` : ""}`);
  },
  memoryNode: (id: string) => request<MemoryNode>("GET", `/memory/${id}`),
  memoryGraph: (id: string, hops = 2) =>
    request<MemoryGraphResponse>("GET", `/memory/${id}/graph?hops=${hops}`),
  memoryStats: () => request<MemoryStatsResponse>("GET", "/memory/stats"),
  memoryProfile: () => request<MemoryProfileResponse>("GET", "/memory/profile"),
  createMemory: (body: { title: string; content: string; related_node_ids?: number[] }) =>
    request<{ id: number; node: MemoryNode }>("POST", "/memory", body),
  listConnectors: () =>
    request<{ configured: boolean; data: ConnectorInfo[] }>("GET", "/connectors"),
  connectConnector: (toolkit: string) =>
    request<{ redirectUrl: string | null; connectedAccountId: string }>(
      "POST",
      `/connectors/${toolkit}/connect`
    ),
  connectorStatus: (toolkit: string, id: string) =>
    request<{ status: string; connected: boolean }>(
      "GET",
      `/connectors/${toolkit}/status?id=${encodeURIComponent(id)}`
    ),
  disconnectConnector: (toolkit: string, connectedAccountId: string) =>
    request<{ status: string }>("POST", `/connectors/${toolkit}/disconnect`, {
      connectedAccountId,
    }),
  pipes: () => request<{ data: PipeListItem[] }>("GET", "/pipes"),
  installPipe: (id: PipeId) =>
    request<{ status: string; installed: boolean }>("POST", `/pipes/${id}/install`),
  uninstallPipe: (id: PipeId) =>
    request<{ status: string; installed: boolean }>("POST", `/pipes/${id}/uninstall`),
  enablePipe: (id: PipeId, enabled: boolean) =>
    request<{ status: string; enabled: boolean }>("POST", `/pipes/${id}/enable`, {
      enabled,
    }),
  runPipe: (id: PipeId) => request<PipeRunResponse>("POST", `/pipes/${id}/run`),
  pipeLogs: (id: PipeId, limit = 20) =>
    request<{ data: PipeRunLog[] }>("GET", `/pipes/${id}/logs?limit=${limit}`),
};

/** Load a frame screenshot for display — base64 via API first (Electron-safe), then binary URL. */
export async function loadFrameImageSrc(id: number): Promise<string> {
  try {
    const data = await api.frameImage(id);
    if (data.image_base64) {
      return `data:image/jpeg;base64,${data.image_base64}`;
    }
  } catch {
    // fall through to direct fetch
  }

  const base = await getBaseUrl();
  const res = await fetch(`${base}/frames/${id}/image`);
  if (!res.ok) {
    throw new Error(`frame image unavailable (${res.status})`);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
