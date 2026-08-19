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
  message: "checking local runtime",
  progress: 5,
  memoryReady: false,
  backendReady: false,
  updatedAt: new Date().toISOString(),
});
