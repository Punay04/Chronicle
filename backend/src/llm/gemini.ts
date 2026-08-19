import fs from "fs";
import { GEMINI_API_KEY, GEMINI_MODEL } from "../config.js";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface RecordingStatus {
  screenRecording: boolean;
  framesCaptured: number;
  audioRecording: boolean;
  audioChunks: number;
}

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Executes a tool the model requested and returns a JSON-serializable result. */
export type ToolExecutor = (
  name: string,
  args: Record<string, unknown>
) => Promise<unknown>;

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: string;
  parts: GeminiPart[];
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { role?: string; parts?: GeminiPart[] };
  }>;
  error?: { message?: string };
}

export function buildSystemInstruction(
  contextSnippets: string[],
  recording: RecordingStatus,
  hasTools = false,
  options: { voice?: boolean } = {}
): string {
  const hasHistory = contextSnippets.length > 0;
  const statusLines = [
    `Screen recording: ${recording.screenRecording ? "active" : "paused/off"} (${recording.framesCaptured} frames in database)`,
    `Audio recording: ${recording.audioRecording ? "active" : "off"} (${recording.audioChunks} transcriptions stored)`,
    `Captured history snippets attached: ${contextSnippets.length}`,
  ].join("\n");

  const voiceContextBlock =
    options.voice && hasHistory
      ? [
          "",
          "HydraDB memory context (use this when answering):",
          ...contextSnippets.map((snippet, i) => `${i + 1}. ${snippet}`),
        ].join("\n")
      : "";

  return [
    "You are Chronicle, a helpful AI assistant inside a desktop app that records the user's screen and audio locally.",
    "Your long-term memory is a local HydraDB property graph of episodes, current facts, and superseded facts.",
    "Answer clearly and concisely. Use lowercase, friendly tone unless the user prefers otherwise.",
    options.voice
      ? "You are in live voice mode. Keep spoken replies short and natural — a few sentences unless the user asks for detail. Do not read markdown or bullet markers aloud."
      : "",
    "CRITICAL RULES:",
    "- HydraDB history is provided in this conversation (not live video). You already have it.",
    "- Prefer [current] facts over [superseded] facts. Superseded facts were true earlier and must not be treated as still true.",
    "- If a snippet is tagged [abstain], or nothing in the graph answers the question, say you do not know. Do not invent personal history.",
    "- NEVER say you can only answer if recording is enabled. NEVER offer to turn on recording when frames exist in the database or history snippets are provided.",
    "- NEVER say you don't have screen history when history snippets are in the conversation.",
    "- If the user asks about something not in the history, say what you DO see in the history instead. If you see nothing relevant, abstain.",
    "- If the user asks what they were watching or doing, answer from the history snippets directly.",
    "- Related memories may be linked in the graph (same app, meeting, or topic) — use those connections when helpful.",
    `Current capture status:\n${statusLines}`,
    hasHistory
      ? options.voice
        ? "History snippets are included below — use them."
        : "History snippets are in the messages below — use them."
      : recording.framesCaptured > 0
        ? "Frames exist but no readable text was extracted from recent captures."
        : "No captures yet — the engine may have just started.",
    hasTools
      ? "You have connected tools (e.g. gmail, google calendar, slack, notion). When the user asks you to read, search, send, or create something in a connected app, call the appropriate tool instead of guessing. Use tool results to answer."
      : "",
    voiceContextBlock,
  ]
    .filter(Boolean)
    .join("\n");
}

export function toGeminiContents(
  messages: ChatTurn[],
  contextSnippets: string[] = []
): GeminiContent[] {
  const contents: GeminiContent[] = [];

  if (contextSnippets.length > 0) {
    // Caller (server.ts /chat) already truncates and budgets snippets
    const historyBlock = contextSnippets
      .map((snippet, i) => `${i + 1}. ${snippet}`)
      .join("\n");

    contents.push({
      role: "user",
      parts: [
        {
          text: `Here is my recent captured screen and audio activity from local HydraDB memory:\n\n${historyBlock}\n\nRemember this for my questions.`,
        },
      ],
    });
    contents.push({
      role: "model",
      parts: [
        {
          text: "got it — i have your recent screen and audio history and i'll use it to answer your questions.",
        },
      ],
    });
  }

  for (const message of messages) {
    contents.push({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    });
  }

  return contents;
}

export interface GenerateOptions {
  /** Connector tools the model may call. */
  tools?: GeminiFunctionDeclaration[];
  /** Runs a tool the model requested; required when `tools` is non-empty. */
  executeTool?: ToolExecutor;
}

const MAX_TOOL_ITERATIONS = 5;

async function callGemini(
  systemInstruction: string,
  contents: GeminiContent[],
  tools: GeminiFunctionDeclaration[]
): Promise<GeminiContent> {
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents,
  };
  if (tools.length > 0) {
    body.tools = [{ functionDeclarations: tools }];
  }

  const res = await fetch(
    `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify(body),
    }
  );

  const data = (await res.json()) as GeminiResponse;

  if (!res.ok) {
    const message =
      data.error?.message ?? `Gemini API request failed (${res.status})`;
    throw new Error(message);
  }

  const content = data.candidates?.[0]?.content;
  if (!content?.parts) {
    throw new Error("Gemini returned an empty response.");
  }
  return { role: content.role ?? "model", parts: content.parts };
}

export async function generateGeminiReply(
  messages: ChatTurn[],
  contextSnippets: string[] = [],
  recording: RecordingStatus = {
    screenRecording: false,
    framesCaptured: 0,
    audioRecording: false,
    audioChunks: 0,
  },
  options: GenerateOptions = {}
): Promise<string> {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set. Add it to the project .env file.");
  }

  const conversation = messages.filter((m) => m.content.trim().length > 0);
  if (conversation.length === 0) {
    throw new Error("No messages to send to the model.");
  }

  const tools = options.tools ?? [];
  const systemInstruction = buildSystemInstruction(
    contextSnippets,
    recording,
    tools.length > 0
  );
  const contents = toGeminiContents(conversation, contextSnippets);

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const reply = await callGemini(systemInstruction, contents, tools);

    const functionCalls = reply.parts.filter((p) => p.functionCall);
    if (functionCalls.length === 0 || !options.executeTool) {
      const text = reply.parts
        .map((part) => part.text ?? "")
        .join("")
        .trim();
      if (text) return text;
      // No text and no callable tools — nothing more we can do.
      if (functionCalls.length === 0) {
        throw new Error("Gemini returned an empty response.");
      }
    }

    // Record the model's tool-call turn, then execute and feed results back.
    contents.push({ role: "model", parts: reply.parts });

    const responseParts: GeminiPart[] = [];
    for (const part of functionCalls) {
      const call = part.functionCall!;
      let response: Record<string, unknown>;
      try {
        const result = await options.executeTool!(call.name, call.args ?? {});
        response = { result: result ?? null };
      } catch (err) {
        response = {
          error: err instanceof Error ? err.message : "tool execution failed",
        };
      }
      responseParts.push({
        functionResponse: { name: call.name, response },
      });
    }
    contents.push({ role: "user", parts: responseParts });
  }

  throw new Error("Gemini exceeded the maximum number of tool-call rounds.");
}

export interface MeetingSummary {
  title: string;
  summary: string;
  action_items: string[];
}

/** Generate a title, summary, and action items for a meeting transcript. */
export async function summarizeMeeting(transcript: string): Promise<MeetingSummary> {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set. Add it to the project .env file.");
  }

  const prompt = [
    "You are summarizing a meeting from an automatic transcript (30-second chunks, no speaker labels, may contain transcription errors).",
    "Return ONLY a JSON object with exactly these keys:",
    '{"title": "short lowercase title (max 6 words)", "summary": "2-4 sentence summary", "action_items": ["specific action item", ...]}',
    "action_items may be an empty array if none were discussed.",
    "",
    "Transcript:",
    transcript.slice(0, 30_000),
  ].join("\n");

  const res = await fetch(
    `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    }
  );

  const data = (await res.json()) as GeminiResponse;
  if (!res.ok) {
    throw new Error(data.error?.message ?? `Gemini summarize failed (${res.status})`);
  }

  const raw =
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim() ?? "";

  const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const parsed = JSON.parse(jsonText) as Partial<MeetingSummary>;
  return {
    title: typeof parsed.title === "string" ? parsed.title : "meeting",
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    action_items: Array.isArray(parsed.action_items)
      ? parsed.action_items.filter((item): item is string => typeof item === "string")
      : [],
  };
}

/** Transcribe a local audio file via Gemini multimodal API. */
export async function transcribeAudio(filePath: string): Promise<string> {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const audioBytes = fs.readFileSync(filePath);
  if (audioBytes.length < 1000) {
    return "";
  }

  const base64 = audioBytes.toString("base64");
  const ext = filePath.toLowerCase().endsWith(".mp3") ? "audio/mp3" : "audio/wav";

  const res = await fetch(
    `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: [
                  "Transcribe this meeting audio verbatim in the language or languages being spoken.",
                  "Preserve code-switching, including mixed-language speech such as Hinglish, and do not translate it.",
                  "Use the natural script used by the speaker when it is clear, and preserve names, numbers, and technical terms as accurately as possible.",
                  "Add punctuation for readability without summarizing or rewriting what was said.",
                  "If there is no intelligible speech, return an empty string.",
                  "Return only the transcription with no commentary or labels.",
                ].join(" "),
              },
              {
                inline_data: {
                  mime_type: ext,
                  data: base64,
                },
              },
            ],
          },
        ],
      }),
    }
  );

  const data = (await res.json()) as GeminiResponse;
  if (!res.ok) {
    const message =
      data.error?.message ?? `Gemini transcription failed (${res.status})`;
    throw new Error(message);
  }

  return (
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim() ?? ""
  );
}

async function generateJsonFromPrompt<T>(prompt: string): Promise<T> {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set. Add it to the project .env file.");
  }

  const res = await fetch(
    `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    }
  );

  const data = (await res.json()) as GeminiResponse;
  if (!res.ok) {
    throw new Error(data.error?.message ?? `Gemini request failed (${res.status})`);
  }

  const raw =
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim() ?? "";

  const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  return JSON.parse(jsonText) as T;
}

export interface DailySummaryResult {
  title: string;
  summary: string;
  highlights: string[];
}

export async function generateDailySummary(params: {
  activity: string;
  context: string;
}): Promise<DailySummaryResult> {
  const prompt = [
    "You are summarizing the user's work day from local screen captures and audio transcriptions.",
    "Return ONLY JSON:",
    '{"title":"short lowercase title","summary":"3-5 sentence narrative","highlights":["notable moment", ...]}',
    "Use lowercase friendly tone. If there is little data, say so honestly.",
    "",
    "App activity:",
    params.activity.slice(0, 8000),
    "",
    "Captured context:",
    params.context.slice(0, 24_000),
  ].join("\n");

  const parsed = await generateJsonFromPrompt<Partial<DailySummaryResult>>(prompt);
  return {
    title: typeof parsed.title === "string" ? parsed.title : "daily summary",
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    highlights: Array.isArray(parsed.highlights)
      ? parsed.highlights.filter((item): item is string => typeof item === "string")
      : [],
  };
}

export interface FocusReportResult {
  summary: string;
  top_apps: Array<{ app: string; assessment: string }>;
  suggestions: string[];
}

export async function generateFocusReport(params: {
  activity: string;
  context: string;
}): Promise<FocusReportResult> {
  const prompt = [
    "Analyze the user's recent app usage and screen activity for focus and productivity.",
    "Return ONLY JSON:",
    '{"summary":"2-3 sentences","top_apps":[{"app":"name","assessment":"brief note"}],"suggestions":["actionable focus suggestion", ...]}',
    "Suggest concrete focus blocks or habit changes. Be specific, not generic.",
    "",
    "App activity:",
    params.activity.slice(0, 8000),
    "",
    "Recent context:",
    params.context.slice(0, 16_000),
  ].join("\n");

  const parsed = await generateJsonFromPrompt<Partial<FocusReportResult>>(prompt);
  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    top_apps: Array.isArray(parsed.top_apps)
      ? parsed.top_apps
          .filter(
            (item): item is { app: string; assessment: string } =>
              typeof item?.app === "string" && typeof item?.assessment === "string"
          )
          .slice(0, 8)
      : [],
    suggestions: Array.isArray(parsed.suggestions)
      ? parsed.suggestions.filter((item): item is string => typeof item === "string")
      : [],
  };
}

export interface ActionItemsResult {
  action_items: string[];
  summary: string;
}

export async function extractActionItems(context: string): Promise<ActionItemsResult> {
  const prompt = [
    "Extract concrete action items / todos from recent conversations and screen text.",
    "Return ONLY JSON:",
    '{"summary":"one sentence on what you found","action_items":["specific todo", ...]}',
    "Only include items that sound like real tasks the user should do. Empty array is fine.",
    "",
    "Recent context:",
    context.slice(0, 28_000),
  ].join("\n");

  const parsed = await generateJsonFromPrompt<Partial<ActionItemsResult>>(prompt);
  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    action_items: Array.isArray(parsed.action_items)
      ? parsed.action_items.filter((item): item is string => typeof item === "string")
      : [],
  };
}
