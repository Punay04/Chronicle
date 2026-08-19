import React, { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Send } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { electron } from "@/lib/electron";
import { LiveVoiceSession } from "@/lib/live-voice";
import { cn } from "@/lib/utils";
import {
  useChatStore,
  simulateAssistantReply,
  commitLiveTurn,
  type ChatMessage,
} from "@/lib/stores/chat-store";

function getSafeExternalUrl(href?: string): string | null {
  if (!href) return null;

  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function MarkdownMessage({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      urlTransform={(url) => getSafeExternalUrl(url) ?? ""}
      components={{
        a: ({ href, children, ...props }) => {
          const safeUrl = getSafeExternalUrl(href);
          if (!safeUrl) return <span>{children}</span>;

          return (
            <a
              {...props}
              href={safeUrl}
              onClick={(event) => {
                event.preventDefault();
                if (electron?.openExternal) {
                  void electron.openExternal(safeUrl);
                } else {
                  window.open(safeUrl, "_blank", "noopener,noreferrer");
                }
              }}
            >
              {children}
            </a>
          );
        },
        table: ({ children, ...props }) => (
          <div className="max-w-full overflow-x-auto">
            <table {...props}>{children}</table>
          </div>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function MessageBlock({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const time = new Date(message.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={cn("flex flex-col gap-1.5", isUser && "items-end")}>
      <div className={cn("flex items-center gap-2", isUser && "flex-row-reverse")}>
        <span className="text-xs font-medium text-foreground capitalize">{message.role}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{time}</span>
      </div>
      <div
        className={cn(
          "min-w-0 max-w-[85%] rounded-lg px-4 py-3 text-sm leading-relaxed",
          isUser
            ? "whitespace-pre-wrap bg-primary text-primary-foreground"
            : [
                "prose prose-sm max-w-none break-words border border-border bg-surface text-foreground",
                "prose-headings:mb-2 prose-headings:mt-4 prose-headings:text-foreground",
                "prose-p:my-2 prose-p:text-foreground prose-ul:my-2 prose-ol:my-2",
                "prose-li:my-0.5 prose-li:text-foreground prose-strong:text-foreground",
                "prose-blockquote:border-border prose-blockquote:text-muted-foreground",
                "prose-a:text-primary prose-a:cursor-pointer prose-a:no-underline hover:prose-a:underline",
                "prose-code:break-words prose-code:font-mono prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none",
                "prose-pre:max-w-full prose-pre:overflow-x-auto prose-pre:whitespace-pre prose-pre:rounded-md prose-pre:border prose-pre:border-border prose-pre:bg-surface-secondary",
                "prose-table:my-2 prose-th:text-foreground prose-td:text-foreground",
                "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
              ]
        )}
      >
        {isUser ? message.content : <MarkdownMessage content={message.content} />}
      </div>
    </div>
  );
}

export function ChatPanel({ className }: { className?: string }) {
  const currentId = useChatStore((s) => s.currentId);
  const sessions = useChatStore((s) => s.sessions);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const isLiveVoice = useChatStore((s) => s.isLiveVoice);
  const liveUserPartial = useChatStore((s) => s.liveUserPartial);
  const liveAssistantPartial = useChatStore((s) => s.liveAssistantPartial);
  const { addMessage, setLiveVoice, setLivePartials } = useChatStore((s) => s.actions);
  const [input, setInput] = useState("");
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveConnecting, setLiveConnecting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<LiveVoiceSession | null>(null);

  const session = currentId ? sessions[currentId] : null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [
    session?.messages.length,
    isStreaming,
    isLiveVoice,
    liveUserPartial,
    liveAssistantPartial,
  ]);

  useEffect(() => {
    return () => {
      liveRef.current?.stop();
      liveRef.current = null;
    };
  }, []);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !currentId || isStreaming || isLiveVoice) return;
    setInput("");
    addMessage(currentId, { role: "user", content: text });
    await simulateAssistantReply(currentId, text);
  };

  const stopLive = () => {
    liveRef.current?.stop();
    liveRef.current = null;
    setLiveVoice(false);
    setLiveConnecting(false);
    setLivePartials("", "");
  };

  const toggleLive = async () => {
    if (!currentId) return;

    if (isLiveVoice || liveConnecting) {
      stopLive();
      return;
    }

    setLiveError(null);
    setLiveConnecting(true);

    if (electron?.permissions?.request) {
      try {
        await electron.permissions.request("microphone");
      } catch {
        // continue — getUserMedia will surface the real failure
      }
    }

    const history =
      session?.messages
        .filter((message) => message.id !== "welcome")
        .map((message) => ({
          role: message.role,
          content: message.content,
        })) ?? [];

    const sessionId = currentId;
    const live = new LiveVoiceSession({
      onReady: () => {
        setLiveConnecting(false);
        setLiveVoice(true);
      },
      onUserTranscript: (text) => {
        const { liveAssistantPartial: assistantPartial } =
          useChatStore.getState();
        setLivePartials(text, assistantPartial);
      },
      onAssistantTranscript: (text) => {
        const { liveUserPartial: userPartial } = useChatStore.getState();
        setLivePartials(userPartial, text);
      },
      onTurnComplete: (user, assistant) => {
        commitLiveTurn(sessionId, user, assistant);
      },
      onInterrupted: () => {
        const { liveUserPartial: userPartial } = useChatStore.getState();
        setLivePartials(userPartial, "");
      },
      onError: (message) => {
        setLiveError(message);
        // Don't call stopLive here if already tearing down — just update UI.
        if (liveRef.current) {
          liveRef.current.stop();
          liveRef.current = null;
        }
        setLiveVoice(false);
        setLiveConnecting(false);
        setLivePartials("", "");
        addMessage(sessionId, {
          role: "assistant",
          content: `sorry, live voice failed.\n\n${message}`,
        });
      },
      onClosed: () => {
        liveRef.current = null;
        setLiveVoice(false);
        setLiveConnecting(false);
        setLivePartials("", "");
      },
    });

    liveRef.current = live;

    try {
      await live.start({
        messages: history,
        contextQuery: history.filter((m) => m.role === "user").at(-1)?.content,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "failed to start live voice";
      setLiveError(message);
      stopLive();
      addMessage(sessionId, {
        role: "assistant",
        content: `sorry, live voice failed.\n\n${message}`,
      });
    }
  };

  return (
    <div className={cn("flex flex-col h-full min-h-0", className)}>
      <div className="page-header">
        <h1 className="page-header-title">Chat</h1>
        <p className="page-header-desc">Ask questions about your captured context</p>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-minimal px-6 py-6">
        <div className="flex flex-col gap-6 max-w-3xl mx-auto">
          {session?.messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-sm text-muted-foreground max-w-sm">
                Start a conversation. Your assistant can search screen history, audio, and connected apps.
              </p>
            </div>
          )}
          {session?.messages.map((msg) => (
            <MessageBlock key={msg.id} message={msg} />
          ))}
          {isLiveVoice && liveUserPartial && (
            <div className="flex flex-col gap-1.5 items-end opacity-70">
              <span className="text-xs font-medium text-foreground">you (live)</span>
              <div className="max-w-[85%] rounded-lg px-4 py-3 text-sm whitespace-pre-wrap bg-primary/80 text-primary-foreground">
                {liveUserPartial}
              </div>
            </div>
          )}
          {isLiveVoice && liveAssistantPartial && (
            <div className="flex flex-col gap-1.5 opacity-70">
              <span className="text-xs font-medium text-foreground">assistant (live)</span>
              <div className="max-w-[85%] rounded-lg border border-border bg-surface px-4 py-3 text-sm whitespace-pre-wrap">
                {liveAssistantPartial}
              </div>
            </div>
          )}
          {isStreaming && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="inline-flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-pulse" />
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-pulse [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-pulse [animation-delay:300ms]" />
              </span>
              Thinking…
            </div>
          )}
          {(isLiveVoice || liveConnecting) && !isStreaming && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500/60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
              </span>
              {liveConnecting ? "Connecting live voice…" : "Listening — speak naturally"}
            </div>
          )}
          {liveError && (
            <p className="text-sm text-destructive">{liveError}</p>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="p-4 shrink-0 border-t border-border bg-background">
        <div className="flex gap-2 max-w-3xl mx-auto">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder={isLiveVoice ? "Live voice active…" : "Ask anything…"}
            className="flex-1"
            disabled={isLiveVoice || liveConnecting}
          />
          <Button
            type="button"
            variant={isLiveVoice || liveConnecting ? "destructive" : "outline"}
            onClick={() => void toggleLive()}
            disabled={isStreaming || !currentId}
            className="shrink-0 gap-2"
            title={isLiveVoice ? "Stop live voice" : "Start live voice"}
          >
            {isLiveVoice || liveConnecting ? (
              <MicOff className="w-3.5 h-3.5" />
            ) : (
              <Mic className="w-3.5 h-3.5" />
            )}
            {isLiveVoice || liveConnecting ? "Stop" : "Voice"}
          </Button>
          <Button
            onClick={handleSend}
            disabled={!input.trim() || isStreaming || isLiveVoice || liveConnecting}
            className="gap-2 shrink-0"
          >
            Send
            <Send className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
