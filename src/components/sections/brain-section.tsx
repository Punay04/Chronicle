import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Brain, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { api } from "@/lib/api/client";
import {
  MemoryGraphCanvas,
  graphPalette,
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
import { useThemeVersion } from "@/lib/theme-tokens";

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
      setError(err instanceof Error ? err.message : "Could not load your memory graph");
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

  // Legend colors come from the same palette the canvas paints with, so the two
  // can no longer drift apart or ignore the active theme.
  const themeVersion = useThemeVersion();
  const legend = useMemo(() => {
    const palette = graphPalette();
    return [
      { color: palette.leaf, label: "Memory" },
      { color: palette.hubStroke, label: "Topic", ring: true },
      { color: palette.edge, label: "Link", ring: true },
    ];
  }, [themeVersion]);

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
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Memory"
        description={
          <>
            {graph.nodes.length} memories · {graph.links.length} links · {countNodeKinds(graph)}{" "}
            types
            {expanding && " · Expanding…"}
          </>
        }
        actions={
          <>
            <div className="mr-2 hidden items-center gap-3 lg:flex">
              {legend.map((item) => (
                <div key={item.label} className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      background: item.ring ? "transparent" : item.color,
                      boxShadow: item.ring ? `inset 0 0 0 1px ${item.color}` : undefined,
                    }}
                  />
                  <span className="text-xs text-muted-foreground">{item.label}</span>
                </div>
              ))}
            </div>

            <div className="relative w-56">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search memories…"
                className="h-9 pl-10"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </>
        }
      />

      <div className="relative flex min-h-0 w-full min-w-0 flex-1">
        <div className="relative min-h-0 min-w-0 flex-1 bg-background">
          {loading && graph.nodes.length === 0 && (
            <div className="absolute inset-0 z-20 flex items-center justify-center gap-2 bg-background/80 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading your memory graph…
            </div>
          )}

          {error && (
            <div className="absolute inset-0 z-20 flex items-center justify-center p-6">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {!loading && !error && graph.nodes.length === 0 && (
            <EmptyState
              className="absolute inset-0 z-20"
              icon={Brain}
              title="No memories yet"
              description="Start recording and Chronicle will build this graph from what it captures."
            />
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
