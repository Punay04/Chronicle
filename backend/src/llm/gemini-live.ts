import {
  GEMINI_API_KEY,
  GEMINI_LIVE_MODEL,
  GEMINI_LIVE_VOICE,
} from "../config.js";

const AUTH_TOKENS_URL =
  "https://generativelanguage.googleapis.com/v1alpha/auth_tokens";

/** Same Live model Snappy uses. */
export const DEFAULT_LIVE_MODEL = "models/gemini-3.1-flash-live-preview";

export interface LiveTokenResult {
  token: string;
  model: string;
  voice: string;
}

/**
 * Mint a short-lived Gemini Live ephemeral token (v1alpha), matching Snappy's
 * `/gemini-live-token` flow. The client opens
 * `BidiGenerateContentConstrained?access_token=…` directly.
 */
export async function mintGeminiLiveToken(
  systemInstruction: string
): Promise<LiveTokenResult> {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to the project .env file."
    );
  }

  const model = GEMINI_LIVE_MODEL.startsWith("models/")
    ? GEMINI_LIVE_MODEL
    : `models/${GEMINI_LIVE_MODEL}`;

  const now = Date.now();
  const expireTime = new Date(now + 30 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(now + 2 * 60 * 1000).toISOString();

  const authTokenBody = {
    uses: 1,
    expireTime,
    newSessionExpireTime,
    // Lock system instruction in the token; client setup owns voice / modalities.
    fieldMask: "systemInstruction",
    bidiGenerateContentSetup: {
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },
    },
  };

  const res = await fetch(
    `${AUTH_TOKENS_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(authTokenBody),
    }
  );

  const payload = (await res.json()) as {
    name?: string;
    error?: { message?: string };
  };

  if (!res.ok) {
    throw new Error(
      payload.error?.message ??
        `Gemini Live auth token failed (${res.status})`
    );
  }

  const token = typeof payload.name === "string" ? payload.name : "";
  if (!token) {
    throw new Error("Gemini authTokens response missing name field");
  }

  return {
    token,
    model,
    voice: GEMINI_LIVE_VOICE,
  };
}

export function getLiveModelInfo(): { model: string; voice: string } {
  const model = GEMINI_LIVE_MODEL.startsWith("models/")
    ? GEMINI_LIVE_MODEL
    : `models/${GEMINI_LIVE_MODEL}`;
  return { model, voice: GEMINI_LIVE_VOICE };
}

export { DEFAULT_LIVE_MODEL as LIVE_MODEL_FALLBACK };
