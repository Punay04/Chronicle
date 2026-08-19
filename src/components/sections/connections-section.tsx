import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Plug, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, type ConnectorInfo } from "@/lib/api/client";
import { electron } from "@/lib/electron";

const STATUS_POLL_MS = 2500;
const STATUS_POLL_MAX = 40; // ~100s of polling before giving up

export function ConnectionsSection() {
  const [connectors, setConnectors] = useState<ConnectorInfo[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const pollers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  const load = useCallback(async () => {
    try {
      const res = await api.listConnectors();
      setConfigured(res.configured);
      setConnectors(res.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load connectors");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timers = pollers.current;
    return () => {
      timers.forEach((t) => clearInterval(t));
      timers.clear();
    };
  }, [load]);

  const setBusyFor = (toolkit: string, on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(toolkit);
      else next.delete(toolkit);
      return next;
    });

  const pollUntilActive = (toolkit: string, connectedAccountId: string) => {
    let attempts = 0;
    const existing = pollers.current.get(toolkit);
    if (existing) clearInterval(existing);

    const timer = setInterval(async () => {
      attempts += 1;
      try {
        const { connected } = await api.connectorStatus(toolkit, connectedAccountId);
        if (connected) {
          clearInterval(timer);
          pollers.current.delete(toolkit);
          setBusyFor(toolkit, false);
          toast.success(`${toolkit} connected`);
          void load();
          return;
        }
      } catch {
        // ignore transient errors while the user completes OAuth
      }
      if (attempts >= STATUS_POLL_MAX) {
        clearInterval(timer);
        pollers.current.delete(toolkit);
        setBusyFor(toolkit, false);
        toast.error(`${toolkit} connection timed out — try again`);
      }
    }, STATUS_POLL_MS);

    pollers.current.set(toolkit, timer);
  };

  const handleConnect = async (conn: ConnectorInfo) => {
    if (!conn.configured) {
      toast.error(`${conn.name} has no auth config — set it in .env`);
      return;
    }
    setBusyFor(conn.toolkit, true);
    try {
      const { redirectUrl, connectedAccountId } = await api.connectConnector(
        conn.toolkit
      );
      if (redirectUrl) {
        if (electron?.openExternal) await electron.openExternal(redirectUrl);
        else window.open(redirectUrl, "_blank");
        toast.info(`authorize ${conn.name} in your browser…`);
      }
      pollUntilActive(conn.toolkit, connectedAccountId);
    } catch (err) {
      setBusyFor(conn.toolkit, false);
      toast.error(err instanceof Error ? err.message : "failed to connect");
    }
  };

  const handleDisconnect = async (conn: ConnectorInfo) => {
    if (!conn.connectedAccountId) return;
    setBusyFor(conn.toolkit, true);
    try {
      await api.disconnectConnector(conn.toolkit, conn.connectedAccountId);
      toast.success(`${conn.name} disconnected`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "failed to disconnect");
    } finally {
      setBusyFor(conn.toolkit, false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto scrollbar-minimal">
      <div className="page-header flex items-center justify-between">
        <div>
          <h1 className="page-header-title">Connections</h1>
          <p className="page-header-desc">Third-party integrations via Composio</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => void load()}
        >
          <RefreshCw className="w-3 h-3" /> refresh
        </Button>
      </div>

      <div className="p-6 grid gap-3 max-w-xl">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        )}

        {!loading && !configured && (
          <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
            composio is not configured. add{" "}
            <span className="text-foreground">COMPOSIO_API_KEY</span> and the{" "}
            <span className="text-foreground">COMPOSIO_AUTH_CONFIG_*</span> ids to
            your <span className="text-foreground">.env</span>, then restart.
          </div>
        )}

        {!loading && error && (
          <div className="rounded-lg border border-border p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {!loading &&
          configured &&
          connectors.map((conn) => {
            const isBusy = busy.has(conn.toolkit);
            return (
              <div
                key={conn.toolkit}
                className="surface-card flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <Plug className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{conn.name}</span>
                  {!conn.configured && (
                    <span className="text-xs text-muted-foreground">
                      (no auth config)
                    </span>
                  )}
                </div>
                <Button
                  variant={conn.connected ? "outline" : "default"}
                  size="sm"
                  className="gap-2"
                  disabled={isBusy || !conn.configured}
                  onClick={() =>
                    conn.connected
                      ? handleDisconnect(conn)
                      : handleConnect(conn)
                  }
                >
                  {isBusy ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />{" "}
                      {conn.connected ? "…" : "connecting"}
                    </>
                  ) : conn.connected ? (
                    <>
                      <Check className="w-3 h-3" /> connected
                    </>
                  ) : (
                    "connect"
                  )}
                </Button>
              </div>
            );
          })}
      </div>
    </div>
  );
}
