import React, { useState } from "react";
import { ChevronDown, X } from "lucide-react";
import type { MemoryNode } from "@/lib/api/client";
import type { GraphLink, MemoryGraphData } from "@/components/sections/memory-graph-canvas";
import { linkEndpointId } from "@/lib/memory-graph";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function nodeLabel(node: MemoryNode): string {
  const raw = node.title ?? node.content.slice(0, 80);
  return raw
    .replace(/^\[\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?)?\]\s*/i, "")
    .replace(/^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?)?[:\s-–—]+\s*/i, "")
    .trim();
}

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-accent transition-colors duration-150 rounded-md"
      >
        <span className="text-xs font-medium text-foreground">{title}</span>
        <ChevronDown
          className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform duration-150", open && "rotate-180")}
        />
      </button>
      {open && <div className="px-3 pb-3 pt-1 flex flex-col gap-2">{children}</div>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-right break-words">{value}</span>
    </div>
  );
}

interface MemoryNodeDetailProps {
  node: MemoryNode;
  graph: MemoryGraphData;
  pinned?: boolean;
  onClose?: () => void;
  onNavigate?: (id: string) => void;
}

export function MemoryNodeDetail({
  node,
  graph,
  pinned = false,
  onClose,
  onNavigate,
}: MemoryNodeDetailProps) {
  const connections = graph.links.filter((link) => {
    const source = linkEndpointId(link.source);
    const target = linkEndpointId(link.target);
    return source === node.id || target === node.id;
  });

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border border-border bg-background/95 backdrop-blur-sm shadow-md",
        pinned ? "h-full" : "max-h-[min(70vh,520px)]"
      )}
    >
      <div className="px-4 py-3 border-b border-border flex items-start justify-between gap-3 shrink-0">
        <div className="min-w-0 flex-1">
          <span className="inline-block text-xs font-medium rounded-full border border-border px-2 py-0.5 mb-2 text-muted-foreground capitalize">
            {node.type.replace(/_/g, " ")}
          </span>
          <p className="text-sm font-medium leading-snug">{nodeLabel(node)}</p>
        </div>
        {pinned && onClose && (
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}>
            <X className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      <div className="overflow-y-auto scrollbar-minimal p-4 flex flex-col gap-3">
        <p className="text-sm text-muted-foreground leading-relaxed">
          {node.content.slice(0, 1200)}
          {node.content.length > 1200 ? "…" : ""}
        </p>

        <Section title="Source">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {node.title ?? "Extracted memory from the local graph"}
          </p>
        </Section>

        <Section title="Provenance">
          <Row label="Created" value={formatDate(node.created_at)} />
          <Row label="Updated" value={formatDate(node.updated_at)} />
          {node.app_name && <Row label="App" value={node.app_name} />}
          {node.window_name && <Row label="Window" value={node.window_name} />}
          {node.source_type && <Row label="Source" value={node.source_type} />}
          <Row label="Salience" value={node.salience.toFixed(2)} />
        </Section>

        <Section title="Relations" defaultOpen={connections.length > 0}>
          {connections.length === 0 ? (
            <p className="text-xs text-muted-foreground">No connections yet.</p>
          ) : (
            <div className="flex flex-col rounded-md border border-border overflow-hidden">
              {connections.map((link) => {
                const source = linkEndpointId(link.source);
                const target = linkEndpointId(link.target);
                const otherId = source === node.id ? target : source;
                const other = graph.nodes.find((n) => n.id === otherId);
                if (!other) return null;
                return (
                  <button
                    key={`${source}-${target}-${link.relation}`}
                    type="button"
                    onClick={() => onNavigate?.(otherId)}
                    className="flex items-center justify-between px-3 py-2 border-b border-border last:border-b-0 hover:bg-accent transition-colors duration-150 text-left"
                  >
                    <span className="text-xs truncate min-w-0">{other.label}</span>
                    <span className="text-xs text-muted-foreground shrink-0 ml-2 capitalize">
                      {link.relation.replace(/_/g, " ")}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
