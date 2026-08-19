import React, { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  Brain,
  Clock,
  HelpCircle,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  MessageSquare,
  Search,
  Settings as SettingsIcon,
  Workflow,
} from "lucide-react";
import { AppSidebar, useSidebarContext } from "@/components/app-sidebar";
import { RecordingStatus } from "@/components/recording-status";
import { ChatPanel } from "@/components/chat-panel";
import { ChatSidebar } from "@/components/chat-sidebar";
import { TimelineSection } from "@/components/sections/timeline-section";
import { WorkflowsSection } from "@/components/sections/workflows-section";
import { MeetingsSection } from "@/components/sections/meetings-section";
import { BrainSection } from "@/components/sections/brain-section";
import { ConnectionsSection } from "@/components/sections/connections-section";
import { HelpSection } from "@/components/sections/help-section";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { cn, formatShortcut } from "@/lib/utils";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { useRecordingStore } from "@/lib/stores/recording-store";
import { useChatStore } from "@/lib/stores/chat-store";
import { electron } from "@/lib/electron";

type MainSection =
  | "home"
  | "timeline"
  | "workflows"
  | "meetings"
  | "brain"
  | "connections"
  | "help"
  | "history";

const NAV_ITEMS: { id: MainSection; label: string; icon: React.ElementType }[] = [
  { id: "home", label: "Chat", icon: MessageSquare },
  { id: "timeline", label: "Timeline", icon: Clock },
  { id: "workflows", label: "Workflows", icon: Workflow },
  { id: "meetings", label: "Meetings", icon: NotebookPen },
  { id: "brain", label: "Brain", icon: Brain },
  { id: "connections", label: "Connections", icon: Plug },
  { id: "help", label: "Help", icon: HelpCircle },
];

const SETTINGS_SECTIONS = new Set([
  "display", "general", "recording", "ai", "shortcuts", "privacy", "storage",
]);

export function HomePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const section = (searchParams.get("section") || "home") as MainSection;
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { isTranslucent } = useSidebarContext();
  const disableTimeline = useSettingsStore((s) => s.settings.disableTimeline);
  const tick = useRecordingStore((s) => s.tick);
  const syncFromBackend = useRecordingStore((s) => s.syncFromBackend);
  const { createSession } = useChatStore((s) => s.actions);

  useEffect(() => {
    void syncFromBackend();
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, [tick, syncFromBackend]);

  useEffect(() => {
    if (SETTINGS_SECTIONS.has(section)) {
      navigate(`/settings?section=${section}`);
    }
  }, [section, navigate]);

  useEffect(() => {
    if (searchParams.get("section") === "pipes") {
      setSearchParams({ section: "workflows" });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (disableTimeline && section === "timeline") {
      setSearchParams({ section: "home" });
    }
  }, [disableTimeline, section, setSearchParams]);

  useEffect(() => {
    const sessions = useChatStore.getState().sessions;
    if (Object.keys(sessions).length === 0) {
      createSession();
    }
  }, [createSession]);

  const setSection = (s: MainSection) => setSearchParams({ section: s });
  const openSearch = () => electron?.openWindow("search");

  return (
    <TooltipProvider>
      <div className="flex flex-col h-screen min-h-0 min-w-0 flex-1">
        <header
          className={cn(
            "shrink-0 flex items-center justify-between gap-3 px-4 h-12 border-b",
            isTranslucent ? "border-border/60 bg-background/80 backdrop-blur-md" : "border-border bg-background"
          )}
        >
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setSidebarOpen((o) => !o)}
                >
                  {sidebarOpen ? (
                    <PanelLeftClose className="w-4 h-4" />
                  ) : (
                    <PanelLeftOpen className="w-4 h-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Toggle sidebar</TooltipContent>
            </Tooltip>
            <span className="text-sm font-semibold text-foreground tracking-tight">Chronicle</span>
          </div>

          <div className="flex items-center gap-2">
            <RecordingStatus />
            <Button variant="outline" size="sm" className="gap-2 h-8" onClick={openSearch}>
              <Search className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Search</span>
              <kbd className="hidden sm:inline-flex h-5 items-center rounded border border-border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
                {formatShortcut("Cmd+K")}
              </kbd>
            </Button>
          </div>
        </header>

        <div className="flex flex-1 min-h-0 min-w-0">
          {sidebarOpen && (
            <AppSidebar>
              <nav className="flex flex-col flex-1 min-h-0 gap-0.5">
                {NAV_ITEMS.filter((item) => !(disableTimeline && item.id === "timeline")).map(
                  (item) => {
                    const Icon = item.icon;
                    const active = section === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => setSection(item.id)}
                        className={cn("nav-item w-full", active && "nav-item-active")}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        {item.label}
                      </button>
                    );
                  }
                )}
                <div className="flex-1 min-h-4" />
                <button
                  onClick={() => navigate("/settings")}
                  className="nav-item w-full"
                >
                  <SettingsIcon className="w-4 h-4 shrink-0" />
                  Settings
                </button>
              </nav>
            </AppSidebar>
          )}

          <main className="flex flex-1 min-h-0 min-w-0 w-full bg-background">
            {section === "home" && (
              <div className="flex flex-1 min-h-0">
                <div className="flex-1 min-w-0">
                  <ChatPanel />
                </div>
                <div className="w-64 border-l border-border hidden lg:flex flex-col min-h-0 bg-surface">
                  <ChatSidebar />
                </div>
              </div>
            )}
            {section === "timeline" && (
              <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
                <TimelineSection />
              </div>
            )}
            {section === "workflows" && <WorkflowsSection />}
            {section === "meetings" && <MeetingsSection />}
            {section === "brain" && (
              <div className="flex flex-1 min-h-0 min-w-0 w-full overflow-hidden">
                <BrainSection />
              </div>
            )}
            {section === "connections" && <ConnectionsSection />}
            {section === "help" && <HelpSection />}
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
