export type RuntimePhase =
  | "checking"
  | "installing"
  | "starting-memory"
  | "starting-backend"
  | "ready"
  | "error"
  | "stopping";

export interface RuntimeError {
  code: string;
  message: string;
  detail?: string;
  retryable: boolean;
}

export interface RuntimeStatus {
  phase: RuntimePhase;
  message: string;
  progress: number;
  error?: RuntimeError;
  memoryReady: boolean;
  backendReady: boolean;
  updatedAt: string;
}

export type ModelProvider = "gemini" | "openai" | "anthropic";

export const initialRuntimeStatus = (): RuntimeStatus => ({
  phase: "checking",
  message: "Checking local runtime",
  progress: 5,
  memoryReady: false,
  backendReady: false,
  updatedAt: new Date().toISOString(),
});

/**
 * Display names for runtime phases. Settings used to render the raw phase id
 * (e.g. "starting-memory") straight into a badge — always map through this.
 */
export const PHASE_LABELS: Record<RuntimePhase, string> = {
  checking: "Checking",
  installing: "Installing HydraDB",
  "starting-memory": "Starting Memory",
  "starting-backend": "Starting Recorder",
  ready: "Ready",
  error: "Needs Attention",
  stopping: "Stopping",
};
