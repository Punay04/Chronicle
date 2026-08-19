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

function unwrapRows(payload: unknown): CypherRow[] {
  if (!payload || typeof payload !== "object") return [];
  const body = payload as Record<string, unknown>;
  const candidates = [body.rows, body.data, body.results, body.result];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.map((row) => {
        if (row && typeof row === "object" && !Array.isArray(row)) {
          return row as CypherRow;
        }
        return { value: row };
      });
    }
  }
  if (Array.isArray(payload)) {
    return payload as CypherRow[];
  }
  return [body];
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
    const message =
      typeof payload === "object" && payload && "error" in payload
        ? String((payload as { error: unknown }).error)
        : text || `HydraDB query failed (${response.status})`;
    throw new Error(message);
  }

  return unwrapRows(payload);
}

export function resetHydraClient(): void {
  // HTTP client is stateless.
}
