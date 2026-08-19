import { getDb } from "../db/index.js";

/**
 * HydraDB requires every node's `id` property to be an integer, while Chronicle
 * identifies memories by string keys ("frame_12", "fact_meeting_3"). This module
 * owns the mapping.
 *
 * The mapping lives in SQLite rather than being a hash, so it is exact (no
 * collisions) and reversible. The string key is *also* written onto the graph
 * node as `key`, so reads can recover it without a second lookup.
 */

/**
 * The anchor node every episode hangs off.
 *
 * HydraDB cannot write an isolated node — a write must be a one-hop edge
 * pattern ("MERGE requires destination id") — so new episodes are attached to
 * this root. Its id is allocated through the same table as everything else, so
 * it can never collide with a real key.
 */
export const ROOT_KEY = "__root__";

export function rootGraphId(): number {
  return graphIdFor(ROOT_KEY);
}

const cache = new Map<string, number>();

/** Stable integer id for a memory key, allocating one on first use. */
export function graphIdFor(key: string): number {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const db = getDb();
  db.prepare(`INSERT OR IGNORE INTO graph_ids (key) VALUES (?)`).run(key);
  const row = db
    .prepare(`SELECT graph_id FROM graph_ids WHERE key = ?`)
    .get(key) as { graph_id: number } | undefined;

  if (!row) throw new Error(`could not allocate a graph id for "${key}"`);
  cache.set(key, row.graph_id);
  return row.graph_id;
}

/** Reverse lookup, for turning query results back into memory keys. */
export function keyForGraphId(graphId: number): string | null {
  const row = getDb()
    .prepare(`SELECT key FROM graph_ids WHERE graph_id = ?`)
    .get(graphId) as { key: string } | undefined;
  return row?.key ?? null;
}

export function resetGraphIdCache(): void {
  cache.clear();
}
