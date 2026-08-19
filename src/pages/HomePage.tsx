import React, { useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { AppShell, NavButton } from "@/components/app-shell";
import { RecordingStatus } from "@/components/recording-status";
import { ChatWorkspace } from "@/components/chat-workspace";
import { TimelineSection } from "@/components/sections/timeline-section";
import { WorkflowsSection } from "@/components/sections/workflows-section";
import { MeetingsSection } from "@/components/sections/meetings-section";
import { BrainSection } from "@/components/sections/brain-section";
import { ConnectionsSection } from "@/components/sections/connections-section";
import { HelpSection } from "@/components/sections/help-section";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { formatShortcut } from "@/lib/utils";
import {
  MAIN_NAV,
  SETTINGS_ICON,
  SETTINGS_LABEL,
  SETTINGS_SECTION_IDS,
  type MainSection,
} from "@/lib/nav";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { useRecordingStore } from "@/lib/stores/recording-store";
import { useChatStore } from "@/lib/stores/chat-store";
import { electron } from "@/lib/electron";

export function HomePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const section = (searchParams.get("section") || "home") as MainSection;
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
    if (SETTINGS_SECTION_IDS.has(section)) {
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

  // Deep links from the search window, which cannot re-run this window's route.
  useEffect(
    () => electron?.onNavigateSection?.((next) => setSearchParams({ section: next })),
    [setSearchParams]
  );

  const setSection = (s: MainSection) => setSearchParams({ section: s });
  const openSearch = () => electron?.openWindow("search");

  const nav = (
    <>
      {MAIN_NAV.filter((item) => !(disableTimeline && item.id === "timeline")).map((item) => (
        <NavButton
          key={item.id}
          icon={item.icon}
          label={item.label}
          active={section === item.id}
          onClick={() => setSection(item.id)}
        />
      ))}
      <div className="min-h-4 flex-1" />
      <NavButton
        icon={SETTINGS_ICON}
        label={SETTINGS_LABEL}
        onClick={() => navigate("/settings")}
      />
    </>
  );

  const headerActions = (
    <>
      <RecordingStatus />
      <Button variant="outline" size="sm" className="h-8 gap-2" onClick={openSearch}>
        <Search className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Search</span>
        <Kbd className="hidden sm:inline-flex">{formatShortcut("Cmd+K")}</Kbd>
      </Button>
    </>
  );

  return (
    <AppShell nav={nav} headerActions={headerActions}>
      {section === "home" && <ChatWorkspace />}
      {section === "timeline" && (
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <TimelineSection />
        </div>
      )}
      {section === "workflows" && <WorkflowsSection />}
      {section === "meetings" && <MeetingsSection />}
      {section === "brain" && (
        <div className="flex min-h-0 w-full min-w-0 flex-1 overflow-hidden">
          <BrainSection />
        </div>
      )}
      {section === "connections" && <ConnectionsSection />}
      {section === "help" && <HelpSection />}
    </AppShell>
  );
}
