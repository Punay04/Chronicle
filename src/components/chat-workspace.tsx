import React from "react";
import { ChatPanel } from "@/components/chat-panel";
import { ChatSidebar } from "@/components/chat-sidebar";
import { cn } from "@/lib/utils";

/**
 * Chat pane plus its conversation rail. Used both as the Assistant section of
 * the home window and as the standalone chat window, which previously carried
 * a near-copy of this layout with subtly different classes.
 */
export function ChatWorkspace({ className }: { className?: string }) {
  return (
    <div className={cn("flex min-h-0 flex-1", className)}>
      <div className="min-w-0 flex-1">
        <ChatPanel />
      </div>
      <aside className="hidden min-h-0 w-64 shrink-0 flex-col border-l border-border bg-surface lg:flex">
        <ChatSidebar />
      </aside>
    </div>
  );
}
