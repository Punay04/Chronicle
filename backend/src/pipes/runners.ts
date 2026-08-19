import {
  getActivitySummary,
  getRecentContext,
  searchContent,
} from "../db/index.js";
import {
  getMeetingTranscript,
  listMeetings,
  updateMeeting,
} from "../db/meetings.js";
import {
  extractActionItems,
  generateDailySummary,
  generateFocusReport,
  summarizeMeeting,
} from "../llm/gemini.js";
import { ingestMeetingSummary, ingestUserMemory } from "../memory/ingest.js";
import type { PipeId } from "./definitions.js";

function startOfDayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

function formatActivityBlock(start: string, end: string): string {
  const summary = getActivitySummary(start, end);
  const appLines = summary.apps
    .map((app) => `- ${app.app_name}: ${app.frame_count} frames`)
    .join("\n");
  return [
    `time range: ${summary.start_time} → ${summary.end_time}`,
    `total frames: ${summary.frame_count}`,
    "apps:",
    appLines || "(no app data)",
  ].join("\n");
}

function gatherContextSnippets(params: {
  startTime: string;
  endTime: string;
  limit?: number;
}): string {
  const { data } = searchContent({
    startTime: params.startTime,
    endTime: params.endTime,
    contentType: "all",
    limit: params.limit ?? 40,
    offset: 0,
  });

  const snippets = data
    .map((item) => {
      const label = item.type === "Audio" ? "[audio]" : "[screen]";
      const meta = [
        label,
        item.content.app_name ? `[${item.content.app_name}]` : null,
        item.content.window_name ? `"${item.content.window_name}"` : null,
      ]
        .filter(Boolean)
        .join(" ");
      return `${meta} ${item.content.text}`.trim();
    })
    .filter((line) => line.length > 10);

  if (snippets.length > 0) {
    return snippets.join("\n\n");
  }

  return getRecentContext(12)
    .map((item) => {
      const label = item.source === "audio" ? "[audio]" : "[screen]";
      return `${label} ${item.app_name ? `[${item.app_name}]` : ""} ${item.text}`;
    })
    .join("\n\n");
}

async function runDailySummary(): Promise<string> {
  const end = new Date().toISOString();
  const start = startOfDayIso();
  const activity = formatActivityBlock(start, end);
  const context = gatherContextSnippets({ startTime: start, endTime: end });

  if (context.trim().length < 20 && activity.includes("(no app data)")) {
    throw new Error("not enough captured data for a daily summary yet");
  }

  const result = await generateDailySummary({ activity, context });
  const content = [
    result.summary,
    result.highlights.length > 0
      ? `highlights:\n${result.highlights.map((item) => `- ${item}`).join("\n")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  ingestUserMemory({
    title: result.title,
    content,
  });

  return content;
}

async function runMeetingRecap(): Promise<string> {
  const meetings = listMeetings().filter(
    (meeting) => !meeting.summary && meeting.chunk_count > 0
  );

  if (meetings.length === 0) {
    const pending = listMeetings().filter((m) => m.chunk_count > 0).length;
    if (pending === 0) {
      return "no meetings with transcripts found";
    }
    return "all meetings with transcripts are already summarized";
  }

  const lines: string[] = [];
  for (const meeting of meetings.slice(0, 5)) {
    const transcript = getMeetingTranscript(meeting.id);
    if (transcript.length === 0) continue;

    const text = transcript
      .map((chunk) => `[${chunk.timestamp}] ${chunk.transcription}`)
      .join("\n");
    const result = await summarizeMeeting(text);

    updateMeeting(meeting.id, {
      summary: result.summary,
      action_items: JSON.stringify(result.action_items),
      ...(meeting.title ? {} : { title: result.title }),
    });

    ingestMeetingSummary({
      meetingId: meeting.id,
      title: meeting.title ?? result.title,
      summary: result.summary,
      actionItems: result.action_items,
    });

    lines.push(
      `meeting #${meeting.id} (${meeting.title ?? result.title}): ${result.summary}`
    );
  }

  if (lines.length === 0) {
    return "no unsummarized meetings with transcript text found";
  }

  return lines.join("\n\n");
}

async function runFocusTracker(): Promise<string> {
  const end = new Date().toISOString();
  const start = hoursAgoIso(4);
  const activity = formatActivityBlock(start, end);
  const context = gatherContextSnippets({ startTime: start, endTime: end, limit: 25 });

  const result = await generateFocusReport({ activity, context });
  const content = [
    result.summary,
    result.top_apps.length > 0
      ? `top apps:\n${result.top_apps.map((app) => `- ${app.app}: ${app.assessment}`).join("\n")}`
      : null,
    result.suggestions.length > 0
      ? `suggestions:\n${result.suggestions.map((item) => `- ${item}`).join("\n")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  ingestUserMemory({
    title: "focus report",
    content,
  });

  return content;
}

async function runActionItems(): Promise<string> {
  const end = new Date().toISOString();
  const start = hoursAgoIso(6);
  const context = gatherContextSnippets({ startTime: start, endTime: end, limit: 50 });

  if (context.trim().length < 30) {
    throw new Error("not enough recent conversation or screen text to extract action items");
  }

  const result = await extractActionItems(context);
  if (result.action_items.length === 0) {
    return result.summary || "no action items found in recent context";
  }

  await ingestUserMemory({
    title: "extracted action items",
    content: [result.summary, ...result.action_items.map((item) => `- ${item}`)].join("\n"),
  });

  return [
    result.summary,
    ...result.action_items.map((item) => `- ${item}`),
  ].join("\n");
}

const RUNNERS: Record<PipeId, () => Promise<string>> = {
  "daily-summary": runDailySummary,
  "meeting-recap": runMeetingRecap,
  "focus-tracker": runFocusTracker,
  "action-items": runActionItems,
};

export async function executePipe(pipeId: PipeId): Promise<string> {
  const runner = RUNNERS[pipeId];
  if (!runner) {
    throw new Error(`unknown pipe: ${pipeId}`);
  }
  return runner();
}
