import React, { useEffect, useMemo, useRef, useState } from "react";
import type { GraphLane } from "@/lib/memory-graph-layout";
import { getFocusSet, isLinkFocused, layoutLaneNodes } from "@/lib/memory-graph-layout";
import { linkEndpointId } from "@/lib/memory-graph";
import type { GraphLink, GraphNode, MemoryGraphData } from "@/components/sections/memory-graph-canvas";

interface MemoryGraphLaneCanvasProps {
  data: MemoryGraphData;
  lanes: GraphLane[];
  focusId: string | null;
  onFocus: (id: string | null) => void;
  onSelect: (id: string) => void;
}

function nodeStroke(focused: boolean, active: boolean): string {
  if (active) return "hsl(var(--foreground))";
  if (focused) return "hsl(var(--foreground) / 0.7)";
  return "hsl(var(--border))";
}

function nodeFill(type: string, focused: boolean, active: boolean): string {
  if (active) return "hsl(var(--foreground))";
  if (!focused) return "hsl(var(--muted) / 0.35)";
  if (type === "screen_chunk" || type === "audio_chunk") return "hsl(var(--surface-secondary))";
  if (type === "memory" || type === "document") return "hsl(var(--background))";
  return "hsl(var(--surface))";
}

export function MemoryGraphLaneCanvas({
  data,
  lanes,
  focusId,
  onFocus,
  onSelect,
}: MemoryGraphLaneCanvasProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null);

  const activeId = focusId ?? hoverId;
  const focus = useMemo(() => getFocusSet(data, activeId), [data, activeId]);
  const headerOffset = 36;

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      const next = {
        width: Math.max(Math.floor(rect.width), 1),
        height: Math.max(Math.floor(rect.height), 1),
      };
      setSize((prev) =>
        prev.width === next.width && prev.height === next.height ? prev : next
      );
    };

    measure();
    const raf = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  const layoutWidth = size.width;
  const layoutHeight = Math.max(size.height - headerOffset, 1);

  const { positions, contentHeight, laneLayouts } = useMemo(
    () =>
      layoutWidth > 0
        ? layoutLaneNodes(data.nodes, lanes, layoutWidth, layoutHeight, 0, 0)
        : {
            positions: new Map(),
            contentHeight: layoutHeight,
            contentWidth: 0,
            laneLayouts: [] as { id: string; left: number; width: number }[],
          },
    [data.nodes, lanes, layoutHeight, layoutWidth]
  );

  const laneCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const lane of lanes) {
      counts[lane.id] = data.nodes.filter((n) =>
        lane.match ? lane.match(n) : lane.types.includes(n.type)
      ).length;
    }
    return counts;
  }, [data.nodes, lanes]);

  const svgHeight = Math.max(layoutHeight, contentHeight);
  const svgWidth = layoutWidth;

  const truncateLabel = (label: string, maxWidth: number): string => {
    const maxChars = Math.max(6, Math.floor(maxWidth / 5.4));
    if (label.length <= maxChars) return label;
    return `${label.slice(0, Math.max(1, maxChars - 1))}…`;
  };

  const renderNodeLabel = (
    node: GraphNode,
    maxWidth: number,
    inFocus: boolean,
    isActive: boolean
  ) => {
    const label = truncateLabel(node.label, maxWidth);
    const labelY = 11;

    if (isActive) {
      const boxWidth = Math.min(maxWidth, Math.max(label.length * 5.6 + 14, 56));
      return (
        <g opacity={inFocus ? 1 : 0.35}>
          <title>{node.label}</title>
          <rect
            x={-boxWidth / 2}
            y={labelY - 2}
            width={boxWidth}
            height={16}
            rx={3}
            fill="hsl(var(--background))"
            stroke="hsl(var(--foreground))"
            strokeWidth={1}
          />
          <text
            x={0}
            y={labelY + 9}
            textAnchor="middle"
            fill="hsl(var(--foreground))"
            style={{
              fontFamily: "Figtree, system-ui, sans-serif",
              fontSize: 10,
              fontWeight: 600,
            }}
          >
            {label}
          </text>
        </g>
      );
    }

    return (
      <g opacity={inFocus ? 1 : 0.35}>
        <title>{node.label}</title>
        <text
          x={0}
          y={labelY + 9}
          textAnchor="middle"
          fill="hsl(var(--muted-foreground))"
          style={{
            fontFamily: "Figtree, system-ui, sans-serif",
            fontSize: 10,
            fontWeight: 500,
          }}
        >
          {label}
        </text>
      </g>
    );
  };

  const renderLink = (link: GraphLink, index: number) => {
    const source = linkEndpointId(link.source);
    const target = linkEndpointId(link.target);
    const from = positions.get(source);
    const to = positions.get(target);
    if (!from || !to) return null;

    const focused = isLinkFocused(link, focus);
    const opacity = activeId ? (focused ? 0.9 : 0.06) : 0.22;

    return (
      <g key={`${source}-${target}-${index}`} opacity={opacity}>
        <line
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke="hsl(var(--foreground))"
          strokeWidth={focused && activeId ? 1.5 : 0.75}
        />
        {focused && activeId && (
          <text
            x={(from.x + to.x) / 2}
            y={(from.y + to.y) / 2 - 6}
            textAnchor="middle"
            className="fill-muted-foreground text-[9px] font-medium"
          >
            {link.relation.replace(/_/g, " ")}
          </text>
        )}
      </g>
    );
  };

  const renderNode = (node: GraphNode) => {
    const pos = positions.get(node.id);
    if (!pos) return null;

    const inFocus = !activeId || focus.has(node.id);
    const isActive = activeId === node.id;
    const radius = isActive ? 7 : 4;

    return (
      <g
        key={node.id}
        transform={`translate(${pos.x}, ${pos.y})`}
        className="cursor-pointer"
        onMouseEnter={() => {
          setHoverId(node.id);
          onFocus(node.id);
        }}
        onMouseLeave={() => setHoverId((prev) => (prev === node.id ? null : prev))}
        onClick={() => onSelect(node.id)}
      >
        <circle r={radius + 10} fill="transparent" />
        <circle
          r={radius}
          fill={nodeFill(node.type, inFocus, isActive)}
          stroke={nodeStroke(inFocus, isActive)}
          strokeWidth={isActive ? 2 : 1}
          opacity={inFocus ? 1 : 0.2}
        />
        {renderNodeLabel(node, pos.labelMaxWidth, inFocus, isActive)}
      </g>
    );
  };

  return (
    <div ref={shellRef} className="absolute inset-0 min-h-0 min-w-0 bg-background">
      <div
        className="h-full w-full overflow-y-auto overflow-x-hidden"
        onMouseLeave={() => {
          setHoverId(null);
          onFocus(null);
        }}
      >
        <div
          className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur-sm"
          style={{ width: svgWidth || "100%", height: headerOffset }}
        >
          <div className="relative h-full" style={{ width: svgWidth || "100%" }}>
            {laneLayouts.map((laneLayout) => {
              const lane = lanes.find((l) => l.id === laneLayout.id);
              if (!lane) return null;
              return (
                <div
                  key={laneLayout.id}
                  className="absolute top-0 flex h-full items-center justify-center overflow-hidden border-r border-border px-2 text-center last:border-r-0"
                  style={{ left: laneLayout.left, width: laneLayout.width }}
                >
                  <span className="truncate text-xs font-medium capitalize text-muted-foreground">
                    {lane.label} ({laneCounts[lane.id] ?? 0})
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="relative" style={{ width: svgWidth || "100%", height: svgHeight }}>
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.35]"
            style={{
              backgroundImage:
                "linear-gradient(hsl(var(--border) / 0.35) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--border) / 0.35) 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }}
          />

          {svgWidth > 0 && (
            <svg width={svgWidth} height={svgHeight} className="relative block">
              <g>{data.links.map(renderLink)}</g>
              <g>{data.nodes.map(renderNode)}</g>
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}
