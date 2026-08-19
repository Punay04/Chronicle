import {
  createPipeRun,
  finishPipeRun,
  initPipeState,
  listEnabledPipes,
  listPipeRuns,
  listPipes,
  setPipeEnabled,
  setPipeInstalled,
  updatePipeLastRun,
} from "./db.js";
import { getPipeDefinition, type PipeId } from "./definitions.js";
import { executePipe } from "./runners.js";

export {
  initPipeState,
  listPipeRuns,
  listPipes,
  setPipeEnabled,
  setPipeInstalled,
};

const runningPipes = new Set<string>();

export function getRunningPipes(): Set<string> {
  return runningPipes;
}

export async function runPipe(pipeId: string): Promise<{
  run_id: number;
  status: "ok" | "error";
  output?: string;
  error?: string;
}> {
  const definition = getPipeDefinition(pipeId);
  if (!definition) {
    throw new Error(`unknown pipe: ${pipeId}`);
  }
  if (runningPipes.has(pipeId)) {
    throw new Error(`pipe "${pipeId}" is already running`);
  }

  const startedAt = new Date().toISOString();
  const runId = createPipeRun(pipeId, startedAt);
  runningPipes.add(pipeId);

  try {
    const output = await executePipe(pipeId as PipeId);
    finishPipeRun(runId, { status: "ok", output });
    updatePipeLastRun(pipeId, "ok", startedAt);
    return { run_id: runId, status: "ok", output };
  } catch (err) {
    const message = err instanceof Error ? err.message : "pipe run failed";
    finishPipeRun(runId, { status: "error", error: message });
    updatePipeLastRun(pipeId, "error", startedAt);
    return { run_id: runId, status: "error", error: message };
  } finally {
    runningPipes.delete(pipeId);
  }
}

function hoursSince(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  return (Date.now() - new Date(iso).getTime()) / 3600_000;
}

function shouldRunScheduled(pipeId: PipeId, lastRunAt: string | null): boolean {
  const now = new Date();
  switch (pipeId) {
    case "daily-summary": {
      if (now.getHours() < 18) return false;
      if (!lastRunAt) return true;
      const last = new Date(lastRunAt);
      return last.toDateString() !== now.toDateString();
    }
    case "meeting-recap":
      return hoursSince(lastRunAt) >= 0.25;
    case "focus-tracker":
      return hoursSince(lastRunAt) >= 2;
    case "action-items":
      return hoursSince(lastRunAt) >= 1;
    default:
      return false;
  }
}

let schedulerTimer: ReturnType<typeof setInterval> | null = null;

export function startPipeScheduler(): void {
  if (schedulerTimer) return;

  schedulerTimer = setInterval(() => {
    const enabled = listEnabledPipes();
    for (const pipe of enabled) {
      if (runningPipes.has(pipe.pipe_id)) continue;
      if (!shouldRunScheduled(pipe.pipe_id as PipeId, pipe.last_run_at)) continue;
      void runPipe(pipe.pipe_id).catch((err) => {
        console.error(`[pipes] scheduled run failed for ${pipe.pipe_id}:`, err);
      });
    }
  }, 60_000);
}
