import React, { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { findMainSection } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { api, loadFrameImageSrc, type FrameRow } from "@/lib/api/client";
import { useRecordingStore } from "@/lib/stores/recording-store";
import { format } from "date-fns";

function formatFrameTime(timestamp: string): string {
  try {
    return format(new Date(timestamp), "HH:mm");
  } catch {
    return timestamp;
  }
}

export function TimelineSection() {
  const [frames, setFrames] = useState<FrameRow[]>([]);
  const [current, setCurrent] = useState(0);
  const [frameText, setFrameText] = useState("");
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const [loading, setLoading] = useState(true);
  const followLatestRef = useRef(true);
  const thumbStripRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef(0);
  const imageObjectUrlRef = useRef<string | null>(null);
  currentRef.current = current;
  const isGloballyPaused = useRecordingStore((s) => s.isGloballyPaused);
  const resumeAll = useRecordingStore((s) => s.resumeAll);

  useEffect(() => {
    async function loadFrames() {
      try {
        const res = await api.frames({ limit: 100 });
        const ordered = res.data.reverse();

        setFrames((prev) => {
          const wasFollowing =
            followLatestRef.current ||
            prev.length === 0 ||
            currentRef.current >= prev.length - 1;

          if (wasFollowing && ordered.length > 0) {
            setCurrent(ordered.length - 1);
            followLatestRef.current = true;
          } else if (ordered.length > 0) {
            setCurrent((c) => Math.min(c, ordered.length - 1));
          }

          return ordered;
        });
      } catch {
        setFrames([]);
      } finally {
        setLoading(false);
      }
    }

    void loadFrames();
    const interval = setInterval(() => void loadFrames(), 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (frames.length === 0) return;
    const frame = frames[current];
    if (!frame) return;

    async function loadFrameDetail() {
      setImageError(false);
      if (imageObjectUrlRef.current?.startsWith("blob:")) {
        URL.revokeObjectURL(imageObjectUrlRef.current);
        imageObjectUrlRef.current = null;
      }
      try {
        const textRes = await api.frameText(frame.id);
        setFrameText(textRes.text || "no text captured");
        const src = await loadFrameImageSrc(frame.id);
        imageObjectUrlRef.current = src.startsWith("blob:") ? src : null;
        setImageSrc(src);
      } catch {
        setFrameText("failed to load frame");
        setImageSrc(null);
        setImageError(true);
      }
    }

    void loadFrameDetail();
    return () => {
      if (imageObjectUrlRef.current?.startsWith("blob:")) {
        URL.revokeObjectURL(imageObjectUrlRef.current);
        imageObjectUrlRef.current = null;
      }
    };
  }, [frames, current]);

  useEffect(() => {
    const strip = thumbStripRef.current;
    if (!strip) return;
    const active = strip.querySelector<HTMLElement>('[data-active="true"]');
    if (!active) return;

    const target =
      active.offsetLeft - strip.clientWidth / 2 + active.clientWidth / 2;
    const maxScroll = strip.scrollWidth - strip.clientWidth;
    strip.scrollTo({
      left: Math.max(0, Math.min(target, maxScroll)),
      behavior: "smooth",
    });
  }, [current, frames.length]);

  const goToFrame = (index: number) => {
    followLatestRef.current = index >= frames.length - 1;
    setCurrent(index);
  };

  const goToLatest = () => {
    if (frames.length === 0) return;
    followLatestRef.current = true;
    setCurrent(frames.length - 1);
  };

  if (loading) {
    return (
      <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
        <PageHeader title="History" description={findMainSection("timeline")?.description} />
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Loading snapshots…
        </div>
      </div>
    );
  }

  if (frames.length === 0) {
    return (
      <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
        <PageHeader title="History" description={findMainSection("timeline")?.description} />
        <EmptyState
          icon={Clock}
          title="No snapshots yet"
          description="Once screen recording is running, everything Chronicle sees will appear here."
          action={
            isGloballyPaused ? (
              <Button variant="outline" size="sm" onClick={() => void resumeAll()}>
                Resume Screen Recording
              </Button>
            ) : null
          }
        />
      </div>
    );
  }

  const frame = frames[current];
  const atLatest = current === frames.length - 1;

  return (
    <div className="flex flex-col h-full min-h-0 min-w-0 w-full overflow-hidden">
      <PageHeader
        title="History"
        description={
          <>
            {frames.length.toLocaleString()} snapshots
            {followLatestRef.current && atLatest && !isGloballyPaused ? " · Live" : ""}
          </>
        }
        actions={
          !atLatest ? (
            <Button variant="outline" size="sm" onClick={goToLatest}>
              Jump to Latest
            </Button>
          ) : null
        }
      />

      {isGloballyPaused && (
        <Card variant="muted" className="mx-6 mt-4 flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            Screen recording is paused. Resume to capture new snapshots.
          </p>
          <Button variant="outline" size="sm" onClick={() => void resumeAll()} className="shrink-0">
            Resume
          </Button>
        </Card>
      )}

      <div className="flex-1 flex flex-col min-h-0 min-w-0 p-6 gap-4 overflow-hidden">
        <div className="flex-1 rounded-lg border border-border bg-surface flex items-center justify-center relative min-h-[300px] overflow-hidden">
          {imageSrc && !imageError ? (
            <img
              src={imageSrc}
              alt={`Screen snapshot ${frame.id}`}
              className="max-w-full max-h-full object-contain"
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="text-center px-6">
              <p className="text-sm text-muted-foreground">
                Snapshot {frame.id} — {formatFrameTime(frame.timestamp)}
              </p>
              {imageError && (
                <p className="text-xs text-muted-foreground mt-2">
                  Screenshot preview unavailable
                </p>
              )}
            </div>
          )}
          <div className="absolute bottom-0 left-0 right-0 bg-background/90 backdrop-blur-sm border-t border-border p-3">
            <p className="text-xs text-muted-foreground line-clamp-2">
              {frame.app_name && <span className="mr-2">{frame.app_name}</span>}
              {frameText}
            </p>
          </div>
          <div className="absolute bottom-16 left-4 right-4 flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={() => goToFrame(Math.max(0, current - 1))}
              disabled={current === 0}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="flex-1 h-1 bg-border relative rounded-full overflow-hidden">
              <div
                className="absolute top-0 left-0 h-full bg-foreground transition-all duration-fast rounded-full"
                style={{ width: `${((current + 1) / frames.length) * 100}%` }}
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => goToFrame(Math.min(frames.length - 1, current + 1))}
              disabled={atLatest}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <div ref={thumbStripRef} className="flex gap-1 overflow-x-auto overflow-y-hidden scrollbar-hide pb-2 min-w-0 shrink-0">
          {frames.map((f, i) => (
            <button
              key={f.id}
              data-active={i === current ? "true" : "false"}
              onClick={() => goToFrame(i)}
              className={cn(
                "flex-shrink-0 w-20 h-14 rounded-md border text-[10px] transition-colors duration-fast",
                i === current
                  ? "border-foreground bg-accent text-foreground"
                  : "border-border text-muted-foreground hover:border-foreground/40 hover:bg-accent/50",
                i === frames.length - 1 && followLatestRef.current && !isGloballyPaused && "ring-2 ring-foreground/20"
              )}
            >
              {formatFrameTime(f.timestamp)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
