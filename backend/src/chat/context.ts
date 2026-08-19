import { getRecentContext, getStats, searchContent } from "../db/index.js";
import { isAudioRecording } from "../capture/audio.js";
import { captureEngine } from "../capture/engine.js";
import { retrieveContextForChat } from "../memory/index.js";
import type { RecordingStatus } from "../llm/gemini.js";

const CONTEXT_BUDGET = 24_000;

export interface ChatContextBundle {
  snippets: string[];
  recording: RecordingStatus;
  searchQuery: string;
}

/**
 * Same context assembly used by POST /chat and Gemini Live voice sessions:
 * HydraDB graph → recent SQLite fallback → FTS, then budget-trimmed.
 */
export async function buildChatContext(
  searchQuery: string
): Promise<ChatContextBundle> {
  const stats = getStats();
  const engine = captureEngine.state;
  const q = searchQuery.trim();

  const { snippets: memorySnippets } = await retrieveContextForChat(
    q,
    CONTEXT_BUDGET
  );

  const contextSnippets = [...memorySnippets];

  if (contextSnippets.length === 0) {
    const recent = getRecentContext(8);
    for (const item of recent) {
      const sourceLabel = item.source === "audio" ? "[audio]" : "[screen]";
      const parts = [
        sourceLabel,
        item.app_name ? `[${item.app_name}]` : null,
        item.window_name ? `"${item.window_name}"` : null,
        item.text.slice(0, 1500),
      ].filter(Boolean);
      contextSnippets.push(parts.join(" "));
    }
  }

  if (q.length > 2) {
    const { data } = searchContent({
      q,
      limit: 4,
      offset: 0,
      contentType: "all",
    });
    const searchSnippets = data
      .map((item) => item.content.text?.slice(0, 800))
      .filter(Boolean) as string[];
    for (const snippet of searchSnippets) {
      if (!contextSnippets.includes(snippet)) {
        contextSnippets.push(snippet);
      }
    }
  }

  let budget = 0;
  const boundedSnippets: string[] = [];
  for (const snippet of contextSnippets) {
    if (budget + snippet.length > CONTEXT_BUDGET) break;
    budget += snippet.length;
    boundedSnippets.push(snippet);
  }

  return {
    snippets: boundedSnippets,
    recording: {
      screenRecording: engine.running && !engine.paused,
      framesCaptured: stats.framesCaptured,
      audioRecording: isAudioRecording(),
      audioChunks: stats.audioChunks,
    },
    searchQuery: q,
  };
}
