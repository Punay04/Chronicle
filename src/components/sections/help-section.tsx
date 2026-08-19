import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/ui/page-header";
import { findMainSection } from "@/lib/nav";

export function HelpSection() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <PageHeader title="Support" description={findMainSection("help")?.description} />
      <div className="scrollbar-minimal min-h-0 flex-1 overflow-y-auto p-6">
        <div className="flex max-w-lg flex-col gap-4">
          <div>
            <label className="text-sm font-medium text-foreground" htmlFor="support-subject">
              Subject
            </label>
            <Input
              id="support-subject"
              className="mt-2"
              placeholder="What's on your mind?"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground" htmlFor="support-message">
              Message
            </label>
            <Textarea
              id="support-message"
              className="mt-2 h-32 resize-none"
              placeholder="Describe your issue or feedback…"
            />
          </div>
          <Button className="w-fit">Send Feedback</Button>
        </div>
      </div>
    </div>
  );
}
