import { getDb } from "../db/index.js";
import { BUILTIN_PIPES, type PipeId } from "./definitions.js";

export interface PipeStateRow {
  pipe_id: string;
  installed: number;
  enabled: number;
  last_run_at: string | null;
  last_run_status: string | null;
  updated_at: string;
}

export interface PipeRunRow {
  id: number;
  pipe_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  output: string | null;
  error: string | null;
  created_at: string;
}

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

function lastInsertId(): number {
  const row = getDb()
    .prepare(`SELECT last_insert_rowid() as id`)
    .get() as { id: number };
  return row.id;
}

export function initPipeState(): void {
  const db = getDb();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO pipe_state (pipe_id, installed, enabled) VALUES (?, ?, ?)`
  );
  for (const pipe of BUILTIN_PIPES) {
    insert.run(
      pipe.id,
      pipe.defaultInstalled ? 1 : 0,
      pipe.defaultEnabled ? 1 : 0
    );
  }
}

function getStateRow(pipeId: string): PipeStateRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM pipe_state WHERE pipe_id = ?`)
    .get(pipeId) as PipeStateRow | undefined;
  return row ?? null;
}

export function listPipes(runningIds: Set<string>): PipeListItem[] {
  initPipeState();
  return BUILTIN_PIPES.map((def) => {
    const state = getStateRow(def.id);
    return {
      id: def.id,
      name: def.name,
      description: def.description,
      schedule: def.schedule,
      installed: Boolean(state?.installed),
      enabled: Boolean(state?.enabled),
      last_run_at: state?.last_run_at ?? null,
      last_run_status: state?.last_run_status ?? null,
      running: runningIds.has(def.id),
    };
  });
}

export function setPipeInstalled(pipeId: string, installed: boolean): void {
  initPipeState();
  getDb()
    .prepare(
      `UPDATE pipe_state
       SET installed = ?, enabled = CASE WHEN ? = 0 THEN 0 ELSE enabled END, updated_at = datetime('now')
       WHERE pipe_id = ?`
    )
    .run(installed ? 1 : 0, installed ? 1 : 0, pipeId);
}

export function setPipeEnabled(pipeId: string, enabled: boolean): void {
  initPipeState();
  getDb()
    .prepare(
      `UPDATE pipe_state
       SET enabled = ?, installed = CASE WHEN ? = 1 THEN 1 ELSE installed END, updated_at = datetime('now')
       WHERE pipe_id = ?`
    )
    .run(enabled ? 1 : 0, enabled ? 1 : 0, pipeId);
}

export function createPipeRun(pipeId: string, startedAt: string): number {
  getDb()
    .prepare(
      `INSERT INTO pipe_runs (pipe_id, started_at, status) VALUES (?, ?, 'running')`
    )
    .run(pipeId, startedAt);
  return lastInsertId();
}

export function finishPipeRun(
  runId: number,
  params: { status: "ok" | "error"; output?: string; error?: string }
): void {
  const finishedAt = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE pipe_runs
       SET finished_at = ?, status = ?, output = ?, error = ?
       WHERE id = ?`
    )
    .run(
      finishedAt,
      params.status,
      params.output ?? null,
      params.error ?? null,
      runId
    );
}

export function updatePipeLastRun(
  pipeId: string,
  status: "ok" | "error",
  runAt: string
): void {
  getDb()
    .prepare(
      `UPDATE pipe_state
       SET last_run_at = ?, last_run_status = ?, updated_at = datetime('now')
       WHERE pipe_id = ?`
    )
    .run(runAt, status, pipeId);
}

export function listPipeRuns(pipeId: string, limit = 20): PipeRunRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM pipe_runs WHERE pipe_id = ? ORDER BY started_at DESC LIMIT ?`
    )
    .all(pipeId, limit) as PipeRunRow[];
}

export function listEnabledPipes(): Array<{ pipe_id: string; last_run_at: string | null }> {
  initPipeState();
  return getDb()
    .prepare(
      `SELECT pipe_id, last_run_at FROM pipe_state WHERE installed = 1 AND enabled = 1`
    )
    .all() as Array<{ pipe_id: string; last_run_at: string | null }>;
}
