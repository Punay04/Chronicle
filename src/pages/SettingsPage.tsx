import React, { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { AppShell, NavButton } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { PageHeader } from "@/components/ui/page-header";
import { SettingRow } from "@/components/ui/setting-row";
import { Switch } from "@/components/ui/switch";
import { formatShortcut } from "@/lib/utils";
import {
  SETTINGS_NAV,
  SETTINGS_SECTIONS,
  findSettingsSection,
  type SettingsSection,
} from "@/lib/nav";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { useRecordingStore } from "@/lib/stores/recording-store";
import { api, type AppConfig } from "@/lib/api/client";
import { electron } from "@/lib/electron";
import {
  PHASE_LABELS,
  initialRuntimeStatus,
  type RuntimeStatus,
} from "@/lib/runtime";

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return <Badge variant={ok ? "accent" : "default"}>{label}</Badge>;
}

function DisplaySection() {
  const { settings, setSetting } = useSettingsStore();

  return (
    <>
      <SettingRow label="Dark Appearance" description="Warm dark surfaces instead of light paper">
        <Switch
          checked={settings.theme === "dark"}
          onCheckedChange={(v) => setSetting("theme", v ? "dark" : "light")}
        />
      </SettingRow>
      <SettingRow label="Translucent Sidebar" description="Frosted sidebar overlay">
        <Switch
          checked={settings.translucentSidebar}
          onCheckedChange={(v) => setSetting("translucentSidebar", v)}
        />
      </SettingRow>
      <SettingRow label="Hide History" description="Remove History from the sidebar">
        <Switch
          checked={settings.disableTimeline}
          onCheckedChange={(v) => setSetting("disableTimeline", v)}
        />
      </SettingRow>
      <SettingRow label="Text Size" description={`${settings.fontSize}px base`}>
        <input
          type="range"
          min={14}
          max={20}
          value={settings.fontSize}
          onChange={(e) => setSetting("fontSize", Number(e.target.value))}
          className="w-32 accent-primary"
          aria-label="Base text size"
        />
      </SettingRow>
    </>
  );
}

function GeneralSection() {
  const { settings, setSetting } = useSettingsStore();
  const [version, setVersion] = useState("—");

  useEffect(() => {
    void electron?.getVersion().then(setVersion);
    void electron?.getLoginItemSettings().then((item) => {
      if (item.openAtLogin !== settings.launchAtStartup) {
        setSetting("launchAtStartup", item.openAtLogin);
      }
    });
  }, [setSetting, settings.launchAtStartup]);

  const toggleLaunchAtStartup = async (enabled: boolean) => {
    setSetting("launchAtStartup", enabled);
    if (electron?.setLoginItemSettings) {
      await electron.setLoginItemSettings(enabled);
    }
  };

  return (
    <>
      <SettingRow label="Launch at Login" description="Open Chronicle when you sign in">
        <Switch checked={settings.launchAtStartup} onCheckedChange={toggleLaunchAtStartup} />
      </SettingRow>
      <SettingRow label="Version" description="Installed app version">
        <span className="text-sm tabular-nums text-muted-foreground">{version}</span>
      </SettingRow>
      <SettingRow label="Runtime Logs" description="Open the local runtime log folder">
        <Button variant="outline" size="sm" onClick={() => void electron?.runtime.openLogs()}>
          Open Logs
        </Button>
      </SettingRow>
      <SettingRow label="Updates" description="Download the latest release">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void electron?.openExternal("https://github.com/hydra-db/hydradb")}
        >
          Check Releases
        </Button>
      </SettingRow>
    </>
  );
}

function RecordingSection() {
  const {
    isGloballyPaused,
    meetingActive,
    isConnected,
    framesCaptured,
    pauseAll,
    resumeAll,
    toggleMeeting,
    syncFromBackend,
  } = useRecordingStore();

  useEffect(() => {
    void syncFromBackend();
    const id = setInterval(() => void syncFromBackend(), 5000);
    return () => clearInterval(id);
  }, [syncFromBackend]);

  const screenOn = isConnected && !isGloballyPaused;

  return (
    <>
      <SettingRow
        label="Screen Capture"
        description={
          isConnected
            ? `${framesCaptured.toLocaleString()} snapshots captured`
            : "Recorder offline"
        }
      >
        <Switch
          checked={screenOn}
          disabled={!isConnected}
          onCheckedChange={(on) => void (on ? resumeAll() : pauseAll())}
        />
      </SettingRow>
      <SettingRow label="Meeting Audio" description="Record microphone and meeting playback">
        <Switch
          checked={meetingActive}
          disabled={!isConnected}
          onCheckedChange={() => void toggleMeeting()}
        />
      </SettingRow>
      <SettingRow label="Recorder Status" description="Local capture service connection">
        <StatusBadge ok={isConnected} label={isConnected ? "Connected" : "Offline"} />
      </SettingRow>
    </>
  );
}

function AiSection() {
  const [runtime, setRuntime] = useState<RuntimeStatus>(initialRuntimeStatus());
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [providerConfigured, setProviderConfigured] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void electron?.runtime.getStatus().then(setRuntime);
    return electron?.runtime.onStatusChanged(setRuntime);
  }, []);

  useEffect(() => {
    void api.config().then(setConfig).catch(() => setConfig(null));
    void electron?.runtime.getProviderInfo().then((info) => {
      setProviderConfigured(info.configured);
    });
  }, []);

  const saveProvider = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      await electron?.runtime.configureProvider("gemini", apiKey);
      setApiKey("");
      setProviderConfigured(true);
      await electron?.runtime.retry();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SettingRow label="Runtime" description={runtime.message}>
        <StatusBadge ok={runtime.phase === "ready"} label={PHASE_LABELS[runtime.phase]} />
      </SettingRow>
      <SettingRow label="Memory Graph" description="Local HydraDB graph node">
        <StatusBadge ok={runtime.memoryReady} label={runtime.memoryReady ? "Running" : "Stopped"} />
      </SettingRow>
      <SettingRow label="Recorder" description="Screen and audio capture service">
        <StatusBadge
          ok={runtime.backendReady}
          label={runtime.backendReady ? "Running" : "Stopped"}
        />
      </SettingRow>
      <SettingRow label="Chat Model" description="Used for chat and summaries">
        <span className="text-sm text-muted-foreground">{config?.model ?? "—"}</span>
      </SettingRow>
      <SettingRow label="Speech to Text" description="Meeting transcription engine">
        <span className="text-sm text-muted-foreground">{config?.stt_engine ?? "—"}</span>
      </SettingRow>
      <SettingRow
        label="API Key"
        description={
          providerConfigured
            ? "Gemini key saved — enter a new one to replace it"
            : "Gemini is used for chat, voice, transcription, and summaries"
        }
      >
        <div className="flex w-48 flex-col items-stretch gap-2">
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Gemini API key"
            autoComplete="off"
            className="h-8 text-xs"
          />
          <Button size="sm" disabled={!apiKey.trim() || saving} onClick={() => void saveProvider()}>
            {saving ? "Restarting…" : "Save Key"}
          </Button>
        </div>
      </SettingRow>
    </>
  );
}

function ShortcutsSection() {
  const shortcuts = [
    ["Global Search", "Cmd+K"],
    ["New Chat Window", "Cmd+N"],
  ] as const;

  return (
    <>
      {shortcuts.map(([label, keys]) => (
        <SettingRow key={label} label={label}>
          <Kbd className="h-6 px-2 text-xs">{formatShortcut(keys)}</Kbd>
        </SettingRow>
      ))}
      <p className="pt-3 text-xs text-muted-foreground">
        Shortcuts work while Chronicle is focused.
      </p>
    </>
  );
}

function PrivacySection() {
  const [permissions, setPermissions] = useState<Awaited<
    ReturnType<NonNullable<typeof electron>["permissions"]["get"]>
  > | null>(null);
  const [requesting, setRequesting] = useState<string | null>(null);

  const refresh = () => void electron?.permissions.get().then(setPermissions);

  useEffect(() => {
    refresh();
  }, []);

  const request = async (permission: "screen" | "microphone" | "accessibility") => {
    setRequesting(permission);
    try {
      await electron?.permissions.request(permission);
      refresh();
    } finally {
      setRequesting(null);
    }
  };

  const items = permissions
    ? [
        { id: "screen" as const, label: "Screen Recording", status: permissions.screen },
        { id: "microphone" as const, label: "Microphone", status: permissions.microphone },
        {
          id: "accessibility" as const,
          label: "Accessibility",
          status: permissions.accessibility,
        },
      ]
    : [];

  return (
    <>
      {items.map((item) => {
        const granted = item.status === "granted";
        return (
          <SettingRow
            key={item.id}
            label={item.label}
            description={granted ? "Permission granted" : `Status: ${item.status}`}
          >
            {granted ? (
              <StatusBadge ok label="Granted" />
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={requesting === item.id}
                onClick={() => void request(item.id)}
              >
                {requesting === item.id ? "Requesting…" : "Request"}
              </Button>
            )}
          </SettingRow>
        );
      })}
      {permissions?.platform !== "darwin" && (
        <p className="pt-2 text-xs text-muted-foreground">
          Permission prompts are managed by your OS on {permissions?.platform ?? "this platform"}.
        </p>
      )}
    </>
  );
}

function StorageSection() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [health, setHealth] = useState<Awaited<ReturnType<typeof api.health>> | null>(null);
  const [memory, setMemory] = useState<Awaited<ReturnType<typeof api.memoryStats>> | null>(null);

  useEffect(() => {
    void api.config().then(setConfig).catch(() => setConfig(null));
    void api.health().then(setHealth).catch(() => setHealth(null));
    void api.memoryStats().then(setMemory).catch(() => setMemory(null));
  }, []);

  const openDataFolder = () => {
    if (config?.data_dir) void electron?.openPath(config.data_dir);
  };

  return (
    <>
      <SettingRow label="Snapshots" description="Captured screen snapshots stored locally">
        <span className="text-sm tabular-nums text-muted-foreground">
          {health?.frames_captured?.toLocaleString() ?? "—"}
        </span>
      </SettingRow>
      <SettingRow label="Audio Segments" description="Transcribed meeting segments">
        <span className="text-sm tabular-nums text-muted-foreground">
          {health?.audio_chunks?.toLocaleString() ?? "—"}
        </span>
      </SettingRow>
      <SettingRow label="Memories" description="Items in your local memory graph">
        <span className="text-sm tabular-nums text-muted-foreground">
          {memory?.nodes?.toLocaleString() ?? "—"}
        </span>
      </SettingRow>
      <SettingRow label="Text Extraction" description="Reading text out of screen snapshots">
        <StatusBadge ok={config?.ocr_enabled ?? false} label={config?.ocr_enabled ? "On" : "Off"} />
      </SettingRow>
      <SettingRow label="Data Folder" description={config?.data_dir ?? "Local storage path"}>
        <Button variant="outline" size="sm" disabled={!config?.data_dir} onClick={openDataFolder}>
          Open Folder
        </Button>
      </SettingRow>
    </>
  );
}

export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const rawSection = searchParams.get("section") || "display";
  const section = (SETTINGS_SECTIONS.some((i) => i.id === rawSection)
    ? rawSection
    : "display") as SettingsSection;
  const active = findSettingsSection(section);

  const nav = (
    <>
      {SETTINGS_NAV.map((group) => (
        <div key={group.label} className="mb-3 last:mb-0">
          <div className="px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
            {group.label}
          </div>
          <div className="space-y-0.5">
            {group.items.map((item) => (
              <NavButton
                key={item.id}
                icon={item.icon}
                label={item.label}
                active={section === item.id}
                onClick={() => setSearchParams({ section: item.id })}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  );

  const headerLeading = (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      onClick={() => navigate("/home")}
      aria-label="Back to Chronicle"
    >
      <ChevronLeft className="h-4 w-4" />
    </Button>
  );

  return (
    <AppShell nav={nav} headerLeading={headerLeading}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <PageHeader title={active?.label ?? "Preferences"} description={active?.description} />
        <div className="scrollbar-minimal min-h-0 flex-1 overflow-y-auto p-6">
          <Card padding="lg" className="max-w-2xl">
            {section === "display" && <DisplaySection />}
            {section === "general" && <GeneralSection />}
            {section === "recording" && <RecordingSection />}
            {section === "ai" && <AiSection />}
            {section === "shortcuts" && <ShortcutsSection />}
            {section === "privacy" && <PrivacySection />}
            {section === "storage" && <StorageSection />}
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
