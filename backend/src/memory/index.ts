import { getDb } from "../db/index.js";
import { buildGraphFromNeighbors, rowToMemoryNode } from "./adapter.js";
import { cypherLiteral, isHydraReachable, runCypher } from "./client.js";
import {
  ingestAudioChunk,
  ingestChatSession,
  ingestMeetingSummary,
  ingestScreenCapture,
  ingestUserMemory,
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

function containsClause(alias: string, field: string, query: string): string {
  const tokens = tokensFromQuery(query);
  if (tokens.length === 0) {
    return `toLower(${alias}.${field}) CONTAINS ${cypherLiteral(query.toLowerCase())}`;
  }
  return tokens
    .map((token) => `toLower(${alias}.${field}) CONTAINS ${cypherLiteral(token)}`)
    .join(" OR ");
}

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

    const currentFacts = await runCypher(`
      MATCH (f:Fact)
      WHERE f.current = true AND (${containsClause("f", "text", trimmed)})
      RETURN f.id AS id, f.text AS text, f.valid_from AS valid_from
      LIMIT 12
    `);

    const superseded = await runCypher(`
      MATCH (f:Fact)
      WHERE f.current = false AND (${containsClause("f", "text", trimmed)})
      RETURN f.id AS id, f.text AS text, f.valid_from AS valid_from, f.valid_to AS valid_to
      LIMIT 8
    `);

    for (const row of currentFacts) {
      const text = typeof row.text === "string" ? row.text : "";
      if (!text) continue;
      const when = typeof row.valid_from === "string" ? row.valid_from.slice(0, 10) : "";
      if (!push(`[current${when ? ` ${when}` : ""}] ${text}`, String(row.id ?? ""))) break;
    }

    for (const row of superseded) {
      const text = typeof row.text === "string" ? row.text : "";
      if (!text) continue;
      const from = typeof row.valid_from === "string" ? row.valid_from.slice(0, 10) : "";
      const to = typeof row.valid_to === "string" ? row.valid_to.slice(0, 10) : "";
      if (
        !push(
          `[superseded${from ? ` ${from}` : ""}${to ? ` → ${to}` : ""}] ${text} (later replaced; do not treat as current)`,
          String(row.id ?? "")
        )
      ) {
        break;
      }
    }

    const episodes = await runCypher(`
      MATCH (e:Episode)
      WHERE ${containsClause("e", "content", trimmed)}
      RETURN e
      LIMIT 8
    `);

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

  for (const row of ocrRows) {
    if (
      await ingestScreenCapture({
        frameId: row.frame_id,
        text: row.text,
        appName: row.app_name,
        windowName: row.window_name,
        timestamp: row.timestamp,
      })
    ) {
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

  for (const row of audioRows) {
    if (
      await ingestAudioChunk({
        audioId: row.id,
        transcription: row.transcription,
        meetingId: row.meeting_id,
        timestamp: row.timestamp,
      })
    ) {
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
      RETURN f.text AS text
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
    const where = [
      params.q?.trim() ? containsClause("e", "content", params.q) : null,
      params.type ? `e.type = ${cypherLiteral(params.type)}` : null,
    ]
      .filter(Boolean)
      .join(" AND ");

    const rows = await runCypher(`
      MATCH (e:Episode)
      ${where ? `WHERE ${where}` : ""}
      RETURN e
      ORDER BY e.created_at DESC
      LIMIT ${limit}
    `);

    const data = rows
      .map((row) => rowToMemoryNode(row))
      .filter((node): node is MemoryNode => Boolean(node));

    const countRows = await runCypher(`
      MATCH (e:Episode)
      ${where ? `WHERE ${where}` : ""}
      RETURN count(e) AS total
    `);
    const total =
      typeof countRows[0]?.total === "number" ? countRows[0].total : data.length;

    return { data, total };
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
      MATCH (e:Episode {id: ${cypherLiteral(id)}})
      RETURN e
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

    const rows = await runCypher(`
      MATCH (e:Episode {id: ${cypherLiteral(id)}})-[r]-(n)
      RETURN type(r) AS relation, n
      LIMIT 24
    `);

    const neighbors = rows
      .map((row) => {
        const neighbor = rowToMemoryNode({ n: row.n, e: row.n });
        if (!neighbor) return null;
        return {
          relation: typeof row.relation === "string" ? row.relation : "RELATED_TO",
          neighbor,
        };
      })
      .filter((item): item is { relation: string; neighbor: MemoryNode } => Boolean(item));

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
    const typeRows = await runCypher(`
      MATCH (e:Episode)
      RETURN e.type AS type, count(*) AS total
    `);
    const edgeRows = await runCypher(`
      MATCH ()-[r]->()
      RETURN count(r) AS total
    `);

    const by_type: Record<string, number> = {};
    let nodes = 0;
    for (const row of typeRows) {
      const type = typeof row.type === "string" ? row.type : "memory";
      const total = typeof row.total === "number" ? row.total : 0;
      by_type[type] = total;
      nodes += total;
    }

    return {
      nodes,
      edges: typeof edgeRows[0]?.total === "number" ? edgeRows[0].total : 0,
      by_type,
    };
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
