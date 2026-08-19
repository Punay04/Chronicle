import { Composio } from "@composio/core";
import {
  COMPOSIO_API_KEY,
  COMPOSIO_ENABLED,
  COMPOSIO_USER_ID,
  TOOLKITS,
  getToolkit,
  type ToolkitConfig,
} from "./config.js";

/**
 * Thin wrapper around the Composio SDK for Chronicle's connectors.
 *
 * Composio is the source of truth for auth + tool execution. It hosts the OAuth
 * redirect URI, so the app only needs to open the returned auth URL and poll for
 * connection status — no custom deep-link handler or local callback server.
 */

let client: Composio | null = null;

function getClient(): Composio {
  if (!COMPOSIO_ENABLED) {
    throw new Error(
      "COMPOSIO_API_KEY is not set. Add it to the project .env file to enable connectors."
    );
  }
  if (!client) {
    client = new Composio({ apiKey: COMPOSIO_API_KEY });
  }
  return client;
}

const ACTIVE = "ACTIVE";

export interface ConnectionInfo {
  toolkit: string;
  name: string;
  connected: boolean;
  status: string | null;
  connectedAccountId: string | null;
  /** true when this toolkit has an auth config id configured in env */
  configured: boolean;
}

/**
 * List the status of every supported toolkit for the local user. Never throws for
 * an individual toolkit — a failure surfaces as `status: "ERROR"` so the UI can
 * still render the rest of the list.
 */
export async function listConnections(): Promise<ConnectionInfo[]> {
  const composio = getClient();

  let accounts: Awaited<ReturnType<typeof composio.connectedAccounts.list>> | null =
    null;
  try {
    accounts = await composio.connectedAccounts.list({
      userIds: [COMPOSIO_USER_ID],
    });
  } catch {
    accounts = null;
  }

  const items = accounts?.items ?? [];

  return TOOLKITS.map((tk) => {
    // newest-first: the API returns most recent first, so the first match wins
    const match = items.find(
      (a) => a.toolkit?.slug?.toLowerCase() === tk.slug
    );
    return {
      toolkit: tk.slug,
      name: tk.label,
      connected: match?.status === ACTIVE,
      status: match?.status ?? null,
      connectedAccountId: match?.id ?? null,
      // With Composio-managed auth we can always connect using just the API key.
      configured: true,
    };
  });
}

/** Cache of resolved auth-config ids per toolkit (per process). */
const authConfigCache = new Map<string, string>();

/**
 * Resolve the auth-config id to use for a toolkit, requiring only the Composio
 * API key. Order: explicit env override → an existing Composio-managed auth config
 * → a freshly created managed one. Uses Composio's shared OAuth apps, so the user
 * never has to register their own client credentials.
 */
async function resolveAuthConfigId(tk: ToolkitConfig): Promise<string> {
  if (tk.authConfigId) return tk.authConfigId;

  const cached = authConfigCache.get(tk.slug);
  if (cached) return cached;

  const composio = getClient();

  // Reuse an existing managed auth config for this toolkit if one already exists.
  try {
    const existing = await composio.authConfigs.list({
      toolkit: tk.slug,
      isComposioManaged: true,
    });
    const found = existing.items.find(
      (item) => item.toolkit?.slug?.toLowerCase() === tk.slug
    );
    if (found) {
      authConfigCache.set(tk.slug, found.id);
      return found.id;
    }
  } catch {
    // fall through to creation
  }

  const created = await composio.authConfigs.create(tk.slug, {
    type: "use_composio_managed_auth",
    name: `chronicle-${tk.slug}`,
  });
  authConfigCache.set(tk.slug, created.id);
  return created.id;
}

export interface InitiateResult {
  redirectUrl: string | null;
  connectedAccountId: string;
}

/** Start an OAuth connection for a toolkit; returns the hosted auth URL to open. */
export async function initiateConnection(
  toolkitSlug: string
): Promise<InitiateResult> {
  const tk = getToolkit(toolkitSlug);
  if (!tk) throw new Error(`Unknown toolkit "${toolkitSlug}".`);
  const authConfigId = await resolveAuthConfigId(tk);

  const composio = getClient();
  // Composio-managed OAuth uses `link()`; `initiate()` was retired for managed
  // auth configs (see composio changelog 2026/04/24). `link` returns the same
  // { id, redirectUrl } shape.
  const request = await composio.connectedAccounts.link(
    COMPOSIO_USER_ID,
    authConfigId
  );

  return {
    redirectUrl: request.redirectUrl ?? null,
    connectedAccountId: request.id,
  };
}

/** Poll the status of a pending/active connection (used after OAuth redirect). */
export async function connectionStatus(
  connectedAccountId: string
): Promise<{ status: string; connected: boolean }> {
  const composio = getClient();
  const account = await composio.connectedAccounts.get(connectedAccountId);
  return { status: account.status, connected: account.status === ACTIVE };
}

/** Remove a connected account (disconnect). */
export async function disconnect(connectedAccountId: string): Promise<void> {
  const composio = getClient();
  await composio.connectedAccounts.delete(connectedAccountId);
}

/* ------------------------------------------------------------------ *
 * Chat tool-calling
 * ------------------------------------------------------------------ */

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * Gemini's function-calling schema is a strict subset of JSON schema. Composio
 * tool schemas include keys Gemini rejects (`$defs`, `additionalProperties`,
 * `default`, `title`, etc.); recursively strip them.
 */
function sanitizeSchema(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") {
    return { type: "object", properties: {} };
  }
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const allowed = [
    "type",
    "description",
    "enum",
    "items",
    "properties",
    "required",
    "nullable",
    "format",
  ];
  for (const key of allowed) {
    if (!(key in src)) continue;
    const value = src[key];
    if (key === "properties" && value && typeof value === "object") {
      const props: Record<string, unknown> = {};
      for (const [name, schema] of Object.entries(value)) {
        props[name] = sanitizeSchema(schema);
      }
      out.properties = props;
    } else if (key === "items") {
      out.items = sanitizeSchema(value);
    } else {
      out[key] = value;
    }
  }
  if (!out.type) out.type = "object";
  if (out.type === "object" && !out.properties) out.properties = {};
  return out;
}

/**
 * Fetch Composio tools for the given active toolkits and convert them into Gemini
 * `functionDeclaration`s. Returns an empty list if nothing is connected or Composio
 * is not configured (so chat behaves exactly as before).
 */
export async function getGeminiTools(
  activeToolkits: string[]
): Promise<GeminiFunctionDeclaration[]> {
  if (!COMPOSIO_ENABLED || activeToolkits.length === 0) return [];

  const composio = getClient();
  const declarations: GeminiFunctionDeclaration[] = [];

  for (const slug of activeToolkits) {
    const tk = getToolkit(slug);
    if (!tk || tk.tools.length === 0) continue;
    try {
      // Fetch the curated allowlist explicitly — fetching by `limit` alone returns
      // tools alphabetically and would drop the important read/fetch tools.
      const tools = await composio.tools.getRawComposioTools({
        tools: tk.tools,
      });
      for (const tool of tools) {
        declarations.push({
          name: tool.slug,
          description: (tool.description ?? tool.name).slice(0, 1024),
          parameters: sanitizeSchema(tool.inputParameters),
        });
      }
    } catch {
      // skip a toolkit whose tools can't be loaded rather than failing chat
    }
  }

  return declarations;
}

/** Execute a Composio tool by slug on behalf of the local user. */
export async function executeTool(
  slug: string,
  args: Record<string, unknown>
): Promise<{ successful: boolean; data: unknown; error: string | null }> {
  const composio = getClient();
  const result = await composio.tools.execute(slug, {
    userId: COMPOSIO_USER_ID,
    arguments: args,
    // Use the latest toolkit version; without this Composio throws
    // ComposioToolVersionRequiredError on execute.
    version: "latest",
    dangerouslySkipVersionCheck: true,
  });
  return {
    successful: result.successful,
    data: result.data,
    error: result.error,
  };
}
