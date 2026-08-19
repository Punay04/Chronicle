import { readFileSync, existsSync } from "fs";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { API_HOST, API_PORT, AUDIO_ENABLED, AUTO_START_CAPTURE, DATA_DIR, GEMINI_MODEL, OCR_ENABLED } from "./config.js";
import { captureEngine } from "./capture/engine.js";
import {
  isAudioRecording,
  listAudioDevices,
  startAudioRecording,
  stopAudioRecording,
} from "./capture/audio.js";
import { listMonitors } from "./capture/screen.js";
import { extractFrameJpeg, getRecentFrame } from "./capture/video.js";
import { sttStatus } from "./capture/stt.js";
import {
  getActivitySummary,
  getFrameById,
  getFrameText,
  getVideoChunkPath,
  getStats,
  initDatabase,
  keywordSearch,
  listFrames,
  runReadOnlySql,
  searchContent,
} from "./db/index.js";
import {
  backfillOrphanTranscriptions,
  closeOrphanOpenMeetings,
  deleteStaleEmptyMeetings,
  getMeeting,
  getMeetingTranscript,
  listMeetings,
  updateMeeting,
} from "./db/meetings.js";
import type { ContentType } from "./types.js";
import {
  buildSystemInstruction,
  generateGeminiReply,
  summarizeMeeting,
  type ChatTurn,
} from "./llm/gemini.js";
import { mintGeminiLiveToken } from "./llm/gemini-live.js";
import { buildChatContext } from "./chat/context.js";
import { COMPOSIO_ENABLED } from "./connectors/config.js";
import {
  connectionStatus,
  disconnect,
  executeTool,
  getGeminiTools,
  initiateConnection,
  listConnections,
} from "./connectors/composio.js";
import {
  backfillMemory,
  getMemoryStats,
  getNode,
  getNodeGraph,
  getUserProfile,
  ingestChatSession,
  ingestMeetingSummary,
  ingestUserMemory,
  initMemory,
  listNodes,
} from "./memory/index.js";
import {
  getRunningPipes,
  initPipeState,
  listPipeRuns,
  listPipes,
  runPipe,
  setPipeEnabled,
  setPipeInstalled,
  startPipeScheduler,
} from "./pipes/index.js";
import { getPipeDefinition } from "./pipes/definitions.js";

const app = new Hono();
const startTime = Date.now();

app.use("*", cors());

app.get("/config", (c) => {
  return c.json({
    model: GEMINI_MODEL,
    ocr_enabled: OCR_ENABLED,
    audio_enabled: AUDIO_ENABLED,
    stt_engine: sttStatus(),
    data_dir: DATA_DIR,
  });
});

app.get("/health", (c) => {
  const stats = getStats();
  const engine = captureEngine.state;

  return c.json({
    status: engine.running ? "healthy" : "degraded",
    last_frame_timestamp: stats.lastFrameTimestamp,
    frame_status: engine.paused ? "paused" : engine.running ? "ok" : "disabled",
    audio_status: isAudioRecording() ? "ok" : engine.running ? "paused" : "disabled",
    ui_status: "ok",
    message: engine.lastError ?? "chronicle capture engine",
    version: "0.1.0",
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    frames_captured: stats.framesCaptured,
    audio_chunks: stats.audioChunks,
    stt_engine: sttStatus(),
  });
});

app.get("/search", (c) => {
  const q = c.req.query("q");
  const limit = Number(c.req.query("limit") ?? 20);
  const offset = Number(c.req.query("offset") ?? 0);
  const contentType = (c.req.query("content_type") ?? "all") as ContentType;
  const startTimeQ = c.req.query("start_time");
  const endTimeQ = c.req.query("end_time");
  const appName = c.req.query("app_name");
  const windowName = c.req.query("window_name");
  const minLength = c.req.query("min_length")
    ? Number(c.req.query("min_length"))
    : undefined;

  const { data, total } = searchContent({
    q,
    limit,
    offset,
    contentType,
    startTime: startTimeQ,
    endTime: endTimeQ,
    appName,
    windowName,
    minLength,
  });

  return c.json({
    data,
    pagination: { limit, offset, total },
  });
});

app.get("/search/keyword", (c) => {
  const q = c.req.query("q") ?? "";
  const limit = Number(c.req.query("limit") ?? 20);
  const offset = Number(c.req.query("offset") ?? 0);
  const { data, total } = keywordSearch({ q, limit, offset });
  return c.json({ data, pagination: { limit, offset, total } });
});

app.get("/activity-summary", (c) => {
  const start = c.req.query("start_time") ?? new Date(Date.now() - 86400000).toISOString();
  const end = c.req.query("end_time") ?? new Date().toISOString();
  return c.json(getActivitySummary(start, end));
});

app.get("/pipes", (c) => {
  return c.json({ data: listPipes(getRunningPipes()) });
});

app.post("/pipes/:id/install", (c) => {
  const id = c.req.param("id");
  if (!getPipeDefinition(id)) return c.json({ error: "unknown pipe" }, 404);
  setPipeInstalled(id, true);
  return c.json({ status: "ok", installed: true });
});

app.post("/pipes/:id/uninstall", (c) => {
  const id = c.req.param("id");
  if (!getPipeDefinition(id)) return c.json({ error: "unknown pipe" }, 404);
  setPipeInstalled(id, false);
  return c.json({ status: "ok", installed: false });
});

app.post("/pipes/:id/enable", async (c) => {
  const id = c.req.param("id");
  if (!getPipeDefinition(id)) return c.json({ error: "unknown pipe" }, 404);
  const body = (await c.req.json<{ enabled?: boolean }>().catch(() => ({
    enabled: true,
  }))) as { enabled?: boolean };
  const enabled = body.enabled !== false;
  setPipeEnabled(id, enabled);
  return c.json({ status: "ok", enabled });
});

app.post("/pipes/:id/run", async (c) => {
  const id = c.req.param("id");
  if (!getPipeDefinition(id)) return c.json({ error: "unknown pipe" }, 404);
  try {
    const result = await runPipe(id);
    return c.json(result);
  } catch (err) {
    return c.json(
      { status: "error", error: err instanceof Error ? err.message : "pipe run failed" },
      500
    );
  }
});

app.get("/pipes/:id/logs", (c) => {
  const id = c.req.param("id");
  if (!getPipeDefinition(id)) return c.json({ error: "unknown pipe" }, 404);
  const limit = Number(c.req.query("limit") ?? 20);
  const runs = listPipeRuns(id, limit).map((run) => ({
    id: run.id,
    pipe_id: run.pipe_id,
    started_at: run.started_at,
    finished_at: run.finished_at,
    status: run.status,
    output: run.output,
    error: run.error,
  }));
  return c.json({ data: runs });
});

/** Load a frame's pixels: video chunk extraction first, legacy JPEG fallback. */
async function loadFrameJpeg(frame: {
  id: number;
  image_path: string;
  video_chunk_id: number | null;
  offset_index: number | null;
}): Promise<Buffer | null> {
  const recent = getRecentFrame(frame.id);
  if (recent) return recent;
  if (frame.video_chunk_id !== null && frame.offset_index !== null) {
    const chunkPath = getVideoChunkPath(frame.video_chunk_id);
    if (chunkPath && existsSync(chunkPath)) {
      try {
        return await extractFrameJpeg(chunkPath, frame.offset_index);
      } catch (err) {
        console.error("[server] frame extraction failed:", err);
      }
    }
  }
  if (frame.image_path && existsSync(frame.image_path)) {
    return readFileSync(frame.image_path);
  }
  return null;
}

app.get("/frames/:id/image", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "invalid frame id" }, 400);
  const frame = getFrameById(id);
  if (!frame) return c.json({ error: "frame not found" }, 404);
  const buffer = await loadFrameJpeg(frame);
  if (!buffer) return c.json({ error: "image not found" }, 404);
  return new Response(buffer, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=300",
    },
  });
});

app.get("/frames/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const frame = getFrameById(id);
  if (!frame) return c.json({ error: "frame not found" }, 404);

  const includeImage = c.req.query("include_image") === "true";
  let imageBase64: string | undefined;
  if (includeImage) {
    const buffer = await loadFrameJpeg(frame);
    if (buffer) imageBase64 = buffer.toString("base64");
  }

  return c.json({ ...frame, image_base64: imageBase64 });
});

app.get("/frames/:id/text", (c) => {
  const id = Number(c.req.param("id"));
  const frame = getFrameById(id);
  if (!frame) return c.json({ error: "frame not found" }, 404);
  const text = getFrameText(id);
  return c.json({
    frame_id: id,
    ocr: text.ocr,
    text: text.ocr ?? "",
    timestamp: frame.timestamp,
    app_name: frame.app_name,
    window_name: frame.window_name,
  });
});

app.get("/frames/:id/ocr", (c) => {
  const id = Number(c.req.param("id"));
  const frame = getFrameById(id);
  if (!frame) return c.json({ error: "frame not found" }, 404);
  const text = getFrameText(id);
  return c.json({ frame_id: id, text: text.ocr ?? "", source: "ocr" });
});

app.get("/frames/:id/context", (c) => {
  const id = Number(c.req.param("id"));
  const frame = getFrameById(id);
  if (!frame) return c.json({ error: "frame not found" }, 404);
  const text = getFrameText(id);
  return c.json({
    frame_id: id,
    context: text.ocr ?? "",
    app_name: frame.app_name,
    window_name: frame.window_name,
    browser_url: frame.browser_url,
  });
});

app.get("/frames/:id/metadata", (c) => {
  const id = Number(c.req.param("id"));
  const frame = getFrameById(id);
  if (!frame) return c.json({ error: "frame not found" }, 404);
  return c.json({
    frame_id: id,
    timestamp: frame.timestamp,
    app_name: frame.app_name,
    window_name: frame.window_name,
    browser_url: frame.browser_url,
    monitor_id: frame.monitor_id,
    focused: Boolean(frame.focused),
    image_path: frame.image_path,
  });
});

app.get("/frames", (c) => {
  const limit = Number(c.req.query("limit") ?? 50);
  const offset = Number(c.req.query("offset") ?? 0);
  const startTimeQ = c.req.query("start_time");
  const endTimeQ = c.req.query("end_time");
  const { frames, total } = listFrames({
    limit,
    offset,
    startTime: startTimeQ,
    endTime: endTimeQ,
  });
  return c.json({ data: frames, pagination: { limit, offset, total } });
});

app.get("/vision/list", async (c) => {
  const monitors = await listMonitors();
  return c.json({ data: monitors });
});

app.get("/audio/list", async (c) => {
  const devices = await listAudioDevices();
  return c.json({ data: devices });
});

app.post("/audio/start", async (c) => {
  await startAudioRecording();
  captureEngine.state.audioRecording = true;
  return c.json({ status: "ok", recording: true });
});

app.post("/audio/stop", (c) => {
  stopAudioRecording();
  captureEngine.state.audioRecording = false;
  return c.json({ status: "ok", recording: false });
});

function parseActionItems(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

app.get("/meetings", (c) => {
  const rows = listMeetings();
  const data = rows.map((m) => ({
    ...m,
    action_items: parseActionItems(m.action_items),
    live: m.ended_at === null && isAudioRecording(),
  }));
  return c.json({ data });
});

app.get("/meetings/:id", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "invalid meeting id" }, 400);
  const meeting = getMeeting(id);
  if (!meeting) return c.json({ error: "meeting not found" }, 404);
  return c.json({
    ...meeting,
    action_items: parseActionItems(meeting.action_items),
    live: meeting.ended_at === null && isAudioRecording(),
    transcript: getMeetingTranscript(id),
  });
});

app.patch("/meetings/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "invalid meeting id" }, 400);
  const meeting = getMeeting(id);
  if (!meeting) return c.json({ error: "meeting not found" }, 404);

  const body = await c.req.json<{ title?: string | null; notes?: string | null }>();
  const fields: { title?: string | null; notes?: string | null } = {};
  if ("title" in body) fields.title = body.title;
  if ("notes" in body) fields.notes = body.notes;
  if (Object.keys(fields).length === 0) {
    return c.json({ error: "title or notes required" }, 400);
  }

  updateMeeting(id, fields);
  const updated = getMeeting(id)!;
  return c.json({
    ...updated,
    action_items: parseActionItems(updated.action_items),
  });
});

app.post("/meetings/:id/summarize", async (c) => {
  try {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "invalid meeting id" }, 400);
    const meeting = getMeeting(id);
    if (!meeting) return c.json({ error: "meeting not found" }, 404);

    const transcript = getMeetingTranscript(id);
    if (transcript.length === 0) {
      return c.json({ error: "meeting has no transcript yet" }, 400);
    }

    const text = transcript
      .map((chunk) => `[${chunk.timestamp}] ${chunk.transcription}`)
      .join("\n");
    const result = await summarizeMeeting(text);

    updateMeeting(id, {
      summary: result.summary,
      action_items: JSON.stringify(result.action_items),
      // Don't clobber a user-set title
      ...(meeting.title ? {} : { title: result.title }),
    });

    ingestMeetingSummary({
      meetingId: id,
      title: meeting.title ?? result.title,
      summary: result.summary,
      actionItems: result.action_items,
    });

    return c.json({
      title: meeting.title ?? result.title,
      summary: result.summary,
      action_items: result.action_items,
    });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "summarize failed" },
      500
    );
  }
});

app.post("/engine/start", async (c) => {
  captureEngine.start();
  if (AUDIO_ENABLED) {
    await startAudioRecording();
    captureEngine.state.audioRecording = true;
  }
  return c.json({ status: "ok", running: true });
});

app.post("/engine/stop", (c) => {
  stopAudioRecording();
  captureEngine.state.audioRecording = false;
  captureEngine.stop();
  return c.json({ status: "ok", running: false });
});

app.post("/engine/pause", (c) => {
  captureEngine.pause();
  return c.json({ status: "ok", paused: true });
});

app.post("/engine/resume", (c) => {
  captureEngine.resume();
  return c.json({ status: "ok", paused: false });
});

app.get("/engine/status", (c) => {
  return c.json(captureEngine.state);
});

app.post("/chat", async (c) => {
  try {
    const body = await c.req.json<{
      messages: ChatTurn[];
      context_query?: string;
    }>();

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return c.json({ error: "messages array is required" }, 400);
    }

    const lastUserMessage = [...body.messages]
      .reverse()
      .find((message) => message.role === "user")?.content;

    const searchQuery = body.context_query ?? lastUserMessage ?? "";
    const { snippets: boundedSnippets, recording } =
      await buildChatContext(searchQuery);

    // Load connector tools for any actively-connected toolkits so the model can
    // read/act in Gmail, Calendar, Slack, Notion. No-op when Composio is unset.
    let tools: Awaited<ReturnType<typeof getGeminiTools>> = [];
    if (COMPOSIO_ENABLED) {
      try {
        const connections = await listConnections();
        const active = connections
          .filter((conn) => conn.connected)
          .map((conn) => conn.toolkit);
        tools = await getGeminiTools(active);
      } catch (err) {
        console.warn("[chat] failed to load connector tools:", err);
      }
    }

    const content = await generateGeminiReply(
      body.messages,
      boundedSnippets,
      recording,
      tools.length > 0
        ? {
            tools,
            executeTool: async (name, args) => {
              const result = await executeTool(name, args);
              if (!result.successful && result.error) {
                return { error: result.error };
              }
              return result.data;
            },
          }
        : undefined
    );
    return c.json({ content, model: GEMINI_MODEL, provider: "gemini" });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "chat request failed" },
      500
    );
  }
});

/**
 * Mint a Gemini Live ephemeral token (Snappy-style).
 * Client connects directly to BidiGenerateContentConstrained with the token.
 * Same HydraDB graph context + system prompt architecture as POST /chat.
 */
app.post("/chat/live/session", async (c) => {
  try {
    const body = await c.req.json<{
      messages?: ChatTurn[];
      context_query?: string;
    }>();

    const messages = Array.isArray(body.messages) ? body.messages : [];
    const lastUser = [...messages]
      .reverse()
      .find((m) => m.role === "user")?.content;
    const searchQuery = body.context_query ?? lastUser ?? "recent activity";

    const { snippets, recording } = await buildChatContext(searchQuery);
    let systemInstruction = buildSystemInstruction(snippets, recording, false, {
      voice: true,
    });

    // Live rejects clientContent turns that include model role (closes with 1007).
    // Keep prior chat context in the system instruction instead.
    const recent = messages
      .filter((m) => m.content.trim())
      .slice(-12)
      .map((m) => `${m.role}: ${m.content.trim().slice(0, 1200)}`)
      .join("\n");
    if (recent) {
      systemInstruction = `${systemInstruction}\n\nRecent chat transcript (for continuity):\n${recent}`;
    }

    const live = await mintGeminiLiveToken(systemInstruction);
    return c.json({
      token: live.token,
      model: live.model,
      voice: live.voice,
      systemInstruction,
      provider: "gemini",
    });
  } catch (err) {
    return c.json(
      {
        error:
          err instanceof Error ? err.message : "live session mint failed",
      },
      500
    );
  }
});

app.get("/memory/stats", async (c) => {
  return c.json(await getMemoryStats());
});

app.get("/memory/profile", async (c) => {
  return c.json(await getUserProfile());
});

app.get("/memory", async (c) => {
  const q = c.req.query("q");
  const type = c.req.query("type");
  const limit = Number(c.req.query("limit") ?? 50);
  const offset = Number(c.req.query("offset") ?? 0);

  const { data, total } = await listNodes({
    q: q ?? undefined,
    type: type as import("./memory/types.js").MemoryNodeType | undefined,
    limit,
    offset,
  });

  return c.json({
    data,
    pagination: { limit, offset, total },
  });
});

app.get("/memory/:id", async (c) => {
  const id = c.req.param("id");
  if (!id.trim()) return c.json({ error: "invalid memory id" }, 400);
  const node = await getNode(id);
  if (!node) return c.json({ error: "memory not found" }, 404);
  return c.json(node);
});

app.get("/memory/:id/graph", async (c) => {
  const id = c.req.param("id");
  if (!id.trim()) return c.json({ error: "invalid memory id" }, 400);
  const hops = Number(c.req.query("hops") ?? 2);
  const graph = await getNodeGraph(id, hops);
  if (!graph) return c.json({ error: "memory not found" }, 404);
  return c.json(graph);
});

app.post("/memory", async (c) => {
  try {
    const body = await c.req.json<{
      title: string;
      content: string;
    }>();

    if (!body.title?.trim() || !body.content?.trim()) {
      return c.json({ error: "title and content are required" }, 400);
    }

    const id = await ingestUserMemory({
      title: body.title,
      content: body.content,
    });

    if (!id) {
      return c.json({ error: "hydradb local server unavailable" }, 503);
    }

    const node = await getNode(id);
    return c.json({ id, node });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "memory create failed" },
      500
    );
  }
});

app.post("/memory/sessions", async (c) => {
  try {
    const body = await c.req.json<{
      sessionId?: string;
      turns?: Array<{ role: "user" | "assistant"; content: string }>;
      startedAt?: string;
    }>();

    if (!body.sessionId?.trim() || !Array.isArray(body.turns) || body.turns.length === 0) {
      return c.json({ error: "sessionId and turns are required" }, 400);
    }

    const id = await ingestChatSession({
      sessionId: body.sessionId,
      turns: body.turns,
      startedAt: body.startedAt,
    });

    if (!id) {
      return c.json({ error: "hydradb graph node unavailable" }, 503);
    }

    return c.json({ id, turns: body.turns.length });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "session ingest failed" },
      500
    );
  }
});

app.post("/raw_sql", async (c) => {
  try {
    const body = await c.req.json<{ query: string }>();
    const rows = runReadOnlySql(body.query);
    return c.json({ data: rows });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "query failed" },
      400
    );
  }
});

app.post("/add", async (c) => {
  const body = await c.req.json<{
    type: "ocr" | "accessibility" | "audio";
    text: string;
    timestamp?: string;
    app_name?: string;
    window_name?: string;
  }>();

  const timestamp = body.timestamp ?? new Date().toISOString();

  if (body.type === "audio") {
    const { insertAudioTranscription } = await import("./db/index.js");
    const id = insertAudioTranscription({
      timestamp,
      transcription: body.text,
      deviceName: "manual",
    });
    return c.json({ status: "ok", id });
  }

  const { insertFrame, insertOcrText } = await import("./db/index.js");
  const frameId = insertFrame({
    timestamp,
    appName: body.app_name ?? null,
    windowName: body.window_name ?? null,
    browserUrl: null,
    monitorId: 0,
    imagePath: "",
    focused: true,
  });

  // "accessibility" type is kept for API compat but stored as OCR text
  insertOcrText(frameId, body.text);

  return c.json({ status: "ok", frame_id: frameId });
});

app.get("/connectors", async (c) => {
  if (!COMPOSIO_ENABLED) {
    return c.json({ configured: false, data: [] });
  }
  try {
    const data = await listConnections();
    return c.json({ configured: true, data });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "failed to list connectors" },
      500
    );
  }
});

app.post("/connectors/:toolkit/connect", async (c) => {
  try {
    const toolkit = c.req.param("toolkit");
    const result = await initiateConnection(toolkit);
    return c.json(result);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "failed to start connection" },
      500
    );
  }
});

app.get("/connectors/:toolkit/status", async (c) => {
  try {
    const id = c.req.query("id");
    if (!id) return c.json({ error: "id query param is required" }, 400);
    const status = await connectionStatus(id);
    return c.json(status);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "failed to get status" },
      500
    );
  }
});

app.post("/connectors/:toolkit/disconnect", async (c) => {
  try {
    const body = await c.req.json<{ connectedAccountId?: string }>();
    if (!body.connectedAccountId) {
      return c.json({ error: "connectedAccountId is required" }, 400);
    }
    await disconnect(body.connectedAccountId);
    return c.json({ status: "ok" });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "failed to disconnect" },
      500
    );
  }
});

export function startServer(): void {
  initDatabase();
  initMemory();
  initPipeState();
  void backfillMemory();
  closeOrphanOpenMeetings();
  deleteStaleEmptyMeetings();
  backfillOrphanTranscriptions();
  startPipeScheduler();

  if (AUTO_START_CAPTURE) {
    captureEngine.start();
    if (AUDIO_ENABLED) {
      void startAudioRecording().then(() => {
        captureEngine.state.audioRecording = true;
      });
    }
  }

  serve({ fetch: app.fetch, hostname: API_HOST, port: API_PORT }, () => {
    console.log(`[server] chronicle api http://${API_HOST}:${API_PORT}`);
  });
}

export { app };
