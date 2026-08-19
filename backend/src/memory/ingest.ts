import { cypherLiteral, runCypher } from "./client.js";

function titleFromContent(content: string, max = 60): string {
  const line = content.split("\n").find((part) => part.trim().length > 0) ?? content;
  return line.trim().slice(0, max);
}

function nowIso(): string {
  return new Date().toISOString();
}

async function upsertEpisode(params: {
  id: string;
  type: string;
  title: string;
  content: string;
  sourceType: string;
  sourceId: number | null;
  appName: string | null;
  windowName: string | null;
  salience: number;
  createdAt: string;
}): Promise<string | null> {
  try {
    await runCypher(`
      MERGE (e:Episode {id: ${cypherLiteral(params.id)}})
      SET e.type = ${cypherLiteral(params.type)},
          e.title = ${cypherLiteral(params.title)},
          e.content = ${cypherLiteral(params.content)},
          e.source_type = ${cypherLiteral(params.sourceType)},
          e.source_id = ${params.sourceId ?? "null"},
          e.app_name = ${params.appName ? cypherLiteral(params.appName) : "null"},
          e.window_name = ${params.windowName ? cypherLiteral(params.windowName) : "null"},
          e.salience = ${params.salience},
          e.created_at = ${cypherLiteral(params.createdAt)},
          e.updated_at = ${cypherLiteral(nowIso())}
      RETURN e.id AS id
    `);

    await runCypher(`
      MATCH (prev:Episode)
      WHERE prev.id <> ${cypherLiteral(params.id)}
      WITH prev
      ORDER BY prev.created_at DESC
      LIMIT 1
      MATCH (e:Episode {id: ${cypherLiteral(params.id)}})
      MERGE (prev)-[:FOLLOWS]->(e)
    `);

    return params.id;
  } catch (err) {
    console.warn("[hydradb] ingest failed:", err);
    return null;
  }
}

async function upsertFact(params: {
  id: string;
  text: string;
  episodeId: string;
  createdAt: string;
}): Promise<void> {
  const key = params.text.trim().slice(0, 48).toLowerCase();

  await runCypher(`
    MERGE (f:Fact {id: ${cypherLiteral(params.id)}})
    SET f.text = ${cypherLiteral(params.text)},
        f.key = ${cypherLiteral(key)},
        f.current = true,
        f.valid_from = ${cypherLiteral(params.createdAt)},
        f.valid_to = null
    WITH f
    MATCH (e:Episode {id: ${cypherLiteral(params.episodeId)}})
    MERGE (e)-[:RECORDED_AS]->(f)
  `);

  try {
    await runCypher(`
      MATCH (old:Fact)
      WHERE old.current = true
        AND old.id <> ${cypherLiteral(params.id)}
        AND toLower(old.key) = ${cypherLiteral(key)}
      SET old.current = false, old.valid_to = ${cypherLiteral(params.createdAt)}
      WITH old
      MATCH (fresh:Fact {id: ${cypherLiteral(params.id)}})
      MERGE (fresh)-[:SUPERSEDES]->(old)
    `);
  } catch {
    // First fact for this key — no predecessor.
  }
}

export async function ingestScreenCapture(params: {
  frameId: number;
  text: string;
  appName: string | null;
  windowName: string | null;
  timestamp: string;
}): Promise<string | null> {
  const text = params.text.trim();
  if (!text) return null;
  const title = params.windowName ?? params.appName ?? titleFromContent(text);
  const contextLine = [
    params.appName ? `App: ${params.appName}` : null,
    params.windowName ? `Window: ${params.windowName}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return upsertEpisode({
    id: `frame_${params.frameId}`,
    type: "screen_chunk",
    title,
    content: contextLine ? `${contextLine}\n\n${text}` : text,
    sourceType: "frame",
    sourceId: params.frameId,
    appName: params.appName,
    windowName: params.windowName,
    salience: 0.55,
    createdAt: params.timestamp,
  });
}

export async function ingestAudioChunk(params: {
  audioId: number;
  transcription: string;
  meetingId?: number | null;
  timestamp: string;
}): Promise<string | null> {
  const text = params.transcription.trim();
  if (!text) return null;
  return upsertEpisode({
    id: `audio_${params.audioId}`,
    type: "audio_chunk",
    title: titleFromContent(text),
    content: text,
    sourceType: "audio",
    sourceId: params.audioId,
    appName: null,
    windowName: null,
    salience: 0.65,
    createdAt: params.timestamp,
  });
}

export async function ingestMeetingSummary(params: {
  meetingId: number;
  title: string;
  summary: string;
  actionItems: string[];
}): Promise<string | null> {
  const content = [
    params.title,
    params.summary,
    params.actionItems.length > 0
      ? `action items:\n${params.actionItems.map((item) => `- ${item}`).join("\n")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const id = await upsertEpisode({
    id: `meeting_${params.meetingId}`,
    type: "meeting",
    title: params.title,
    content,
    sourceType: "meeting",
    sourceId: params.meetingId,
    appName: null,
    windowName: null,
    salience: 0.9,
    createdAt: nowIso(),
  });

  if (id) {
    await upsertFact({
      id: `fact_meeting_${params.meetingId}`,
      text: params.summary,
      episodeId: id,
      createdAt: nowIso(),
    });
  }

  return id;
}

export async function ingestUserMemory(params: {
  title: string;
  content: string;
}): Promise<string | null> {
  const createdAt = nowIso();
  const id = `user_${Date.now()}`;
  const episodeId = await upsertEpisode({
    id,
    type: "memory",
    title: params.title,
    content: `${params.title}\n${params.content}`,
    sourceType: "user",
    sourceId: null,
    appName: null,
    windowName: null,
    salience: 0.95,
    createdAt,
  });
  if (episodeId) {
    await upsertFact({
      id: `fact_${id}`,
      text: `${params.title}: ${params.content}`,
      episodeId,
      createdAt,
    });
  }
  return episodeId;
}

export async function ingestChatSession(params: {
  sessionId: string;
  turns: Array<{ role: "user" | "assistant"; content: string }>;
  startedAt?: string;
}): Promise<string | null> {
  const startedAt = params.startedAt ?? nowIso();
  try {
    await runCypher(`
      MERGE (s:Session {id: ${cypherLiteral(params.sessionId)}})
      SET s.started_at = ${cypherLiteral(startedAt)},
          s.turn_count = ${params.turns.length}
      RETURN s.id AS id
    `);

    for (const [index, turn] of params.turns.entries()) {
      const text = turn.content.trim();
      if (!text) continue;
      const episodeId = `${params.sessionId}_t${index}`;
      await upsertEpisode({
        id: episodeId,
        type: "session_turn",
        title: `${turn.role} · ${params.sessionId}`,
        content: text,
        sourceType: "user",
        sourceId: index,
        appName: null,
        windowName: null,
        salience: turn.role === "user" ? 0.85 : 0.4,
        createdAt: startedAt,
      });
      await runCypher(`
        MATCH (s:Session {id: ${cypherLiteral(params.sessionId)}})
        MATCH (e:Episode {id: ${cypherLiteral(episodeId)}})
        MERGE (e)-[:IN_SESSION]->(s)
      `);
      if (turn.role === "user") {
        await upsertFact({
          id: `fact_${episodeId}`,
          text,
          episodeId,
          createdAt: startedAt,
        });
      }
    }

    return params.sessionId;
  } catch (err) {
    console.warn("[hydradb] session ingest failed:", err);
    return null;
  }
}
