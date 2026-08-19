import React from "react";
import { ChatPanel } from "@/components/chat-panel";
import { ChatSidebar } from "@/components/chat-sidebar";

export function ChatPage() {
  return (
    <div className="flex h-screen min-h-0">
      <div className="flex-1 min-w-0">
        <ChatPanel />
      </div>
      <div className="w-64 border-l border-border flex flex-col min-h-0">
        <ChatSidebar />
      </div>
    </div>
  );
}
