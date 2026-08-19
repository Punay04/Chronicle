import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function HelpSection() {
  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto scrollbar-minimal">
      <div className="page-header">
        <h1 className="page-header-title">Help</h1>
        <p className="page-header-desc">Feedback and support</p>
      </div>
      <div className="p-6 max-w-lg flex flex-col gap-4">
        <div>
          <label className="text-sm font-medium text-foreground">Subject</label>
          <Input className="mt-2" placeholder="What's on your mind?" />
        </div>
        <div>
          <label className="text-sm font-medium text-foreground">Message</label>
          <textarea
            className="mt-2 w-full h-32 rounded-md border border-border bg-input p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            placeholder="Describe your issue or feedback…"
          />
        </div>
        <Button className="w-fit">Send feedback</Button>
      </div>
    </div>
  );
}
