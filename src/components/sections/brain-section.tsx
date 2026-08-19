import React, { useCallback, useEffect, useState } from "react";
import { Brain, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api/client";
import {
  MemoryGraphCanvas,
  type MemoryGraphData,
} from "@/components/sections/memory-graph-canvas";
import { MemoryNodeDetail } from "@/components/sections/memory-node-detail";
import {
  expandGraphForMemories,
  finalizeGraph,
  getNodeById,
  graphFromMemories,
  mergeGraphResponse,
} from "@/lib/memory-graph";
import { countNodeKinds } from "@/lib/memory-graph-layout";

const NODE_LEGEND = [
  { color: "hsl(217, 96%, 48%)", label: "memory" },
  { color: "hsl(216, 100%, 96%)", label: "context", ring: true },
  { color: "hsla(217, 40%, 70%, 0.8)", label: "link", ring: true },
];

export function BrainSection() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [expanding, setExpanding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [graph, setGraph] = useState<MemoryGraphData>({ nodes: [], links: [] });

  const loadGraph = useCallback(async (search?: string) => {
    setLoading(true);
    setError(null);
    try {
      const [list, profile] = await Promise.all([
        api.memory({ q: search?.trim() || undefined, limit: 60 }),
        api.memoryProfile().catch(() => ({ persona: [], aims: [] })),
      ]);
      const base = finalizeGraph(graphFromMemories(list.data), profile);
      setGraph(base);
      setLoading(false);

      if (list.data.length === 0) return;

      setExpanding(true);
      const expanded = finalizeGraph(
        await expandGraphForMemories(base, list.data.slice(0, 24)),
        profile
      );
      setGraph(expanded);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load memory graph");
    } finally {
      setLoading(false);
      setExpanding(false);
    }
  }, []);

  useEffect(() => {
    void loadGraph();
  }, [loadGraph]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadGraph(query);
    }, 350);
    return () => clearTimeout(timer);
  }, [query, loadGraph]);

  const detailNode = selectedId ? getNodeById(graph, selectedId) : null;

  const expandSelected = useCallback(async (id: string) => {
    if (id.startsWith("hub-")) return;
    setExpanding(true);
    try {
      const [response, profile] = await Promise.all([
        api.memoryGraph(id, 2),
        api.memoryProfile().catch(() => ({ persona: [], aims: [] })),
      ]);
      setGraph((prev) => finalizeGraph(mergeGraphResponse(prev, response), profile));
    } catch {
      // keep current graph
    } finally {
      setExpanding(false);
    }
  }, []);

  const handleSelect = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      if (id) void expandSelected(id);
    },
    [expandSelected]
  );

  return (
    <div className="flex flex-col h-full min-h-0 w-full flex-1 overflow-hidden">
      <div className="page-header flex items-center gap-4 shrink-0 w-full">
        <div className="min-w-0 shrink-0">
          <h1 className="page-header-title">Brain</h1>
          <p className="page-header-desc">
            {graph.nodes.length} nodes · {graph.links.length} edges · {countNodeKinds(graph)}{" "}
            kinds
            {expanding && " · Expanding…"}
          </p>
        </div>

        <div className="hidden md:flex items-center gap-3 ml-4">
          {NODE_LEGEND.map((item) => (
            <div key={item.label} className="flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{
                  background: item.ring ? "transparent" : item.color,
                  boxShadow: item.ring ? `inset 0 0 0 1px ${item.color}` : undefined,
                }}
              />
              <span className="text-xs text-muted-foreground capitalize">{item.label}</span>
            </div>
          ))}
        </div>

        <div className="relative w-full max-w-md ml-auto shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search nodes…"
            className="pl-10 h-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-1 min-h-0 min-w-0 w-full relative">
        <div className="flex-1 min-w-0 min-h-0 relative bg-background">
          {loading && graph.nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground z-20 bg-background/80">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading memory graph…
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex items-center justify-center p-6 z-20">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {!loading && !error && graph.nodes.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center z-20">
              <Brain className="w-10 h-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground max-w-md">
                No memories yet. Start recording and Chronicle will write episodes into the local graph
                automatically.
              </p>
            </div>
          )}

          {graph.nodes.length > 0 && (
            <MemoryGraphCanvas
              data={graph}
              selectedId={selectedId}
              hoverId={hoverId}
              onHover={setHoverId}
              onSelect={handleSelect}
            />
          )}
        </div>

        {detailNode && selectedId && (
          <aside className="shrink-0 z-20 w-96 border-l border-border">
            <MemoryNodeDetail
              node={detailNode}
              graph={graph}
              pinned
              onClose={() => setSelectedId(null)}
              onNavigate={(id) => handleSelect(id)}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
