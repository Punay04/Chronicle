import type { GraphLink, GraphNode, MemoryGraphData } from "@/components/sections/memory-graph-canvas";
import { linkEndpointId } from "@/lib/memory-graph";

export interface GraphLane {
  id: string;
  label: string;
  types: string[];
  match?: (node: GraphNode) => boolean;
}

export interface NodePosition {
  x: number;
  y: number;
  labelMaxWidth: number;
}

export interface LaneLayout {
  id: string;
  left: number;
  width: number;
}

export interface LayoutResult {
  positions: Map<string, NodePosition>;
  contentHeight: number;
  contentWidth: number;
  laneLayouts: LaneLayout[];
}

const MIN_CELL_W = 64;
const MIN_CELL_H = 56;
const NODE_Y_INSET = 12;
/** Keep labels from clipping the lane edge. */
const EDGE_INSET = 4;
const MIN_LANE_W = 88;

function nodeInLane(node: GraphNode, lane: GraphLane): boolean {
  if (lane.match) return lane.match(node);
  return lane.types.includes(node.type);
}

/** Spread columns so the first sits on the left edge and the last on the right. */
function colX(col: number, cols: number, laneLeft: number, laneWidth: number): number {
  if (cols <= 1) return laneLeft + laneWidth / 2;
  const inner = Math.max(laneWidth - EDGE_INSET * 2, 1);
  return laneLeft + EDGE_INSET + (col / (cols - 1)) * inner;
}

function layoutNodesInGrid(
  laneNodes: GraphNode[],
  laneLeft: number,
  laneWidth: number,
  startY: number,
  availableHeight: number
): { positions: Map<string, NodePosition>; height: number } {
  const positions = new Map<string, NodePosition>();
  if (laneNodes.length === 0) {
    return { positions, height: availableHeight };
  }

  const cols = Math.max(
    1,
    Math.min(laneNodes.length, Math.floor(Math.max(laneWidth, MIN_CELL_W) / MIN_CELL_W))
  );
  const rows = Math.ceil(laneNodes.length / cols);
  const contentHeight = Math.max(availableHeight, rows * MIN_CELL_H + 16);
  const cellH = contentHeight / rows;
  const approxCellW = laneWidth / cols;
  const labelMaxWidth = Math.max(36, approxCellW - 4);

  laneNodes.forEach((node, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const isLastRow = row === rows - 1;
    const nodesInRow = isLastRow ? laneNodes.length - row * cols : cols;

    // Partial last row also spans full lane width edge-to-edge.
    const x =
      nodesInRow === cols
        ? colX(col, cols, laneLeft, laneWidth)
        : colX(col, nodesInRow, laneLeft, laneWidth);

    positions.set(node.id, {
      x,
      y: startY + cellH * row + NODE_Y_INSET,
      labelMaxWidth:
        nodesInRow === cols
          ? labelMaxWidth
          : Math.max(36, laneWidth / nodesInRow - 4),
    });
  });

  return { positions, height: contentHeight };
}

export function getFocusSet(graph: MemoryGraphData, nodeId: string | null): Set<string> {
  if (!nodeId) return new Set();
  const focus = new Set<string>([nodeId]);
  for (const link of graph.links) {
    const source = linkEndpointId(link.source);
    const target = linkEndpointId(link.target);
    if (source === nodeId) focus.add(target);
    if (target === nodeId) focus.add(source);
  }
  return focus;
}

export function isLinkFocused(link: GraphLink, focus: Set<string>): boolean {
  if (focus.size === 0) return true;
  const source = linkEndpointId(link.source);
  const target = linkEndpointId(link.target);
  return focus.has(source) && focus.has(target);
}

export function buildTypeLanes(graph: MemoryGraphData): GraphLane[] {
  const types = [...new Set(graph.nodes.map((n) => n.type))].sort();
  return types.map((type) => ({
    id: type,
    label: type.replace(/_/g, " "),
    types: [type],
  }));
}

function allocateLaneWidths(counts: number[], usableWidth: number): number[] {
  const n = counts.length;
  if (n === 0) return [];
  if (n === 1) return [usableWidth];

  const total = counts.reduce((sum, c) => sum + Math.max(c, 1), 0);
  const widths = counts.map((c) => (Math.max(c, 1) / total) * usableWidth);

  // Clamp small lanes to a minimum, pull from the largest lane.
  for (let i = 0; i < widths.length; i++) {
    if (widths[i] >= MIN_LANE_W) continue;
    const deficit = MIN_LANE_W - widths[i];
    const largest = widths.indexOf(Math.max(...widths));
    if (largest === i || widths[largest] - deficit < MIN_LANE_W) continue;
    widths[i] = MIN_LANE_W;
    widths[largest] -= deficit;
  }

  // Flush any float error into the last (usually largest) lane.
  const sum = widths.reduce((s, w) => s + w, 0);
  widths[widths.length - 1] += usableWidth - sum;
  return widths;
}

export function layoutLaneNodes(
  nodes: GraphNode[],
  lanes: GraphLane[],
  width: number,
  height: number,
  _padding = 0,
  topOffset = 0
): LayoutResult {
  const positions = new Map<string, NodePosition>();
  const laneLayouts: LaneLayout[] = [];
  // Use the full measured width — no side padding.
  const usableWidth = Math.max(width, 200);
  const startY = topOffset + 8;
  const availableHeight = Math.max(height - startY - 8, 200);

  const counts = lanes.map(
    (lane) => nodes.filter((node) => nodeInLane(node, lane)).length
  );
  const widths = allocateLaneWidths(counts, usableWidth);

  let maxContentHeight = availableHeight;
  let laneLeft = 0;

  for (let laneIndex = 0; laneIndex < lanes.length; laneIndex++) {
    const lane = lanes[laneIndex];
    const laneNodes = nodes
      .filter((node) => nodeInLane(node, lane))
      .sort(
        (a, b) =>
          new Date(a.memory.created_at).getTime() - new Date(b.memory.created_at).getTime()
      );
    const laneWidth = widths[laneIndex] ?? usableWidth;

    laneLayouts.push({ id: lane.id, left: laneLeft, width: laneWidth });

    const { positions: lanePositions, height: laneHeight } = layoutNodesInGrid(
      laneNodes,
      laneLeft,
      laneWidth,
      startY,
      availableHeight
    );

    for (const [id, pos] of lanePositions) {
      positions.set(id, pos);
    }
    maxContentHeight = Math.max(maxContentHeight, laneHeight);
    laneLeft += laneWidth;
  }

  return {
    positions,
    contentHeight: maxContentHeight,
    contentWidth: usableWidth,
    laneLayouts,
  };
}

export function countNodeKinds(graph: MemoryGraphData): number {
  return new Set(graph.nodes.map((n) => n.type)).size;
}
