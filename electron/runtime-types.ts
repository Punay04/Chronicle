export type RuntimePhase =
  | "checking"
  | "installing"
  | "starting-memory"
  | "starting-backend"
  | "ready"
  | "error"
  | "stopping";

export interface RuntimeError {
  code:
    | "UNSUPPORTED_PLATFORM"
    | "PORT_IN_USE"
    | "INSTALL_FAILED"
    | "MEMORY_START_FAILED"
    | "PROVIDER_KEY_REQUIRED"
    | "BACKEND_START_FAILED"
    | "HEALTH_TIMEOUT"
    | "UNKNOWN";
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
