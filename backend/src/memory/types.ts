export type MemoryNodeType =
  | "screen_chunk"
  | "audio_chunk"
  | "app"
  | "meeting"
  | "task"
  | "memory"
  | "topic"
  | "document"
  | "session_turn"
  | "fact";

export type MemorySourceType = "frame" | "audio" | "meeting" | "user";

export type MemoryRelation =
  | "captured_in"
  | "spoken_in"
  | "follows"
  | "summarizes"
  | "contains"
  | "mentions"
  | "related_to"
  | "derived_from"
  | "supersedes";

export interface MemoryNode {
  id: string;
  type: MemoryNodeType;
  title: string | null;
  content: string;
  metadata: Record<string, unknown> | null;
  source_type: MemorySourceType | null;
  source_id: number | null;
  app_name: string | null;
  window_name: string | null;
  salience: number;
  created_at: string;
  updated_at: string;
}

export interface MemoryEdge {
  id: string;
  from_id: string;
  to_id: string;
  relation: MemoryRelation;
  weight: number;
  created_at: string;
}

export interface MemoryGraph {
  node: MemoryNode;
  edges: Array<MemoryEdge & { neighbor: MemoryNode }>;
}

export interface MemorySearchResult {
  node: MemoryNode;
  score: number;
  match_source: "fts" | "recent" | "graph";
}

export interface MemoryStats {
  nodes: number;
  edges: number;
  by_type: Record<string, number>;
}
