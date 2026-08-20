import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { electron } from "@/lib/electron";
import {
  PHASE_LABELS,
  initialRuntimeStatus,
  type RuntimeStatus,
} from "@/lib/runtime";

export function SetupPage() {
  const [status, setStatus] = useState<RuntimeStatus>(initialRuntimeStatus());
  const [retrying, setRetrying] = useState(false);
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    void electron?.runtime.getStatus().then(setStatus);
    return electron?.runtime.onStatusChanged(setStatus);
  }, []);

  const retry = async () => {
    setRetrying(true);
    try {
      await electron?.runtime.retry();
    } finally {
      setRetrying(false);
    }
  };

  const configureAndRetry = async () => {
    if (!apiKey.trim()) return;
    setRetrying(true);
    try {
      await electron?.runtime.configureProvider("gemini", apiKey);
      setApiKey("");
      await electron?.runtime.retry();
    } finally {
      setRetrying(false);
    }
  };

  const needsKey = status.error?.code === "PROVIDER_KEY_REQUIRED";

  return (
    <main className="drag-region flex min-h-screen flex-col bg-background p-8 text-foreground">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold tracking-tight">Chronicle</span>
      </div>

      <section className="no-drag my-auto flex flex-col gap-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {PHASE_LABELS[status.phase]}
          </p>
          <h1 className="mt-2 font-heading text-2xl font-semibold leading-tight tracking-tight">
            {status.message}
          </h1>
        </div>

        <div
          className="h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={status.progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-slow"
            style={{ width: `${status.progress}%` }}
          />
        </div>

        {status.error && (
          <Card variant="muted" className="flex flex-col gap-1">
            <p className="text-sm text-foreground">{status.error.message}</p>
            <p className="text-xs text-muted-foreground">Error code: {status.error.code}</p>
          </Card>
        )}

        {needsKey && (
          <div className="flex flex-col gap-2">
            <Input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Gemini API key"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Protected by the OS credential store when available, and shared only with local
              services.
            </p>
          </div>
        )}
      </section>

      {status.phase === "error" ? (
        <div className="no-drag grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => electron?.runtime.openLogs()}>
            View Logs
          </Button>
          <Button
            onClick={needsKey ? configureAndRetry : retry}
            disabled={
              retrying || !status.error?.retryable || (needsKey && !apiKey.trim())
            }
          >
            {retrying ? "Retrying…" : "Retry"}
          </Button>
          <Button variant="ghost" className="col-span-2" onClick={() => electron?.quit()}>
            Quit Chronicle
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          First launch may take a few minutes. Your data remains on this device.
        </p>
      )}
    </main>
  );
}
