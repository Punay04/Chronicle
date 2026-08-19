import React, { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  api,
  type MeetingDetail,
  type MeetingListItem,
} from "@/lib/api/client";
import { useRecordingStore } from "@/lib/stores/recording-store";
import { format } from "date-fns";

function meetingTitle(m: { title: string | null; started_at: string }): string {
  if (m.title) return m.title;
  try {
    return `meeting ${format(new Date(m.started_at), "MMM d, HH:mm")}`;
  } catch {
    return "meeting";
  }
}

function formatDuration(m: MeetingListItem): string {
  const start = new Date(m.started_at).getTime();
  const end = m.ended_at ? new Date(m.ended_at).getTime() : Date.now();
  const mins = Math.max(0, Math.round((end - start) / 60000));
  if (mins < 1) return "<1 min";
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function chunkTime(timestamp: string): string {
  try {
    return format(new Date(timestamp), "HH:mm:ss");
  } catch {
    return timestamp;
  }
}

export function MeetingsSection() {
  const [meetings, setMeetings] = useState<MeetingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  const [notes, setNotes] = useState("");
  const [summarizing, setSummarizing] = useState(false);
  const [summarizeError, setSummarizeError] = useState<string | null>(null);
  const meetingActive = useRecordingStore((s) => s.meetingActive);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const notesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadMeetings = useCallback(async () => {
    try {
      const res = await api.meetings();
      setMeetings(res.data);
    } catch {
      setMeetings([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMeetings();
    const interval = setInterval(() => void loadMeetings(), 15000);
    return () => clearInterval(interval);
  }, [loadMeetings, meetingActive]);

  const loadDetail = useCallback(async (id: number) => {
    try {
      const res = await api.meeting(id);
      setDetail(res);
    } catch {
      setDetail(null);
    }
  }, []);

  // Load detail on selection; seed notes
  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      return;
    }
    setSummarizeError(null);
    void api
      .meeting(selectedId)
      .then((res) => {
        setDetail(res);
        setNotes(res.notes ?? "");
      })
      .catch(() => setDetail(null));
  }, [selectedId]);

  // Poll a live meeting's transcript
  useEffect(() => {
    if (!detail?.live || selectedId === null) return;
    const interval = setInterval(() => void loadDetail(selectedId), 10000);
    return () => clearInterval(interval);
  }, [detail?.live, selectedId, loadDetail]);

  // Auto-scroll transcript when it grows on a live meeting
  useEffect(() => {
    if (detail?.live && transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [detail?.transcript.length, detail?.live]);

  const onNotesChange = (value: string) => {
    setNotes(value);
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    const idAtEdit = selectedId;
    notesTimerRef.current = setTimeout(() => {
      if (idAtEdit !== null) {
        void api.updateMeeting(idAtEdit, { notes: value }).catch(() => {});
      }
    }, 800);
  };

  useEffect(() => {
    return () => {
      if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    };
  }, []);

  const onSummarize = async () => {
    if (selectedId === null || summarizing) return;
    setSummarizing(true);
    setSummarizeError(null);
    try {
      const result = await api.summarizeMeeting(selectedId);
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              title: prev.title ?? result.title,
              summary: result.summary,
              action_items: result.action_items,
            }
          : prev
      );
      void loadMeetings();
    } catch (err) {
      setSummarizeError(err instanceof Error ? err.message : "summarize failed");
    } finally {
      setSummarizing(false);
    }
  };

  const selected = meetings.find((m) => m.id === selectedId) ?? null;
  const canSummarize =
    detail !== null && !detail.live && detail.transcript.length > 0;

  return (
    <div className="flex flex-col h-full min-h-0 min-w-0">
      <div className="page-header">
        <h1 className="page-header-title">Meetings</h1>
        <p className="page-header-desc">Transcripts from your microphone and meeting playback</p>
      </div>
      <div className="flex flex-1 min-h-0 min-w-0">
        <div className="w-72 border-r border-border overflow-y-auto scrollbar-hide shrink-0 bg-surface">
          <div className="px-4 py-3 border-b border-border">
            <span className="text-xs font-medium text-muted-foreground">All meetings</span>
          </div>
          {loading ? (
            <div className="px-4 py-6 text-sm text-muted-foreground">Loading…</div>
          ) : meetings.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground">
              No meetings yet. Turn on meeting notes to record one.
            </div>
          ) : (
            meetings.map((m) => (
              <button
                key={m.id}
                onClick={() => setSelectedId(m.id)}
                className={cn(
                  "w-full px-4 py-3 border-b border-border text-left transition-colors duration-150",
                  selectedId === m.id
                    ? "bg-accent"
                    : "hover:bg-accent/60"
                )}
              >
                <div className="text-sm font-medium flex items-center gap-2">
                  {m.live && (
                    <span className="w-2 h-2 rounded-full bg-foreground animate-pulse shrink-0" />
                  )}
                  <span className="truncate">{meetingTitle(m)}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {format(new Date(m.started_at), "MMM d, HH:mm")} ·{" "}
                  {formatDuration(m)} · {m.chunk_count}{" "}
                  {m.chunk_count === 1 ? "chunk" : "chunks"}
                  {m.live ? " · recording" : ""}
                </div>
              </button>
            ))
          )}
        </div>
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {selectedId !== null && detail ? (
            <>
              <div className="px-6 py-4 border-b border-border flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Mic
                    className={cn("w-4 h-4 shrink-0", detail.live && "animate-pulse")}
                  />
                  <span className="text-sm font-medium text-muted-foreground truncate">
                    {detail.live ? "Live transcript" : "Transcript"}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 shrink-0"
                  disabled={!canSummarize || summarizing}
                  onClick={() => void onSummarize()}
                >
                  {summarizing ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Sparkles className="w-3 h-3" />
                  )}
                  {detail.summary ? "re-summarize" : "summarize"}
                </Button>
              </div>
              <div
                ref={transcriptRef}
                className="flex-1 overflow-y-auto scrollbar-minimal p-6 space-y-6"
              >
                {(detail.summary || summarizeError) && (
                  <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
                    {summarizeError ? (
                      <p className="text-sm text-destructive">{summarizeError}</p>
                    ) : (
                      <>
                        <p className="text-sm leading-relaxed">{detail.summary}</p>
                        {detail.action_items && detail.action_items.length > 0 && (
                          <ul className="space-y-1.5">
                            {detail.action_items.map((item, i) => (
                              <li
                                key={i}
                                className="text-sm text-muted-foreground flex gap-2"
                              >
                                <span className="shrink-0">·</span>
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}
                  </div>
                )}
                {detail.transcript.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {detail.live
                      ? "Listening — transcript chunks appear every ~30s while speech is detected"
                      : "No speech transcribed in this meeting"}
                  </p>
                ) : (
                  detail.transcript.map((chunk) => (
                    <div key={chunk.id} className="flex gap-4">
                      <span className="text-xs text-muted-foreground shrink-0 pt-0.5 tabular-nums">
                        {chunkTime(chunk.timestamp)}
                      </span>
                      <p className="text-sm whitespace-pre-wrap leading-relaxed">
                        {chunk.transcription}
                      </p>
                    </div>
                  ))
                )}
              </div>
              <div className="border-t border-border p-4">
                <textarea
                  value={notes}
                  onChange={(e) => onNotesChange(e.target.value)}
                  className="w-full h-24 rounded-md border border-border bg-input p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  placeholder="Add meeting notes…"
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm px-8 text-center">
              {selected === null
                ? "Select a meeting to view its transcript and notes"
                : "Loading meeting…"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
