import { getDb } from "../db/index.js";
import { buildGraphFromNeighbors, rowToMemoryNode } from "./adapter.js";
import { cypherLiteral, isHydraReachable, runCypher } from "./client.js";
import { graphIdFor } from "./graph-ids.js";
import {
  ingestAudioChunk,
  ingestChatSession,
  ingestMeetingSummary,
  ingestScreenCapture,
  ingestUserMemory,
  linkFollows,
} from "./ingest.js";
import type { MemoryGraph, MemoryNode, MemoryStats } from "./types.js";

let initialized = false;

export function initMemory(): void {
  initialized = true;
}

export function isMemoryInitialized(): boolean {
  return initialized;
}

function tokensFromQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4)
    .slice(0, 6);
}

/**
 * Match text against a query in JavaScript.
 *
 * The graph-node's WHERE clause only supports equality and boolean tests —
 * neither CONTAINS nor toLower() is implemented — so candidate rows are fetched
 * with a bounded LIMIT and filtered here instead.
 */
function matchesQuery(text: string, query: string): boolean {
  const haystack = text.toLowerCase();
  const tokens = tokensFromQuery(query);
  if (tokens.length === 0) return haystack.includes(query.trim().toLowerCase());
  return tokens.some((token) => haystack.includes(token));
}

/** Columns that reconstruct an Episode, since "RETURN e" is not supported. */
const EPISODE_COLUMNS =
  "e.key, e.type, e.title, e.content, e.source_type, e.source_id, " +
  "e.app_name, e.window_name, e.salience, e.created_at, e.updated_at";

/** How many rows to pull before filtering locally. */
const SCAN_LIMIT = 400;

/** Episode types counted for stats, mirroring MemoryNodeType. */
const EPISODE_TYPES = [
  "screen_chunk",
  "audio_chunk",
  "meeting",
  "memory",
  "session_turn",
  "app",
  "task",
  "topic",
  "document",
] as const;

export async function retrieveContextForChat(
  query: string,
  charBudget = 24_000
): Promise<{ snippets: string[]; nodeIds: string[] }> {
  initMemory();

  if (!(await isHydraReachable())) {
    return { snippets: [], nodeIds: [] };
  }

  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return { snippets: [], nodeIds: [] };
  }

  try {
    const snippets: string[] = [];
    const nodeIds: string[] = [];
    let budget = 0;

    const push = (snippet: string, id?: string) => {
      if (budget + snippet.length > charBudget) return false;
      snippets.push(snippet);
      if (id) nodeIds.push(id);
      budget += snippet.length;
      return true;
    };

    const factText = (row: Record<string, unknown>) =>
      typeof row.text === "string" ? row.text : "";

    const currentFacts = (
      await runCypher(`
      MATCH (f:Fact)
      WHERE f.current = true
      RETURN f.key, f.text, f.valid_from
      ORDER BY f.valid_from DESC
      LIMIT ${SCAN_LIMIT}
    `)
    )
      .filter((row) => matchesQuery(factText(row), trimmed))
      .slice(0, 12);

    const superseded = (
      await runCypher(`
      MATCH (f:Fact)
      WHERE f.current = false
      RETURN f.key, f.text, f.valid_from, f.valid_to
      ORDER BY f.valid_from DESC
      LIMIT ${SCAN_LIMIT}
    `)
    )
      .filter((row) => matchesQuery(factText(row), trimmed))
      .slice(0, 8);

    for (const row of currentFacts) {
      const text = typeof row.text === "string" ? row.text : "";
      if (!text) continue;
      const when = typeof row.valid_from === "string" ? row.valid_from.slice(0, 10) : "";
      if (!push(`[current${when ? ` ${when}` : ""}] ${text}`, String(row.key ?? ""))) break;
    }

    for (const row of superseded) {
      const text = typeof row.text === "string" ? row.text : "";
      if (!text) continue;
      const from = typeof row.valid_from === "string" ? row.valid_from.slice(0, 10) : "";
      const to = typeof row.valid_to === "string" ? row.valid_to.slice(0, 10) : "";
      if (
        !push(
          `[superseded${from ? ` ${from}` : ""}${to ? ` → ${to}` : ""}] ${text} (later replaced; do not treat as current)`,
          String(row.key ?? "")
        )
      ) {
        break;
      }
    }

    const episodes = (
      await runCypher(`
      MATCH (e:Episode)
      RETURN ${EPISODE_COLUMNS}
      ORDER BY e.created_at DESC
      LIMIT ${SCAN_LIMIT}
    `)
    )
      .filter((row) =>
        matchesQuery(
          `${typeof row.content === "string" ? row.content : ""} ${typeof row.title === "string" ? row.title : ""}`,
          trimmed
        )
      )
      .slice(0, 8);

    for (const row of episodes) {
      const node = rowToMemoryNode(row);
      if (!node?.content) continue;
      const snippet = formatNodeSnippet(node);
      if (!push(snippet, node.id)) break;
    }

    if (snippets.length === 0) {
      push(
        "[abstain] No matching current fact or episode was found in the graph. If the question depends on stored personal history, say you do not know. Do not invent an answer."
      );
    }

    return { snippets, nodeIds };
  } catch (err) {
    console.warn("[hydradb] retrieveContextForChat failed:", err);
    return { snippets: [], nodeIds: [] };
  }
}

export async function backfillMemory(): Promise<{ ingested: number }> {
  initMemory();

  if (!(await isHydraReachable())) {
    console.warn(
      "[hydradb] graph node not reachable at startup — run `npm run memory:start`"
    );
    return { ingested: 0 };
  }

  let ingested = 0;

  const ocrRows = getDb()
    .prepare(
      `SELECT o.frame_id, o.text, f.app_name, f.window_name, f.timestamp
       FROM ocr_text o
       JOIN frames f ON f.id = o.frame_id
       ORDER BY f.timestamp ASC
       LIMIT 500`
    )
    .all() as Array<{
    frame_id: number;
    text: string;
    app_name: string | null;
    window_name: string | null;
    timestamp: string;
  }>;

  // Rows arrive in timestamp order, so chaining each to its predecessor builds
  // the FOLLOWS spine the graph is traversed by.
  let previousKey: string | null = null;

  for (const row of ocrRows) {
    const key = await ingestScreenCapture({
      frameId: row.frame_id,
      text: row.text,
      appName: row.app_name,
      windowName: row.window_name,
      timestamp: row.timestamp,
    });
    if (key) {
      if (previousKey) await linkFollows(previousKey, key);
      previousKey = key;
      ingested++;
    }
  }

  const audioRows = getDb()
    .prepare(
      `SELECT id, transcription, meeting_id, timestamp
       FROM audio_transcriptions
       WHERE length(trim(transcription)) > 0
       ORDER BY timestamp ASC
       LIMIT 500`
    )
    .all() as Array<{
    id: number;
    transcription: string;
    meeting_id: number | null;
    timestamp: string;
  }>;

  let previousAudioKey: string | null = null;

  for (const row of audioRows) {
    const key = await ingestAudioChunk({
      audioId: row.id,
      transcription: row.transcription,
      meetingId: row.meeting_id,
      timestamp: row.timestamp,
    });
    if (key) {
      if (previousAudioKey) await linkFollows(previousAudioKey, key);
      previousAudioKey = key;
      ingested++;
    }
  }

  return { ingested };
}

export async function getUserProfile(): Promise<{
  persona: string[];
  aims: string[];
}> {
  initMemory();

  if (!(await isHydraReachable())) {
    return { persona: [], aims: [] };
  }

  try {
    const rows = await runCypher(`
      MATCH (f:Fact)
      WHERE f.current = true
      RETURN f.text
      ORDER BY f.valid_from DESC
      LIMIT 24
    `);
    const persona = rows
      .map((row) => (typeof row.text === "string" ? row.text.trim() : ""))
      .filter(Boolean);
    return { persona, aims: [] };
  } catch (err) {
    console.warn("[hydradb] getUserProfile failed:", err);
    return { persona: [], aims: [] };
  }
}

export async function listNodes(params: {
  q?: string;
  type?: string;
  limit?: number;
  offset?: number;
}): Promise<{ data: MemoryNode[]; total: number }> {
  initMemory();
  const limit = params.limit ?? 50;

  if (!(await isHydraReachable())) {
    return { data: [], total: 0 };
  }

  try {
    // The server cannot filter on text, so scan recent episodes and narrow here.
    const rows = await runCypher(`
      MATCH (e:Episode)
      RETURN ${EPISODE_COLUMNS}
      ORDER BY e.created_at DESC
      LIMIT ${SCAN_LIMIT}
    `);

    const query = params.q?.trim();
    const matched = rows
      .map((row) => rowToMemoryNode(row))
      .filter((node): node is MemoryNode => Boolean(node))
      .filter((node) => !params.type || node.type === params.type)
      .filter(
        (node) => !query || matchesQuery(`${node.content} ${node.title ?? ""}`, query)
      );

    return { data: matched.slice(0, limit), total: matched.length };
  } catch (err) {
    console.warn("[hydradb] listNodes failed:", err);
    return { data: [], total: 0 };
  }
}

export async function getNode(id: string): Promise<MemoryNode | null> {
  initMemory();
  if (!(await isHydraReachable())) return null;

  try {
    const rows = await runCypher(`
      MATCH (e:Episode {id: ${graphIdFor(id)}})
      RETURN ${EPISODE_COLUMNS}
      LIMIT 1
    `);
    return rows[0] ? rowToMemoryNode(rows[0]) : null;
  } catch {
    return null;
  }
}

export async function getNodeGraph(
  id: string,
  _hops = 2
): Promise<MemoryGraph | null> {
  initMemory();
  if (!(await isHydraReachable())) return null;

  try {
    const node = await getNode(id);
    if (!node) return null;

    // `type(r)` is not projectable, so each relationship is queried by name and
    // the label is supplied locally.
    const graphId = graphIdFor(id);
    const neighbors: Array<{ relation: string; neighbor: MemoryNode }> = [];

    const collect = async (relation: string, pattern: string) => {
      try {
        const rows = await runCypher(`
          MATCH ${pattern}
          RETURN n.key, n.type, n.title, n.content, n.created_at, n.salience
          LIMIT 12
        `);
        for (const row of rows) {
          const neighbor = rowToMemoryNode(row);
          if (neighbor) neighbors.push({ relation, neighbor });
        }
      } catch {
        // A relationship type that has never been written yet.
      }
    };

    await collect("FOLLOWS", `(e:Episode {id: ${graphId}})-[:FOLLOWS]->(n:Episode)`);
    await collect("FOLLOWS", `(n:Episode)-[:FOLLOWS]->(e:Episode {id: ${graphId}})`);
    await collect("RECORDED_AS", `(e:Episode {id: ${graphId}})-[:RECORDED_AS]->(n:Fact)`);
    await collect("IN_SESSION", `(e:Episode {id: ${graphId}})-[:IN_SESSION]->(n:Session)`);

    return buildGraphFromNeighbors(node, neighbors);
  } catch {
    const node = await getNode(id);
    return node ? { node, edges: [] } : null;
  }
}

export async function getMemoryStats(): Promise<MemoryStats> {
  initMemory();

  if (!(await isHydraReachable())) {
    return { nodes: 0, edges: 0, by_type: {} };
  }

  try {
    const readCount = (rows: Array<Record<string, unknown>>): number => {
      const value = rows[0]?.["count(*)"] ?? rows[0]?.count;
      return typeof value === "number" ? value : 0;
    };

    // Grouped aggregation (RETURN e.type, count(*)) is unsupported, but an
    // equality filter is — so count each type with its own query rather than
    // tallying a truncated scan.
    const by_type: Record<string, number> = {};
    for (const type of EPISODE_TYPES) {
      const total = readCount(
        await runCypher(
          `MATCH (e:Episode) WHERE e.type = ${cypherLiteral(type)} RETURN count(*)`
        )
      );
      if (total > 0) by_type[type] = total;
    }

    const nodes = readCount(await runCypher(`MATCH (e:Episode) RETURN count(*)`));

    const edges = readCount(
      await runCypher(`MATCH (a:Episode)-[:FOLLOWS]->(b:Episode) RETURN count(*)`)
    );

    return { nodes, edges, by_type };
  } catch {
    return { nodes: 0, edges: 0, by_type: {} };
  }
}

export function formatNodeSnippet(node: MemoryNode): string {
  const label =
    node.type === "screen_chunk"
      ? "[screen]"
      : node.type === "audio_chunk"
        ? "[audio]"
        : node.type === "meeting"
          ? "[meeting]"
          : node.type === "session_turn"
            ? "[session]"
            : node.type === "memory"
              ? "[memory]"
              : `[${node.type}]`;

  const parts = [
    label,
    node.app_name ? `[${node.app_name}]` : null,
    node.window_name ? `"${node.window_name}"` : null,
    node.content.slice(0, 1500),
  ].filter(Boolean);

  return parts.join(" ");
}

export {
  ingestScreenCapture,
  ingestAudioChunk,
  ingestMeetingSummary,
  ingestUserMemory,
  ingestChatSession,
};

export type {
  MemoryNode,
  MemoryEdge,
  MemoryGraph,
  MemoryNodeType,
  MemoryRelation,
  MemorySearchResult,
  MemoryStats,
} from "./types.js";
