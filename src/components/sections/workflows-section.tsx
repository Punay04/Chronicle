import React, { useCallback, useEffect, useState } from "react";
import { Download, Loader2, Play, Workflow } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { api, type PipeId, type PipeListItem } from "@/lib/api/client";
import { findMainSection } from "@/lib/nav";

function formatLastRun(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function WorkflowsSection() {
  const [workflows, setWorkflows] = useState<PipeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<PipeId | null>(null);
  const [lastOutput, setLastOutput] = useState<Record<string, string>>({});

  const loadWorkflows = useCallback(async () => {
    try {
      const res = await api.pipes();
      setWorkflows(res.data);
    } catch (err) {
      console.error("[workflows] failed to load:", err);
      setWorkflows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWorkflows();
    const timer = setInterval(() => {
      void loadWorkflows();
    }, 5000);
    return () => clearInterval(timer);
  }, [loadWorkflows]);

  const handleInstall = async (workflow: PipeListItem) => {
    const id = workflow.id;
    setBusyId(id);
    try {
      await api.installPipe(id);
      await api.enablePipe(id, true);
      await loadWorkflows();
      toast.success(`${workflow.name} installed`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Install failed");
    } finally {
      setBusyId(null);
    }
  };

  const handleRun = async (workflow: PipeListItem) => {
    setBusyId(workflow.id);
    try {
      const result = await api.runPipe(workflow.id);
      if (result.status === "error") {
        toast.error(result.error ?? "Routine run failed");
        setLastOutput((prev) => ({
          ...prev,
          [workflow.id]: result.error ?? "Routine run failed",
        }));
      } else {
        const output = result.output ?? "Routine completed";
        setLastOutput((prev) => ({ ...prev, [workflow.id]: output }));
        toast.success(`${workflow.name} completed`);
      }
      await loadWorkflows();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Routine run failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <PageHeader title="Routines" description={findMainSection("workflows")?.description} />
      <div className="scrollbar-minimal grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-6 md:grid-cols-2">
        {loading && workflows.length === 0 ? (
          <div className="col-span-full flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading routines…
          </div>
        ) : null}
        {!loading && workflows.length === 0 ? (
          <EmptyState
            className="col-span-full"
            icon={Workflow}
            title="No routines available"
            description="Chronicle could not reach the recorder. Check that it is running in Preferences."
          />
        ) : null}
        {workflows.map((workflow) => {
          const busy = busyId === workflow.id || workflow.running;
          const lastRun = formatLastRun(workflow.last_run_at);
          const output = lastOutput[workflow.id];

          return (
            <Card key={workflow.id} interactive className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <Workflow className="h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="flex flex-col items-end gap-1">
                  {workflow.installed ? <Badge variant="outline">Installed</Badge> : null}
                  <span className="text-xs text-muted-foreground">{workflow.schedule}</span>
                </div>
              </div>
              <div>
                <h3 className="font-medium text-foreground">{workflow.name}</h3>
                <p className="text-sm text-muted-foreground mt-1">{workflow.description}</p>
                {lastRun ? (
                  <p className="text-xs text-muted-foreground mt-2">
                    Last run: {lastRun}
                    {workflow.last_run_status ? ` (${workflow.last_run_status})` : ""}
                  </p>
                ) : null}
              </div>
              {output ? (
                <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap rounded-md border border-border bg-surface p-3 max-h-40 overflow-y-auto scrollbar-minimal">
                  {output}
                </pre>
              ) : null}
              <div className="flex items-center gap-2">
                {workflow.installed ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-fit gap-2"
                    disabled={busy}
                    onClick={() => void handleRun(workflow)}
                  >
                    {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                    Run
                  </Button>
                ) : (
                  <Button
                    variant="default"
                    size="sm"
                    className="w-fit gap-2"
                    disabled={busy}
                    onClick={() => void handleInstall(workflow)}
                  >
                    {busy ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Download className="w-3 h-3" />
                    )}
                    Install
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
