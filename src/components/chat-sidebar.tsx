import React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/lib/stores/chat-store";
import { formatDistanceToNow } from "date-fns";

export function ChatSidebar() {
  const sessions = useChatStore((s) => s.sessions);
  const currentId = useChatStore((s) => s.currentId);
  const { setCurrent, createSession } = useChatStore((s) => s.actions);

  const sorted = Object.values(sessions).sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-3 border-b border-border flex justify-between items-center">
        <span className="text-xs font-medium text-muted-foreground">Threads</span>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => createSession()}>
          <Plus className="w-3.5 h-3.5" />
          New
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-hide p-2 space-y-0.5">
        {sorted.map((session) => (
          <button
            key={session.id}
            onClick={() => setCurrent(session.id)}
            className={cn(
              "w-full rounded-md px-3 py-2 text-left transition-colors duration-150",
              currentId === session.id
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            )}
          >
            <div className="text-sm font-medium truncate">{session.title}</div>
            <div className="text-xs text-muted-foreground tabular-nums mt-0.5">
              {formatDistanceToNow(session.updatedAt, { addSuffix: true })}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
