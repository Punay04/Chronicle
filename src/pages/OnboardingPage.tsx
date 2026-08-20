import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useOnboardingStore,
  ONBOARDING_SIZES,
  type OnboardingStep,
} from "@/lib/stores/onboarding-store";
import { electron, type PermissionStatus } from "@/lib/electron";
import { api, type ConnectorInfo, type PipeListItem } from "@/lib/api/client";

const STEPS: OnboardingStep[] = ["login", "permissions", "engine", "connect-apps", "pipe"];

function OnboardingShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col min-h-screen p-8 gap-6 max-w-md mx-auto">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {description && (
          <p className="text-sm text-muted-foreground mt-1.5">{description}</p>
        )}
      </div>
      <div className="flex-1 flex flex-col gap-4">{children}</div>
      {footer}
    </div>
  );
}

function WelcomeSlide({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8 gap-6">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight mb-2">Chronicle</h1>
        <p className="text-sm text-muted-foreground max-w-xs">
          A local-first AI workspace that remembers your work
        </p>
      </div>
      <Button onClick={onNext} className="w-full max-w-xs">
        Get Started
      </Button>
      <p className="max-w-xs text-center text-xs text-muted-foreground">
        No account required. Your captured data stays on this device.
      </p>
    </div>
  );
}

function PermissionsSlide({ onNext }: { onNext: () => void }) {
  type PermissionId = "screen" | "microphone" | "accessibility";

  const permissions: Array<{ id: PermissionId; name: string }> = [
    { id: "screen", name: "Screen recording" },
    { id: "microphone", name: "Microphone" },
    { id: "accessibility", name: "Accessibility" },
  ];
  const [status, setStatus] = useState<PermissionStatus | null>(null);
  const [requesting, setRequesting] = useState<PermissionId | null>(null);
  const [restartRequired, setRestartRequired] = useState(false);

  const refresh = async () => {
    const next = await electron?.permissions.get();
    if (next) setStatus(next);
  };

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 2_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const request = async (id: PermissionId) => {
    setRequesting(id);
    try {
      const permissionGranted = await electron?.permissions.request(id);
      if (id === "screen" || (id === "microphone" && !permissionGranted)) {
        setRestartRequired(true);
      }
      await refresh();
    } finally {
      setRequesting(null);
    }
  };

  const granted = (id: PermissionId) =>
    status?.[id] === "granted";
  const allGranted = permissions.every((permission) => granted(permission.id));

  return (
    <OnboardingShell
      title="Permissions"
      description="Chronicle needs these permissions to capture your screen and audio."
      footer={
        restartRequired ? (
          <div className="mt-auto flex flex-col gap-2">
            <p className="text-xs text-muted-foreground text-center">
              After enabling the permission in System Settings, restart Chronicle
              so macOS can apply it.
            </p>
            <Button onClick={() => void electron?.restart()}>
              Restart Chronicle
            </Button>
          </div>
        ) : (
          <Button onClick={onNext} disabled={!allGranted} className="mt-auto">
            Continue
          </Button>
        )
      }
    >
      <div className="flex flex-col rounded-lg border border-border overflow-hidden">
        {permissions.map((permission) => (
          <div
            key={permission.id}
            className="flex items-center justify-between px-4 py-3 border-b border-border last:border-b-0"
          >
            <span className="text-sm font-medium">{permission.name}</span>
            <Button
              variant={granted(permission.id) ? "outline" : "default"}
              size="sm"
              disabled={granted(permission.id) || requesting === permission.id}
              onClick={() => request(permission.id)}
            >
              {granted(permission.id)
                ? "Granted"
                : status?.[permission.id] === "not-determined"
                  ? "Grant"
                  : "Open Settings"}
            </Button>
          </div>
        ))}
      </div>
    </OnboardingShell>
  );
}

function EngineSlide({ onNext }: { onNext: () => void }) {
  const [status, setStatus] = useState<"starting" | "ready" | "idle" | "error">("idle");

  const start = async () => {
    setStatus("starting");
    try {
      await electron?.engine.start();
      const health = (await electron?.engine.health()) as { status?: string };
      setStatus(health?.status === "healthy" ? "ready" : "error");
    } catch {
      setStatus("error");
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        const health = (await electron?.engine.health()) as { status?: string };
        if (health?.status === "healthy") setStatus("ready");
      } catch {
        // engine not running yet
      }
    })();
  }, []);

  const statusLabel = {
    starting: "Starting…",
    ready: "Recorder ready",
    error: "Recorder error",
    idle: "Not started",
  }[status];

  return (
    <OnboardingShell
      title="Start Recorder"
      description="The capture engine runs locally on your machine."
      footer={
        <Button onClick={onNext} disabled={status !== "ready"} className="mt-auto">
          Continue
        </Button>
      }
    >
      <div className="rounded-lg border border-border p-6 flex flex-col items-center gap-4 bg-surface">
        <div
          className={cn(
            "w-3 h-3 rounded-full",
            status === "ready" && "bg-foreground",
            status === "starting" && "bg-muted-foreground animate-pulse",
            status === "error" && "bg-destructive",
            status === "idle" && "bg-muted"
          )}
        />
        <span className="text-sm text-muted-foreground">{statusLabel}</span>
        {status === "idle" && <Button onClick={start}>Start engine</Button>}
      </div>
    </OnboardingShell>
  );
}

function ConnectAppsSlide({ onNext }: { onNext: () => void }) {
  const [connectors, setConnectors] = useState<ConnectorInfo[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const pollers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  const load = async () => {
    try {
      const res = await api.listConnectors();
      setConfigured(res.configured);
      setConnectors(res.data);
    } catch {
      setConfigured(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timers = pollers.current;
    return () => {
      timers.forEach((t) => clearInterval(t));
      timers.clear();
    };
  }, []);

  const setBusyFor = (toolkit: string, on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(toolkit);
      else next.delete(toolkit);
      return next;
    });

  const handleConnect = async (conn: ConnectorInfo) => {
    if (!conn.configured) return;
    setBusyFor(conn.toolkit, true);
    try {
      const { redirectUrl, connectedAccountId } = await api.connectConnector(conn.toolkit);
      if (redirectUrl) {
        if (electron?.openExternal) await electron.openExternal(redirectUrl);
        else window.open(redirectUrl, "_blank");
      }
      let attempts = 0;
      const timer = setInterval(async () => {
        attempts += 1;
        try {
          const { connected } = await api.connectorStatus(conn.toolkit, connectedAccountId);
          if (connected) {
            clearInterval(timer);
            pollers.current.delete(conn.toolkit);
            setBusyFor(conn.toolkit, false);
            void load();
            return;
          }
        } catch {
          // ignore transient errors during OAuth
        }
        if (attempts >= 40) {
          clearInterval(timer);
          pollers.current.delete(conn.toolkit);
          setBusyFor(conn.toolkit, false);
        }
      }, 2500);
      pollers.current.set(conn.toolkit, timer);
    } catch {
      setBusyFor(conn.toolkit, false);
    }
  };

  return (
    <OnboardingShell
      title="Connect apps"
      description="Optional integrations to enrich your context."
      footer={
        <Button onClick={onNext} className="mt-auto">
          Continue
        </Button>
      }
    >
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!loading && !configured && (
        <p className="text-sm text-muted-foreground rounded-lg border border-border p-4">
          Connectors aren&apos;t configured yet. You can set them up later from the
          Connections panel.
        </p>
      )}

      {!loading && configured && (
        <div className="flex flex-col rounded-lg border border-border overflow-hidden">
          {connectors.map((conn) => {
            const isBusy = busy.has(conn.toolkit);
            return (
              <div
                key={conn.toolkit}
                className="flex items-center justify-between px-4 py-3 border-b border-border last:border-b-0"
              >
                <span className="text-sm font-medium">
                  {conn.name}
                  {!conn.configured && (
                    <span className="text-xs text-muted-foreground ml-2 font-normal">
                      (no auth config)
                    </span>
                  )}
                </span>
                <Button
                  variant={conn.connected ? "outline" : "default"}
                  size="sm"
                  disabled={isBusy || !conn.configured || conn.connected}
                  onClick={() => handleConnect(conn)}
                >
                  {isBusy ? "Connecting…" : conn.connected ? "Connected" : "Connect"}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </OnboardingShell>
  );
}

function PickWorkflowSlide({ onComplete }: { onComplete: () => void }) {
  // Sourced from the backend catalog rather than hardcoded, so this list cannot
  // drift from the routines the app actually ships.
  const [routines, setRoutines] = useState<PipeListItem[]>([]);

  useEffect(() => {
    void api
      .pipes()
      .then((res) => setRoutines(res.data))
      .catch(() => setRoutines([]));
  }, []);

  return (
    <OnboardingShell
      title="Pick a routine"
      description="Choose your first automation."
      footer={
        <button
          onClick={onComplete}
          className="mt-auto text-center text-sm text-muted-foreground hover:text-foreground"
        >
          Skip for Now
        </button>
      }
    >
      <div className="flex flex-col gap-2">
        {routines.map((routine) => (
          <button
            key={routine.id}
            onClick={onComplete}
            className="rounded-lg border border-border px-4 py-3 text-left transition-colors duration-fast hover:bg-accent"
          >
            <span className="block text-sm font-medium">{routine.name}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {routine.description}
            </span>
          </button>
        ))}
      </div>
    </OnboardingShell>
  );
}

export function OnboardingPage() {
  const { currentStep, isCompleted, setStep, complete, setCompleted } = useOnboardingStore();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    void electron?.onboarding.getComplete().then(setCompleted);
  }, [setCompleted]);

  useEffect(() => {
    const size = ONBOARDING_SIZES[currentStep];
    electron?.setWindowSize(size.width, size.height);
  }, [currentStep]);

  useEffect(() => {
    if (isCompleted) {
      electron?.openWindow("home");
      electron?.closeWindow();
    }
  }, [isCompleted]);

  const handleNext = () => {
    const idx = STEPS.indexOf(currentStep);
    if (idx < STEPS.length - 1) {
      setVisible(false);
      setTimeout(() => {
        setStep(STEPS[idx + 1]);
        setVisible(true);
      }, 300);
    }
  };

  const handleComplete = () => {
    complete();
    void electron?.onboarding.complete();
  };

  return (
    <div
      className={cn(
        "bg-background transition-opacity duration-slow",
        visible ? "opacity-100" : "opacity-0"
      )}
    >
      {currentStep === "login" && <WelcomeSlide onNext={handleNext} />}
      {currentStep === "permissions" && <PermissionsSlide onNext={handleNext} />}
      {currentStep === "engine" && <EngineSlide onNext={handleNext} />}
      {currentStep === "connect-apps" && <ConnectAppsSlide onNext={handleNext} />}
      {currentStep === "pipe" && <PickWorkflowSlide onComplete={handleComplete} />}
    </div>
  );
}
