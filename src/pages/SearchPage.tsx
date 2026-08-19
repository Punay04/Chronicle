import React, { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { electron } from "@/lib/electron";
import { api, type SearchResultItem } from "@/lib/api/client";
import { formatDistanceToNow } from "date-fns";

function formatResultTime(timestamp: string): string {
  try {
    return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
  } catch {
    return timestamp;
  }
}

const RESULT_TYPE_LABELS: Record<string, string> = {
  OCR: "Screen",
  Audio: "Recording",
  Accessibility: "Screen",
  UI: "Screen",
};

/** Which home section a result belongs to, for click-through. */
const RESULT_SECTIONS: Record<string, string> = {
  OCR: "timeline",
  Accessibility: "timeline",
  UI: "timeline",
  Audio: "meetings",
};

function resultType(item: SearchResultItem): string {
  return RESULT_TYPE_LABELS[item.type] ?? item.type;
}

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.search({
          q: query,
          limit: 30,
          content_type: "all",
        });
        setResults(res.data);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") electron?.closeWindow();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const openResult = (item: SearchResultItem) => {
    void electron?.openWindow("home", RESULT_SECTIONS[item.type] ?? "timeline");
    electron?.closeWindow();
  };

  return (
    <div className="flex min-h-screen items-start justify-center bg-transparent px-4 pt-16">
      <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
        <div className="flex items-center border-b border-border">
          <Search className="w-4 h-4 ml-4 text-muted-foreground shrink-0" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your history, recordings, and chats…"
            className="border-0 focus-visible:ring-0 h-12 rounded-none"
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => electron?.closeWindow()}
            className="h-12 w-12 rounded-none shrink-0"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
        <div className="max-h-80 overflow-y-auto scrollbar-minimal">
          {loading && (
            <div className="p-6 text-sm text-muted-foreground">Searching…</div>
          )}
          {!loading && results.length === 0 && query && (
            <div className="p-6 text-sm text-muted-foreground">
              No results for &ldquo;{query}&rdquo;
            </div>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.content.frame_id ?? r.content.audio_chunk_id ?? i}`}
              onClick={() => openResult(r)}
              className="flex w-full items-center justify-between gap-4 border-b border-border px-4 py-3 text-left transition-colors duration-fast hover:bg-accent"
            >
              <div className="min-w-0">
                <span className="mr-2 text-xs font-medium text-muted-foreground">
                  {resultType(r)}
                </span>
                <span className="text-sm truncate block">
                  {r.content.text.slice(0, 120)}
                  {r.content.text.length > 120 ? "…" : ""}
                </span>
                {r.content.app_name && (
                  <span className="text-xs text-muted-foreground block mt-1">
                    {r.content.app_name}
                    {r.content.window_name ? ` · ${r.content.window_name}` : ""}
                  </span>
                )}
              </div>
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                {formatResultTime(r.content.timestamp)}
              </span>
            </button>
          ))}
          {!query && (
            <div className="p-6 text-sm text-muted-foreground">
              Type to search your history, recordings, and chats
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
