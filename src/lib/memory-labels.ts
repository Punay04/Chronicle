/**
 * Display names for memory graph enums.
 *
 * `MemoryNodeType` and `MemoryRelation` are backend identifiers, but the UI used
 * to render them with a bare `.replace(/_/g, " ")` — so "screen_chunk" leaked
 * onto the screen as "screen chunk". Map through these instead; the enums
 * themselves stay untouched, since they are also graph and API values.
 */

const NODE_TYPE_LABELS: Record<string, string> = {
  screen_chunk: "Screen Snapshot",
  audio_chunk: "Audio Segment",
  app: "App",
  meeting: "Recording",
  task: "Task",
  memory: "Memory",
  topic: "Topic",
  document: "Document",
  session_turn: "Conversation Turn",
  fact: "Fact",
};

const RELATION_LABELS: Record<string, string> = {
  captured_in: "Captured in",
  spoken_in: "Spoken in",
  follows: "Follows",
  summarizes: "Summarizes",
  contains: "Contains",
  mentions: "Mentions",
  related_to: "Related to",
  derived_from: "Derived from",
  supersedes: "Replaces",
};

function titleCase(raw: string): string {
  const words = raw.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function nodeTypeLabel(type: string): string {
  return NODE_TYPE_LABELS[type] ?? titleCase(type);
}

export function relationLabel(relation: string): string {
  return RELATION_LABELS[relation] ?? titleCase(relation);
}
