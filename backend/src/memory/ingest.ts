import { HydraQueryError, cypherLiteral, runCypher } from "./client.js";
import { ROOT_KEY, graphIdFor, rootGraphId } from "./graph-ids.js";

/**
 * Writing to HydraDB, within what the graph-node can actually execute.
 *
 * The server accepts a narrow slice of OpenCypher, and every rule below is a
 * constraint it enforces (verified against ghcr.io/hydra-db/hydradb:latest):
 *
 *  - a node's `id` property must be an INTEGER, so string memory keys are
 *    mapped through `graph-ids.ts` and the original is kept in `key`;
 *  - a write must be a one-hop edge pattern — an isolated `MERGE (n:X {...})`
 *    fails with "MERGE requires destination id" — so nodes are attached to a
 *    root anchor;
 *  - a mutation cannot be followed by other clauses, so no `RETURN` on writes
 *    and `SET` has to be its own statement;
 *  - the whole query must stay under ~1025 characters, so property updates are
 *    split into several statements and long text is truncated.
 */

/**
 * Stay clear of the server's ~1025 limit, which is measured in UTF-8 BYTES.
 * A Devanagari or CJK character costs three bytes, so counting JS characters
 * silently overshoots by 3x on non-Latin text.
 */
const MAX_QUERY_BYTES = 900;

const byteLength = (value: string): number => Buffer.byteLength(value, "utf8");

/**
 * Longest text stored on a graph node.
 *
 * The graph is a derived index, not the system of record — the full text always
 * remains in SQLite and stays searchable through FTS5. Keeping the stored slice
 * small is what allows a property write to fit in one query.
 */
const MAX_CONTENT_CHARS = 600;
const MAX_TITLE_CHARS = 120;

let writesUnsupported = false;
let writesUnsupportedReason = "";

export function memoryWritesUnsupported(): boolean {
  return writesUnsupported;
}

export function memoryWritesUnsupportedReason(): string {
  return writesUnsupportedReason;
}

/**
 * Consecutive write failures before giving up for this process.
 *
 * `backfillMemory()` walks up to 500 OCR rows plus 500 audio rows on every
 * start. When writes fail for a reason that belongs to the server rather than
 * the row, retrying each one only reproduces the same error a thousand times.
 * A successful write resets the counter.
 */
const INGEST_FAILURE_LIMIT = 3;
let consecutiveFailures = 0;

function noteIngestSuccess(): void {
  consecutiveFailures = 0;
}

function reportIngestFailure(err: unknown): void {
  if (writesUnsupported) return;

  const message = err instanceof Error ? err.message : String(err);
  consecutiveFailures += 1;

  if (consecutiveFailures === 1) {
    const where =
      err instanceof HydraQueryError && err.query
        ? `\n  query: ${err.query.replace(/\s+/g, " ")}`
        : "";
    console.warn(`[hydradb] ingest failed: ${message}${where}`);
    return;
  }

  if (consecutiveFailures >= INGEST_FAILURE_LIMIT) {
    writesUnsupported = true;
    writesUnsupportedReason = message;
    console.warn(
      `[hydradb] giving up on graph writes after ${consecutiveFailures} ` +
        `consecutive failures — ${message}. Capture continues in SQLite, but ` +
        `the Memory graph will stay empty until the graph-node accepts these queries.`
    );
  }
}

function titleFromContent(content: string, max = 60): string {
  const line = content.split("\n").find((part) => part.trim().length > 0) ?? content;
  return line.trim().slice(0, max);
}

function nowIso(): string {
  return new Date().toISOString();
}

function clip(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

/** Run a write, skipping it if it would exceed the server's query limit. */
async function runWrite(query: string): Promise<void> {
  const compact = query.trim();
  const size = byteLength(compact);
  if (size > MAX_QUERY_BYTES) {
    throw new Error(
      `refusing to send a ${size} byte query (limit ${MAX_QUERY_BYTES})`
    );
  }
  await runCypher(compact);
}

/**
 * Apply properties to an existing node, splitting into as many statements as
 * the query-length limit requires.
 */
async function setProperties(
  label: string,
  graphId: number,
  props: Record<string, string | number | boolean | null>
): Promise<void> {
  // The server accepts only integer, float, boolean, and string literals as
  // property values — an explicit null is rejected — so absent values are
  // simply not written.
  const prefix = `MATCH (n:${label} {id: ${graphId}}) SET `;

  const assignments = Object.entries(props)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([name, value]) => {
      if (typeof value !== "string") return `n.${name} = ${String(value)}`;

      // Escaping can expand a string (quotes and backslashes double), so shrink
      // until the finished statement fits rather than trusting the input length.
      const room = MAX_QUERY_BYTES - byteLength(prefix) - name.length - 6;
      let text = value;
      while (text.length > 0 && byteLength(cypherLiteral(text)) > room) {
        text = text.slice(0, Math.floor(text.length * 0.9));
      }
      return `n.${name} = ${cypherLiteral(text)}`;
    })
    .filter(
      (assignment) => byteLength(prefix) + byteLength(assignment) <= MAX_QUERY_BYTES
    );
  let batch: string[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    await runWrite(prefix + batch.join(", "));
    batch = [];
  };

  for (const assignment of assignments) {
    const candidate = [...batch, assignment];
    if (byteLength(prefix + candidate.join(", ")) > MAX_QUERY_BYTES) {
      await flush();
    }
    batch.push(assignment);
  }
  await flush();
}

/** Ensure the anchor node exists. HydraDB cannot write a lone node. */
async function ensureRoot(): Promise<number> {
  const rootId = rootGraphId();
  await runWrite(
    `MERGE (r:Root {id: ${rootId}})-[:ANCHORS]->(s:Root {id: ${rootId}, key: ${cypherLiteral(ROOT_KEY)}})`
  );
  return rootId;
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
  if (writesUnsupported) return null;

  try {
    const rootId = await ensureRoot();
    const graphId = graphIdFor(params.id);

    // Create (or find) the episode by hanging it off the root anchor — the only
    // write shape the server accepts.
    await runWrite(
      `MERGE (r:Root {id: ${rootId}})-[:CONTAINS]->(e:Episode {id: ${graphId}})`
    );

    await setProperties("Episode", graphId, {
      key: params.id,
      type: params.type,
      title: clip(params.title, MAX_TITLE_CHARS),
      content: clip(params.content, MAX_CONTENT_CHARS),
      source_type: params.sourceType,
      source_id: params.sourceId,
      app_name: params.appName ? clip(params.appName, 80) : null,
      window_name: params.windowName ? clip(params.windowName, 80) : null,
      salience: params.salience,
      created_at: params.createdAt,
      updated_at: nowIso(),
    });

    noteIngestSuccess();
    return params.id;
  } catch (err) {
    reportIngestFailure(err);
    return null;
  }
}

/** Chain an episode after its predecessor, for chronological traversal. */
export async function linkFollows(
  previousKey: string,
  nextKey: string
): Promise<void> {
  if (writesUnsupported || previousKey === nextKey) return;
  try {
    await runWrite(
      `MERGE (a:Episode {id: ${graphIdFor(previousKey)}})-[:FOLLOWS]->(b:Episode {id: ${graphIdFor(nextKey)}})`
    );
  } catch (err) {
    reportIngestFailure(err);
  }
}

async function upsertFact(params: {
  id: string;
  text: string;
  episodeId: string;
  createdAt: string;
}): Promise<void> {
  if (writesUnsupported) return;

  const factId = graphIdFor(params.id);
  const episodeId = graphIdFor(params.episodeId);
  const key = clip(params.text, 48).toLowerCase();

  try {
    // The fact hangs off its episode, which doubles as the RECORDED_AS edge.
    await runWrite(
      `MERGE (e:Episode {id: ${episodeId}})-[:RECORDED_AS]->(f:Fact {id: ${factId}})`
    );

    await setProperties("Fact", factId, {
      key: params.id,
      text: clip(params.text, MAX_CONTENT_CHARS),
      fact_key: key,
      current: true,
      valid_from: params.createdAt,
    });

    noteIngestSuccess();
  } catch (err) {
    reportIngestFailure(err);
  }
}

/**
 * Mark an earlier fact as replaced by a newer one.
 *
 * Superseding is what the graph exists for, so it is expressed explicitly
 * rather than inferred: the caller supplies the pair.
 */
export async function supersedeFact(
  oldKey: string,
  newKey: string,
  at: string
): Promise<void> {
  if (writesUnsupported || oldKey === newKey) return;
  try {
    const oldId = graphIdFor(oldKey);
    await runWrite(
      `MERGE (n:Fact {id: ${graphIdFor(newKey)}})-[:SUPERSEDES]->(o:Fact {id: ${oldId}})`
    );
    await setProperties("Fact", oldId, { current: false, valid_to: at });
  } catch (err) {
    reportIngestFailure(err);
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
  if (writesUnsupported) return null;
  const startedAt = params.startedAt ?? nowIso();

  try {
    const rootId = await ensureRoot();
    const sessionGraphId = graphIdFor(params.sessionId);

    await runWrite(
      `MERGE (r:Root {id: ${rootId}})-[:CONTAINS]->(s:Session {id: ${sessionGraphId}})`
    );
    await setProperties("Session", sessionGraphId, {
      key: params.sessionId,
      started_at: startedAt,
      turn_count: params.turns.length,
    });

    let previousKey: string | null = null;

    for (const [index, turn] of params.turns.entries()) {
      const text = turn.content.trim();
      if (!text) continue;

      const episodeKey = `${params.sessionId}_t${index}`;
      const stored = await upsertEpisode({
        id: episodeKey,
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
      if (!stored) continue;

      await runWrite(
        `MERGE (e:Episode {id: ${graphIdFor(episodeKey)}})-[:IN_SESSION]->(s:Session {id: ${sessionGraphId}})`
      );

      if (previousKey) await linkFollows(previousKey, episodeKey);
      previousKey = episodeKey;

      if (turn.role === "user") {
        await upsertFact({
          id: `fact_${episodeKey}`,
          text,
          episodeId: episodeKey,
          createdAt: startedAt,
        });
      }
    }

    noteIngestSuccess();
    return params.sessionId;
  } catch (err) {
    reportIngestFailure(err);
    return null;
  }
}
