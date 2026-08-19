import { api, type MemoryGraphResponse, type MemoryNode } from "@/lib/api/client";
import type { GraphLink, GraphNode, MemoryGraphData } from "@/components/sections/memory-graph-canvas";
import { memoryNodeToGraphNode } from "@/components/sections/memory-graph-canvas";

export interface MemoryProfileFacts {
  persona: string[];
  aims: string[];
}

function linkKey(from: string, to: string, relation: string): string {
  const [a, b] = from < to ? [from, to] : [to, from];
  return `${a}|${b}|${relation}`;
}

export function linkEndpointId(endpoint: string | GraphNode): string {
  return typeof endpoint === "string" ? endpoint : endpoint.id;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function makeHubMemory(params: {
  id: string;
  type: string;
  title: string;
  content: string;
  appName?: string | null;
}): MemoryNode {
  return {
    id: params.id,
    type: params.type,
    title: params.title,
    content: params.content,
    metadata: { hub: true, app_name: params.appName ?? null },
    source_type: null,
    source_id: null,
    app_name: params.appName ?? null,
    window_name: null,
    salience: 1,
    created_at: new Date(0).toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/** Map capture app / window strings to stable user-context labels. */
const CONTEXT_APP_ALIASES: Array<{
  match: RegExp;
  id: string;
  title: string;
}> = [
  { match: /gmail|mail\.google|outlook|apple mail|thunderbird/i, id: "gmail", title: "Gmail" },
  {
    match: /calendar|cal\.google|outlook calendar/i,
    id: "calendar",
    title: "Calendar",
  },
  { match: /slack/i, id: "slack", title: "Slack" },
  { match: /discord/i, id: "discord", title: "Discord" },
  { match: /notion/i, id: "notion", title: "Notion" },
  { match: /spotify/i, id: "spotify", title: "Spotify" },
  { match: /youtube|youtu\.be/i, id: "youtube", title: "YouTube" },
  { match: /twitter|\bx\b|x\.com/i, id: "x", title: "X" },
  { match: /chatgpt|openai|claude|gemini/i, id: "ai", title: "AI" },
  { match: /code|cursor|vscode|visual studio/i, id: "code", title: "Code" },
  { match: /chrome|firefox|safari|edge|brave/i, id: "browser", title: "Browser" },
  { match: /figma/i, id: "figma", title: "Figma" },
  { match: /linear|jira|asana|trello/i, id: "tasks", title: "Tasks" },
  { match: /zoom|meet\.google|teams|webex/i, id: "calls", title: "Calls" },
];

function resolveContextApp(
  appName: string | null | undefined,
  windowName?: string | null
): { id: string; title: string } | null {
  const haystack = `${appName ?? ""} ${windowName ?? ""}`.trim();
  if (!haystack) return null;

  for (const alias of CONTEXT_APP_ALIASES) {
    if (alias.match.test(haystack)) {
      return { id: alias.id, title: alias.title };
    }
  }

  const cleaned = (appName ?? "").replace(/\.(exe|app)$/i, "").trim();
  if (!cleaned || /^(unknown|system|desktop|explorer|finder)$/i.test(cleaned)) {
    return null;
  }

  return { id: slugify(cleaned), title: cleaned };
}

type FactKind = "location" | "persona" | "aim" | "other";

function classifyFact(fact: string): FactKind {
  const f = fact.toLowerCase();
  if (
    /\b(live[s]? in|based in|from |located in|city|country|hometown|timezone)\b/.test(
      f
    )
  ) {
    return "location";
  }
  if (
    /\b(want|goal|aim|building|working on|planning|focus|priority|ship|launch)\b/.test(
      f
    )
  ) {
    return "aim";
  }
  if (
    /\b(i am|i'm|name is|works? at|job|role|engineer|founder|student|prefer|persona)\b/.test(
      f
    )
  ) {
    return "persona";
  }
  return "other";
}

function shortFactLabel(fact: string, kind: FactKind): string {
  const cleaned = stripHeadingDate(
    fact.replace(/^\[(?:profile|recent)\]\s*/i, "").trim()
  );
  if (kind === "location") {
    const loc = cleaned.match(
      /(?:live[s]? in|based in|from|located in)\s+([^.,;]+)/i
    );
    if (loc?.[1]) return loc[1].trim().slice(0, 28);
    return "Location";
  }
  if (kind === "aim") {
    return cleaned.slice(0, 28) || "Aim";
  }
  if (kind === "persona") {
    return cleaned.slice(0, 28) || "Persona";
  }
  return cleaned.slice(0, 28) || "Context";
}

function stripHeadingDate(text: string): string {
  return text
    .replace(/^\[\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?)?\]\s*/i, "")
    .replace(/^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?)?[:\s-–—]+\s*/i, "")
    .trim();
}

function tokensFromFact(fact: string): string[] {
  return fact
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 3)
    .slice(0, 8);
}

function leafMatchesTokens(leaf: GraphNode, tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  const hay = `${leaf.label} ${leaf.memory.content} ${leaf.memory.app_name ?? ""} ${leaf.memory.window_name ?? ""}`.toLowerCase();
  let hits = 0;
  for (const token of tokens) {
    if (hay.includes(token)) hits++;
  }
  return hits >= Math.min(2, tokens.length);
}

/** User-context hubs from profile + apps — not SCREEN/AUDIO modality buckets. */
export function addStructuralLinks(
  graph: MemoryGraphData,
  profile?: MemoryProfileFacts | null
): MemoryGraphData {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const links = new Map(
    graph.links.map((l) => {
      const source = linkEndpointId(l.source);
      const target = linkEndpointId(l.target);
      return [linkKey(source, target, l.relation), { source, target, relation: l.relation }];
    })
  );

  const addLink = (source: string, target: string, relation: string) => {
    if (source === target) return;
    if (!nodes.has(source) || !nodes.has(target)) return;
    const key = linkKey(source, target, relation);
    if (links.has(key)) return;
    links.set(key, { source, target, relation });
  };

  const ensureHub = (params: {
    id: string;
    type: string;
    title: string;
    content: string;
    appName?: string | null;
  }) => {
    if (!nodes.has(params.id)) {
      nodes.set(
        params.id,
        memoryNodeToGraphNode(makeHubMemory(params), "hub")
      );
    }
    return params.id;
  };

  const rootId = ensureHub({
    id: "hub-you",
    type: "topic",
    title: "You",
    content: "Your personal context graph",
  });

  const leaves = [...nodes.values()].filter((n) => n.role !== "hub");

  // —— Profile-driven context hubs (persona / aims / location) ——
  const personaFacts = profile?.persona ?? [];
  const aimFacts = profile?.aims ?? [];

  if (personaFacts.length > 0) {
    const personaId = ensureHub({
      id: "hub-persona",
      type: "topic",
      title: "Persona",
      content: personaFacts.slice(0, 8).join("\n"),
    });
    addLink(rootId, personaId, "contains");

    for (const fact of personaFacts.slice(0, 6)) {
      const kind = classifyFact(fact);
      if (kind !== "persona" && kind !== "other" && kind !== "location") continue;
      const label = shortFactLabel(fact, kind === "other" ? "persona" : kind);
      const factId = ensureHub({
        id: `hub-fact-${slugify(label) || slugify(fact.slice(0, 24))}`,
        type: "topic",
        title: label,
        content: fact,
      });
      addLink(personaId, factId, "contains");
      const tokens = tokensFromFact(fact);
      let linked = 0;
      for (const leaf of leaves) {
        if (linked >= 8) break;
        if (leafMatchesTokens(leaf, tokens)) {
          addLink(factId, leaf.id, "related_to");
          linked++;
        }
      }
    }
  }

  const locationFacts = [...personaFacts, ...aimFacts].filter(
    (f) => classifyFact(f) === "location"
  );
  for (const fact of locationFacts.slice(0, 3)) {
    const label = shortFactLabel(fact, "location");
    const locId = ensureHub({
      id: `hub-location-${slugify(label)}`,
      type: "topic",
      title: label === "Location" ? "Location" : label,
      content: fact,
    });
    addLink(rootId, locId, "contains");
    const tokens = tokensFromFact(fact);
    let linked = 0;
    for (const leaf of leaves) {
      if (linked >= 6) break;
      if (leafMatchesTokens(leaf, tokens)) {
        addLink(locId, leaf.id, "related_to");
        linked++;
      }
    }
  }

  if (aimFacts.length > 0) {
    const aimsId = ensureHub({
      id: "hub-aims",
      type: "topic",
      title: "Aims",
      content: aimFacts.slice(0, 8).join("\n"),
    });
    addLink(rootId, aimsId, "contains");

    for (const fact of aimFacts.slice(0, 5)) {
      const label = shortFactLabel(fact, "aim");
      const factId = ensureHub({
        id: `hub-aim-${slugify(label) || slugify(fact.slice(0, 24))}`,
        type: "topic",
        title: label,
        content: fact,
      });
      addLink(aimsId, factId, "contains");
      const tokens = tokensFromFact(fact);
      let linked = 0;
      for (const leaf of leaves) {
        if (linked >= 8) break;
        if (leafMatchesTokens(leaf, tokens)) {
          addLink(factId, leaf.id, "related_to");
          linked++;
        }
      }
    }
  }

  // —— Real tool / app context hubs (Gmail, Calendar, …) ——
  const contextGroups = new Map<string, { title: string; nodes: GraphNode[] }>();

  for (const leaf of leaves) {
    const resolved = resolveContextApp(leaf.memory.app_name, leaf.memory.window_name);
    if (!resolved) continue;
    if (!contextGroups.has(resolved.id)) {
      contextGroups.set(resolved.id, { title: resolved.title, nodes: [] });
    }
    contextGroups.get(resolved.id)!.nodes.push(leaf);
  }

  for (const [id, group] of contextGroups) {
    if (group.nodes.length < 1) continue;
    const hubId = ensureHub({
      id: `hub-app-${id}`,
      type: "app",
      title: group.title,
      content: `Context from ${group.title}`,
      appName: group.title,
    });
    addLink(rootId, hubId, "contains");
    for (const leaf of group.nodes) {
      addLink(hubId, leaf.id, "captured_in");
    }
  }

  // Meeting summaries as titled hubs (not "MEETING 31")
  for (const leaf of leaves) {
    if (leaf.type !== "meeting") continue;
    const title =
      stripHeadingDate((leaf.memory.title ?? leaf.label).trim()) || "Meeting";
    const hubId = ensureHub({
      id: `hub-meeting-${leaf.id}`,
      type: "meeting",
      title: title.slice(0, 36),
      content: leaf.memory.content.slice(0, 400),
    });
    addLink(rootId, hubId, "contains");
    addLink(hubId, leaf.id, "summarizes");

    const meetingId = leaf.memory.source_id;
    if (typeof meetingId === "number" && meetingId > 0) {
      for (const other of leaves) {
        if (other.memory.metadata?.meeting_id === meetingId) {
          addLink(hubId, other.id, "spoken_in");
        }
      }
    }
  }

  // Orphans attach to You so the web stays connected
  for (const leaf of leaves) {
    const hasContextApp = Boolean(
      resolveContextApp(leaf.memory.app_name, leaf.memory.window_name)
    );
    const isMeeting = leaf.type === "meeting";
    if (!hasContextApp && !isMeeting) {
      addLink(rootId, leaf.id, "contains");
    }
  }

  // Chronological follows within the same context app
  const byContext = new Map<string, GraphNode[]>();
  for (const leaf of leaves) {
    const resolved = resolveContextApp(leaf.memory.app_name, leaf.memory.window_name);
    const key = resolved?.id ?? "__global__";
    if (!byContext.has(key)) byContext.set(key, []);
    byContext.get(key)!.push(leaf);
  }

  for (const group of byContext.values()) {
    const sorted = [...group].sort(
      (a, b) =>
        new Date(a.memory.created_at).getTime() -
        new Date(b.memory.created_at).getTime()
    );
    for (let i = 0; i < sorted.length - 1; i++) {
      addLink(sorted[i].id, sorted[i + 1].id, "follows");
    }
  }

  return {
    nodes: [...nodes.values()],
    links: [...links.values()],
  };
}

export function pruneGraphLinks(
  graph: MemoryGraphData,
  maxPerNode = 10
): MemoryGraphData {
  const degree = new Map<string, number>();
  const kept: GraphLink[] = [];
  const seen = new Set<string>();

  const relationScore = (relation: string) => {
    if (relation === "captured_in" || relation === "spoken_in" || relation === "contains")
      return 5;
    if (relation === "related_to" || relation === "derived_from" || relation === "summarizes")
      return 4;
    if (relation === "follows") return 2;
    return 1;
  };

  const sorted = [...graph.links].sort(
    (a, b) => relationScore(b.relation) - relationScore(a.relation)
  );

  for (const link of sorted) {
    const source = linkEndpointId(link.source);
    const target = linkEndpointId(link.target);
    const key = linkKey(source, target, link.relation);
    if (seen.has(key)) continue;

    const sourceDegree = degree.get(source) ?? 0;
    const targetDegree = degree.get(target) ?? 0;
    const sourceIsHub = graph.nodes.find((n) => n.id === source)?.role === "hub";
    const targetIsHub = graph.nodes.find((n) => n.id === target)?.role === "hub";
    const sourceCap = sourceIsHub ? 40 : maxPerNode;
    const targetCap = targetIsHub ? 40 : maxPerNode;
    if (sourceDegree >= sourceCap || targetDegree >= targetCap) continue;

    seen.add(key);
    kept.push({ source, target, relation: link.relation });
    degree.set(source, sourceDegree + 1);
    degree.set(target, targetDegree + 1);
  }

  return { nodes: graph.nodes, links: kept };
}

export function addHeuristicLinks(graph: MemoryGraphData): MemoryGraphData {
  if (graph.nodes.length < 2) return graph;

  const links: GraphLink[] = [...graph.links];
  const seen = new Set(
    links.map((l) =>
      linkKey(linkEndpointId(l.source), linkEndpointId(l.target), l.relation)
    )
  );

  const leaves = graph.nodes.filter((n) => n.role !== "hub");
  const sorted = [...leaves].sort(
    (a, b) =>
      new Date(a.memory.created_at).getTime() - new Date(b.memory.created_at).getTime()
  );

  for (let i = 0; i < sorted.length - 1; i++) {
    const key = linkKey(sorted[i].id, sorted[i + 1].id, "follows");
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({
      source: sorted[i].id,
      target: sorted[i + 1].id,
      relation: "follows",
    });
  }

  return { nodes: graph.nodes, links };
}

export function mergeGraphResponse(
  graph: MemoryGraphData,
  response: MemoryGraphResponse
): MemoryGraphData {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const links = new Map(
    graph.links.map((l) => [
      linkKey(linkEndpointId(l.source), linkEndpointId(l.target), l.relation),
      {
        source: linkEndpointId(l.source),
        target: linkEndpointId(l.target),
        relation: l.relation,
      },
    ])
  );

  if (!nodes.has(response.node.id)) {
    nodes.set(response.node.id, memoryNodeToGraphNode(response.node));
  }

  for (const edge of response.edges) {
    if (!nodes.has(edge.neighbor.id)) {
      nodes.set(edge.neighbor.id, memoryNodeToGraphNode(edge.neighbor));
    }

    const key = linkKey(edge.from_id, edge.to_id, edge.relation);
    if (!links.has(key)) {
      links.set(key, {
        source: edge.from_id,
        target: edge.neighbor.id,
        relation: edge.relation,
      });
    }
  }

  return {
    nodes: [...nodes.values()],
    links: [...links.values()],
  };
}

export function graphFromMemories(memories: MemoryNode[]): MemoryGraphData {
  return {
    nodes: memories.map((m) => memoryNodeToGraphNode(m)),
    links: [],
  };
}

export async function expandGraphForMemories(
  graph: MemoryGraphData,
  memories: MemoryNode[],
  concurrency = 6
): Promise<MemoryGraphData> {
  let result = graph;

  for (let i = 0; i < memories.length; i += concurrency) {
    const chunk = memories.slice(i, i + concurrency);
    const responses = await Promise.all(
      chunk.map((memory) => api.memoryGraph(memory.id, 2).catch(() => null))
    );

    for (const response of responses) {
      if (response) {
        result = mergeGraphResponse(result, response);
      }
    }
  }

  return result;
}

export function finalizeGraph(
  graph: MemoryGraphData,
  profile?: MemoryProfileFacts | null
): MemoryGraphData {
  return pruneGraphLinks(addHeuristicLinks(addStructuralLinks(graph, profile)), 12);
}

export function filterGraphHighlight(
  graph: MemoryGraphData,
  query: string
): Set<string> {
  const q = query.trim().toLowerCase();
  if (!q) return new Set();

  const matched = new Set<string>();
  for (const node of graph.nodes) {
    const haystack = `${node.label} ${node.memory.content} ${node.type}`.toLowerCase();
    if (haystack.includes(q)) {
      matched.add(node.id);
      for (const link of graph.links) {
        const sourceId = linkEndpointId(link.source);
        const targetId = linkEndpointId(link.target);
        if (sourceId === node.id) matched.add(targetId);
        if (targetId === node.id) matched.add(sourceId);
      }
    }
  }
  return matched;
}

export function getNodeById(
  graph: MemoryGraphData,
  id: string | null
): MemoryNode | null {
  if (!id) return null;
  return graph.nodes.find((n) => n.id === id)?.memory ?? null;
}
