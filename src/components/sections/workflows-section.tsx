import React, { useCallback, useEffect, useState } from "react";
import { Download, Loader2, Play, Workflow } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, type PipeId, type PipeListItem } from "@/lib/api/client";

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

  const handleInstall = async (id: PipeId) => {
    setBusyId(id);
    try {
      await api.installPipe(id);
      await api.enablePipe(id, true);
      await loadWorkflows();
      toast.success(`${id} installed`);
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
        toast.error(result.error ?? "Workflow run failed");
        setLastOutput((prev) => ({
          ...prev,
          [workflow.id]: result.error ?? "Workflow run failed",
        }));
      } else {
        const output = result.output ?? "Workflow completed";
        setLastOutput((prev) => ({ ...prev, [workflow.id]: output }));
        toast.success(`${workflow.name} completed`);
      }
      await loadWorkflows();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Workflow run failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto scrollbar-minimal">
      <div className="page-header">
        <h1 className="page-header-title">Workflows</h1>
        <p className="page-header-desc">Automation workflows for your captured context</p>
      </div>
      <div className="p-6 grid gap-4 md:grid-cols-2">
        {loading && workflows.length === 0 ? (
          <div className="col-span-full flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading workflows…
          </div>
        ) : null}
        {!loading && workflows.length === 0 ? (
          <div className="col-span-full text-sm text-muted-foreground">
            No workflows available. Make sure the backend is running.
          </div>
        ) : null}
        {workflows.map((workflow) => {
          const busy = busyId === workflow.id || workflow.running;
          const lastRun = formatLastRun(workflow.last_run_at);
          const output = lastOutput[workflow.id];

          return (
            <div key={workflow.id} className="surface-card flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <Workflow className="w-5 h-5 shrink-0" />
                <div className="flex flex-col items-end gap-1">
                  {workflow.installed ? (
                    <span className="text-[10px] font-medium rounded-full border border-border px-2 py-0.5 text-muted-foreground">
                      Installed
                    </span>
                  ) : null}
                  <span className="text-[10px] text-muted-foreground">{workflow.schedule}</span>
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
                    onClick={() => void handleInstall(workflow.id)}
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
