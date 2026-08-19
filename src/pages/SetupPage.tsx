import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { electron } from "@/lib/electron";
import {
  initialRuntimeStatus,
  type ModelProvider,
  type RuntimeStatus,
} from "@/lib/runtime";

const phaseLabel: Record<RuntimeStatus["phase"], string> = {
  checking: "checking",
  installing: "installing hydradb",
  "starting-memory": "starting hydradb",
  "starting-backend": "starting capture engine",
  ready: "ready",
  error: "setup needs attention",
  stopping: "stopping",
};

export function SetupPage() {
  const [status, setStatus] = useState<RuntimeStatus>(initialRuntimeStatus());
  const [retrying, setRetrying] = useState(false);
  const [provider, setProvider] = useState<ModelProvider>("gemini");
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
      await electron?.runtime.configureProvider(provider, apiKey);
      setApiKey("");
      await electron?.runtime.retry();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground flex flex-col p-10 font-mono">
      <div className="flex items-center gap-3">
        <div className="h-7 w-7 border-2 border-foreground grid place-items-center text-xs">S</div>
        <h1 className="text-xl lowercase">Chronicle</h1>
      </div>

      <section className="my-auto space-y-5">
        <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          {phaseLabel[status.phase]}
        </div>
        <h2 className="text-2xl lowercase leading-tight">{status.message}</h2>
        <div
          className="h-2 border border-border overflow-hidden"
          role="progressbar"
          aria-valuenow={status.progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full bg-foreground transition-[width] duration-300"
            style={{ width: `${status.progress}%` }}
          />
        </div>
        {status.error && (
          <div className="border border-border p-4 space-y-2">
            <p className="text-sm">{status.error.message}</p>
            <p className="text-xs text-muted-foreground">error: {status.error.code}</p>
          </div>
        )}
        {status.error?.code === "PROVIDER_KEY_REQUIRED" && (
          <div className="grid grid-cols-[140px_1fr] gap-2">
            <select
              className="border border-border bg-background px-3 text-sm"
              value={provider}
              onChange={(event) => setProvider(event.target.value as ModelProvider)}
              aria-label="Model provider"
            >
              <option value="gemini">Gemini</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
            <input
              className="border border-border bg-background px-3 py-2 text-sm min-w-0"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="provider API key"
              autoComplete="off"
            />
            <p className="col-span-2 text-[10px] text-muted-foreground">
              protected by the OS credential store when available and shared only with local services.
            </p>
          </div>
        )}
      </section>

      {status.phase === "error" ? (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => electron?.runtime.openLogs()}>
            view logs
          </Button>
          <Button
            onClick={status.error?.code === "PROVIDER_KEY_REQUIRED" ? configureAndRetry : retry}
            disabled={
              retrying ||
              !status.error?.retryable ||
              (status.error?.code === "PROVIDER_KEY_REQUIRED" && !apiKey.trim())
            }
          >
            {retrying ? "retrying…" : "retry"}
          </Button>
          <Button variant="ghost" className="col-span-2" onClick={() => electron?.quit()}>
            quit Chronicle
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          first launch may take a few minutes. your data remains on this device.
        </p>
      )}
    </main>
  );
}
