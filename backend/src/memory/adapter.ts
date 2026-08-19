import type {
  MemoryGraph,
  MemoryNode,
  MemoryNodeType,
  MemoryRelation,
  MemorySourceType,
} from "./types.js";

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function propsOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  if (record.properties && typeof record.properties === "object") {
    return record.properties as Record<string, unknown>;
  }
  return record;
}

export function rowToMemoryNode(row: Record<string, unknown>): MemoryNode | null {
  const source = propsOf(row.e ?? row.n ?? row.node ?? row.f ?? row);
  const id = asString(source.id) ?? asString(row.id);
  if (!id) return null;

  const type = (asString(source.type) ?? asString(source.episode_type) ?? "memory") as MemoryNodeType;
  const content = asString(source.content) ?? asString(source.text) ?? "";
  const created = asString(source.created_at) ?? asString(source.valid_from) ?? new Date().toISOString();

  return {
    id,
    type,
    title: asString(source.title) ?? (content.slice(0, 60) || null),
    content,
    metadata: source,
    source_type: (asString(source.source_type) as MemorySourceType | null) ?? null,
    source_id: asNumber(source.source_id),
    app_name: asString(source.app_name),
    window_name: asString(source.window_name),
    salience: asNumber(source.salience) ?? 0.5,
    created_at: created,
    updated_at: asString(source.updated_at) ?? created,
  };
}

export function buildGraphFromNeighbors(
  node: MemoryNode,
  neighbors: Array<{ relation: string; neighbor: MemoryNode }>
): MemoryGraph {
  const edges: MemoryGraph["edges"] = [];
  const seen = new Set<string>();

  for (const item of neighbors) {
    if (!item.neighbor || item.neighbor.id === node.id) continue;
    const key = [node.id, item.neighbor.id, item.relation].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const relation = (
      item.relation === "SUPERSEDES"
        ? "supersedes"
        : item.relation === "FOLLOWS"
          ? "follows"
          : item.relation === "MENTIONS" || item.relation === "ABOUT"
            ? "mentions"
            : item.relation === "RECORDED_AS"
              ? "contains"
              : "related_to"
    ) as MemoryRelation;
    edges.push({
      id: `edge-${edges.length}`,
      from_id: node.id,
      to_id: item.neighbor.id,
      relation,
      weight: relation === "supersedes" ? 1 : 0.7,
      created_at: node.updated_at,
      neighbor: item.neighbor,
    });
  }

  return { node, edges };
}
