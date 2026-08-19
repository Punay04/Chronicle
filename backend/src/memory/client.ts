import { existsSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import {
  HYDRADB_ADMIN_URL,
  HYDRADB_AUTH_TOKEN,
  HYDRADB_CELL_ID,
  HYDRADB_GRAPH_ID,
  HYDRADB_HTTP_URL,
  HYDRADB_NAMESPACE,
} from "../config.js";

export interface CypherRow {
  [key: string]: unknown;
}

/**
 * A non-2xx response from HydraDB.
 *
 * The server reports failures as `{"error": {"code": ..., "message": ...}}`.
 * That object used to be flattened with String(), which produced the useless
 * "[object Object]" — pull the fields out properly instead.
 */
export class HydraQueryError extends Error {
  readonly status: number;
  readonly code: string | null;
  /** The query that failed, truncated — the message alone rarely locates it. */
  readonly query: string;

  constructor(status: number, payload: unknown, rawText: string, query = "") {
    const detail =
      payload && typeof payload === "object" && "error" in payload
        ? (payload as { error: unknown }).error
        : null;

    let message: string;
    let code: string | null = null;

    if (detail && typeof detail === "object") {
      const asRecord = detail as { code?: unknown; message?: unknown };
      code = typeof asRecord.code === "string" ? asRecord.code : null;
      message =
        typeof asRecord.message === "string"
          ? asRecord.message
          : JSON.stringify(detail);
    } else if (typeof detail === "string") {
      message = detail;
    } else {
      message = rawText || `HydraDB query failed (${status})`;
    }

    super(message);
    this.name = "HydraQueryError";
    this.status = status;
    this.code = code;
    this.query = query.length > 220 ? `${query.slice(0, 220)}…` : query;
  }

  /** True when the server understood the request but cannot execute that Cypher. */
  get isUnsupported(): boolean {
    return this.message.includes("is not supported yet");
  }
}

function readTokenFromDataDir(): string | undefined {
  const candidates = [
    path.join(os.homedir(), ".chronicle", "hydradb", "auth-token"),
    path.join(process.cwd(), ".hydradb", "auth-token"),
  ];
  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    const value = readFileSync(filePath, "utf8").trim();
    if (value) return value;
  }
  return undefined;
}

export function getHydraAuthToken(): string {
  return (
    HYDRADB_AUTH_TOKEN ||
    readTokenFromDataDir() ||
    "local-development-token-32-bytes"
  );
}

export function cypherLiteral(value: string | number | boolean | null): string {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/**
 * Unwrap one typed cell.
 *
 * The server returns every value as `{"type": "...", "value": ...}` — for
 * example `{"type":"string","value":"hi"}` or `{"type":"null"}`.
 */
function unwrapCell(cell: unknown): unknown {
  if (!cell || typeof cell !== "object") return cell;
  const typed = cell as { type?: unknown; value?: unknown };
  if (typeof typed.type !== "string") return cell;
  if (typed.type === "null") return null;
  return "value" in typed ? typed.value : null;
}

/**
 * Turn a HydraDB response into row objects keyed by column name.
 *
 * Responses are column-oriented: `{"columns": ["n.id"], "rows": [[cell], ...]}`.
 * Each row is a positional array, so it has to be zipped against `columns`.
 * Column names keep their Cypher form (`n.id`), so they are also exposed under
 * the bare property name (`id`) for convenience.
 */
function unwrapRows(payload: unknown): CypherRow[] {
  if (!payload || typeof payload !== "object") return [];
  const body = payload as Record<string, unknown>;

  const rows = body.rows;
  if (!Array.isArray(rows)) return [];

  const columns = Array.isArray(body.columns)
    ? body.columns.map((c) => (typeof c === "string" ? c : String(c)))
    : [];

  return rows.map((row) => {
    const out: CypherRow = {};
    const cells = Array.isArray(row) ? row : [row];
    cells.forEach((cell, index) => {
      const column = columns[index] ?? `col${index}`;
      const value = unwrapCell(cell);
      out[column] = value;
      // "n.id" -> also reachable as "id"; "count(*)" -> "count".
      const bare = column.includes(".")
        ? column.slice(column.lastIndexOf(".") + 1)
        : column.replace(/\(.*\)$/, "");
      if (bare && !(bare in out)) out[bare] = value;
    });
    return out;
  });
}

export async function isHydraReachable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    const response = await fetch(`${HYDRADB_ADMIN_URL.replace(/\/$/, "")}/readyz`, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timer);
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

export async function runCypher(query: string): Promise<CypherRow[]> {
  const url = `${HYDRADB_HTTP_URL.replace(/\/$/, "")}/v1/graphs/${encodeURIComponent(HYDRADB_GRAPH_ID)}/query`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getHydraAuthToken()}`,
      "X-Graph-Namespace": HYDRADB_NAMESPACE,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      cell_id: HYDRADB_CELL_ID,
      query,
    }),
  });

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = { raw: text };
    }
  }

  if (!response.ok) {
    throw new HydraQueryError(response.status, payload, text, query);
  }

  return unwrapRows(payload);
}

export function resetHydraClient(): void {
  // HTTP client is stateless.
}
