import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Plug, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { api, type ConnectorInfo } from "@/lib/api/client";
import { findMainSection } from "@/lib/nav";
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
      setError(err instanceof Error ? err.message : "Could not load your integrations");
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

  const pollUntilActive = (toolkit: string, label: string, connectedAccountId: string) => {
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
          toast.success(`${label} connected`);
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
        toast.error(`${label} connection timed out — try again`);
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
        toast.info(`Authorize ${conn.name} in your browser…`);
      }
      pollUntilActive(conn.toolkit, conn.name, connectedAccountId);
    } catch (err) {
      setBusyFor(conn.toolkit, false);
      toast.error(err instanceof Error ? err.message : "Could not connect");
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
      toast.error(err instanceof Error ? err.message : "Could not disconnect");
    } finally {
      setBusyFor(conn.toolkit, false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <PageHeader
        title="Integrations"
        description={findMainSection("connections")?.description}
        actions={
          <Button variant="outline" size="sm" className="gap-2" onClick={() => void load()}>
            <RefreshCw className="h-3 w-3" /> Refresh
          </Button>
        }
      />

      <div className="scrollbar-minimal grid min-h-0 max-w-xl flex-1 content-start gap-3 overflow-y-auto p-6">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}

        {!loading && !configured && (
          <Card variant="muted" className="text-sm text-muted-foreground">
            Composio is not configured. Add{" "}
            <span className="text-foreground">COMPOSIO_API_KEY</span> and the{" "}
            <span className="text-foreground">COMPOSIO_AUTH_CONFIG_*</span> ids to your{" "}
            <span className="text-foreground">.env</span>, then restart.
          </Card>
        )}

        {!loading && error && (
          <Card variant="muted" className="text-sm text-destructive">
            {error}
          </Card>
        )}

        {!loading &&
          configured &&
          connectors.map((conn) => {
            const isBusy = busy.has(conn.toolkit);
            return (
              <Card key={conn.toolkit} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Plug className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{conn.name}</span>
                  {!conn.configured && (
                    <span className="text-xs text-muted-foreground">No auth config</span>
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
                      <Loader2 className="h-3 w-3 animate-spin" />{" "}
                      {conn.connected ? "…" : "Connecting"}
                    </>
                  ) : conn.connected ? (
                    <>
                      <Check className="h-3 w-3" /> Connected
                    </>
                  ) : (
                    "Connect"
                  )}
                </Button>
              </Card>
            );
          })}
      </div>
    </div>
  );
}
