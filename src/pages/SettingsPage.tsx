import React, { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  Brain,
  ChevronLeft,
  HardDrive,
  Keyboard,
  Layout,
  Settings as SettingsIcon,
  Shield,
  Video,
} from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { cn, formatShortcut } from "@/lib/utils";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { useRecordingStore } from "@/lib/stores/recording-store";
import { api, type AppConfig } from "@/lib/api/client";
import { electron } from "@/lib/electron";
import { initialRuntimeStatus, type ModelProvider, type RuntimeStatus } from "@/lib/runtime";

type SettingsSection =
  | "display"
  | "general"
  | "recording"
  | "ai"
  | "shortcuts"
  | "privacy"
  | "storage";

const NAV_GROUPS: {
  label: string;
  items: { id: SettingsSection; label: string; icon: React.ElementType }[];
}[] = [
  {
    label: "App",
    items: [
      { id: "display", label: "Display", icon: Layout },
      { id: "general", label: "General", icon: SettingsIcon },
      { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
    ],
  },
  {
    label: "Capture",
    items: [
      { id: "recording", label: "Recording", icon: Video },
      { id: "privacy", label: "Privacy", icon: Shield },
    ],
  },
  {
    label: "Data & AI",
    items: [
      { id: "ai", label: "AI", icon: Brain },
      { id: "storage", label: "Storage", icon: HardDrive },
    ],
  },
];

const SECTION_TITLES: Record<SettingsSection, string> = {
  display: "Display",
  general: "General",
  recording: "Recording",
  ai: "AI",
  shortcuts: "Shortcuts",
  privacy: "Privacy",
  storage: "Storage",
};

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-4 border-b border-border last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {description && (
          <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "w-10 h-5 rounded-full relative transition-colors duration-150",
        checked ? "bg-primary" : "bg-muted",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 w-4 h-4 rounded-full bg-background shadow-sm transition-all duration-150",
          checked ? "right-0.5" : "left-0.5"
        )}
      />
    </button>
  );
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        ok ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
      )}
    >
      {label}
    </span>
  );
}

function DisplaySection() {
  const { settings, setSetting } = useSettingsStore();

  return (
    <>
      <SettingRow label="Appearance" description="Olive dark and light surfaces">
        <Toggle
          checked={settings.theme === "dark"}
          onChange={(v) => setSetting("theme", v ? "dark" : "light")}
        />
      </SettingRow>
      <SettingRow label="Translucent sidebar" description="Frosted sidebar overlay">
        <Toggle
          checked={settings.translucentSidebar}
          onChange={(v) => setSetting("translucentSidebar", v)}
        />
      </SettingRow>
      <SettingRow label="Hide timeline" description="Remove timeline from the sidebar">
        <Toggle
          checked={settings.disableTimeline}
          onChange={(v) => setSetting("disableTimeline", v)}
        />
      </SettingRow>
      <SettingRow label="Font size" description={`${settings.fontSize}px base`}>
        <input
          type="range"
          min={14}
          max={20}
          value={settings.fontSize}
          onChange={(e) => setSetting("fontSize", Number(e.target.value))}
          className="w-32 accent-primary"
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
      <SettingRow label="Launch at login" description="Open Chronicle when you sign in">
        <Toggle checked={settings.launchAtStartup} onChange={toggleLaunchAtStartup} />
      </SettingRow>
      <SettingRow label="Version" description="Installed app version">
        <span className="text-sm text-muted-foreground tabular-nums">{version}</span>
      </SettingRow>
      <SettingRow label="Runtime logs" description="Open the local runtime log folder">
        <Button variant="outline" size="sm" onClick={() => void electron?.runtime.openLogs()}>
          Open logs
        </Button>
      </SettingRow>
      <SettingRow label="Updates" description="Download the latest release">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void electron?.openExternal("https://github.com/hydra-db/hydradb")
          }
        >
          Check releases
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
        label="Screen capture"
        description={isConnected ? `${framesCaptured.toLocaleString()} frames captured` : "Backend offline"}
      >
        <Toggle
          checked={screenOn}
          disabled={!isConnected}
          onChange={(on) => void (on ? resumeAll() : pauseAll())}
        />
      </SettingRow>
      <SettingRow label="Meeting audio" description="Record microphone and meeting playback">
        <Toggle
          checked={meetingActive}
          disabled={!isConnected}
          onChange={() => void toggleMeeting()}
        />
      </SettingRow>
      <SettingRow label="Engine status" description="Local capture backend connection">
        <StatusBadge ok={isConnected} label={isConnected ? "Connected" : "Offline"} />
      </SettingRow>
    </>
  );
}

function AiSection() {
  const [runtime, setRuntime] = useState<RuntimeStatus>(initialRuntimeStatus());
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [provider, setProvider] = useState<ModelProvider>("gemini");
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
      if (info.provider) setProvider(info.provider);
      setProviderConfigured(info.configured);
    });
  }, []);

  const saveProvider = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      await electron?.runtime.configureProvider(provider, apiKey);
      setApiKey("");
      setProviderConfigured(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SettingRow label="Runtime" description={runtime.message}>
        <StatusBadge
          ok={runtime.phase === "ready"}
          label={runtime.phase === "ready" ? "Ready" : runtime.phase}
        />
      </SettingRow>
      <SettingRow label="Memory graph" description="Local HydraDB graph node">
        <StatusBadge ok={runtime.memoryReady} label={runtime.memoryReady ? "Running" : "Stopped"} />
      </SettingRow>
      <SettingRow label="Capture backend" description="Screen and audio engine">
        <StatusBadge ok={runtime.backendReady} label={runtime.backendReady ? "Running" : "Stopped"} />
      </SettingRow>
      <SettingRow label="Chat model" description="Used for chat and summaries">
        <span className="text-sm text-muted-foreground">{config?.model ?? "—"}</span>
      </SettingRow>
      <SettingRow label="Speech-to-text" description="Meeting transcription engine">
        <span className="text-sm text-muted-foreground">{config?.stt_engine ?? "—"}</span>
      </SettingRow>
      <SettingRow
        label="API key"
        description={
          providerConfigured
            ? `${provider} key saved — enter a new one to replace it`
            : "Required for AI chat and meeting summaries"
        }
      >
        <div className="flex flex-col items-end gap-2">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as ModelProvider)}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
          >
            <option value="gemini">Gemini</option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </select>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Paste API key"
            className="h-8 w-44 rounded-md border border-border bg-background px-2 text-xs"
          />
          <Button size="sm" disabled={!apiKey.trim() || saving} onClick={() => void saveProvider()}>
            {saving ? "Saving…" : "Save key"}
          </Button>
        </div>
      </SettingRow>
    </>
  );
}

function ShortcutsSection() {
  const shortcuts = [
    ["Global search", "Cmd+K"],
    ["New chat window", "Cmd+N"],
  ] as const;

  return (
    <div className="space-y-1">
      {shortcuts.map(([label, keys]) => (
        <div
          key={label}
          className="flex justify-between items-center py-2.5 border-b border-border last:border-b-0"
        >
          <span className="text-sm">{label}</span>
          <kbd className="inline-flex h-6 items-center rounded border border-border bg-muted px-2 text-xs font-medium text-muted-foreground">
            {formatShortcut(keys)}
          </kbd>
        </div>
      ))}
      <p className="text-xs text-muted-foreground pt-3">
        Shortcuts work while Chronicle is focused.
      </p>
    </div>
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
        { id: "screen" as const, label: "Screen recording", status: permissions.screen },
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
        <p className="text-xs text-muted-foreground pt-2">
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
      <SettingRow label="Frames" description="Captured screen frames stored locally">
        <span className="text-sm text-muted-foreground tabular-nums">
          {health?.frames_captured?.toLocaleString() ?? "—"}
        </span>
      </SettingRow>
      <SettingRow label="Audio chunks" description="Transcribed meeting segments">
        <span className="text-sm text-muted-foreground tabular-nums">
          {health?.audio_chunks?.toLocaleString() ?? "—"}
        </span>
      </SettingRow>
      <SettingRow label="Memory nodes" description="Items in your local memory graph">
        <span className="text-sm text-muted-foreground tabular-nums">
          {memory?.nodes?.toLocaleString() ?? "—"}
        </span>
      </SettingRow>
      <SettingRow label="OCR" description="Text extraction from screen frames">
        <StatusBadge ok={config?.ocr_enabled ?? false} label={config?.ocr_enabled ? "On" : "Off"} />
      </SettingRow>
      <SettingRow label="Data folder" description={config?.data_dir ?? "Local storage path"}>
        <Button variant="outline" size="sm" disabled={!config?.data_dir} onClick={openDataFolder}>
          Open folder
        </Button>
      </SettingRow>
    </>
  );
}

function SectionContent({ section }: { section: SettingsSection }) {
  return (
    <div className="max-w-2xl">
      <h2 className="text-lg font-semibold mb-6">{SECTION_TITLES[section]}</h2>
      <div className="rounded-lg border border-border p-6 bg-card">
        {section === "display" && <DisplaySection />}
        {section === "general" && <GeneralSection />}
        {section === "recording" && <RecordingSection />}
        {section === "ai" && <AiSection />}
        {section === "shortcuts" && <ShortcutsSection />}
        {section === "privacy" && <PrivacySection />}
        {section === "storage" && <StorageSection />}
      </div>
    </div>
  );
}

export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const rawSection = searchParams.get("section") || "display";
  const validSections = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id));
  const section = (validSections.includes(rawSection as SettingsSection)
    ? rawSection
    : "display") as SettingsSection;

  return (
    <div className="flex h-screen min-h-0 flex-1">
      <AppSidebar>
        <div className="flex flex-col h-full">
          <button onClick={() => navigate("/home")} className="nav-item w-full mb-2">
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>
          <div className="flex-1 overflow-y-auto scrollbar-hide space-y-4">
            {NAV_GROUPS.map((group) => (
              <div key={group.label}>
                <div className="px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        onClick={() => setSearchParams({ section: item.id })}
                        className={cn(
                          "nav-item w-full",
                          section === item.id && "nav-item-active"
                        )}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </AppSidebar>
      <div className="flex-1 overflow-y-auto scrollbar-minimal p-8">
        <SectionContent section={section} />
      </div>
    </div>
  );
}
