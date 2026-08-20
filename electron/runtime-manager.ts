import { app, safeStorage, shell } from "electron";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import manifest from "../build/runtime-manifest.json";
import {
  initialRuntimeStatus,
  type RuntimeError,
  type RuntimePhase,
  type RuntimeStatus,
  type ModelProvider,
} from "./runtime-types.js";
import { startBackend, stopBackend } from "./backend-manager.js";
import {
  isSupportedRuntimePlatform,
  nextRuntimeStatus,
  redactRuntimeDiagnostics,
  readManagedApiKey,
} from "./runtime-policy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTTP_URL = `http://127.0.0.1:${manifest.hydradbHttpPort}`;
const ADMIN_URL = `http://127.0.0.1:${manifest.hydradbAdminPort}`;
const ADMIN_READY = `${ADMIN_URL}/readyz`;

type StatusListener = (status: RuntimeStatus) => void;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reachable(url: string, timeoutMs = 1_500): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok || response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForHealth(url: string, attempts: number): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await reachable(url)) return;
    await delay(500);
  }
  throw new Error(`health check timed out for ${url}`);
}

export class RuntimeManager {
  private status: RuntimeStatus = initialRuntimeStatus();
  private listeners = new Set<StatusListener>();
  private memoryProcess: ChildProcess | null = null;
  private activeStart: Promise<void> | null = null;
  private memoryOutput = "";
  private existingLogSanitized = false;

  getStatus = (): RuntimeStatus => ({ ...this.status });

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => this.listeners.delete(listener);
  }

  private update(
    phase: RuntimePhase,
    message: string,
    progress: number,
    patch: Partial<RuntimeStatus> = {}
  ) {
    this.status = nextRuntimeStatus(this.status, phase, message, progress, patch);
    this.writeLog(`${phase}: ${message}`);
    for (const listener of this.listeners) listener(this.getStatus());
  }

  private paths() {
    const root = path.join(app.getPath("userData"), "runtime");
    const memory = path.join(root, "hydradb");
    const bin = path.join(memory, "bin");
    const wrappers = path.join(memory, "wrappers");
    return {
      root,
      memory,
      bin,
      wrappers,
      server: path.join(bin, "graph-node"),
      log: path.join(root, "runtime.log"),
      provider: path.join(root, "provider.json"),
    };
  }

  private writeLog(message: string) {
    try {
      const { root, log } = this.paths();
      mkdirSync(root, { recursive: true });
      if (!this.existingLogSanitized) {
        this.existingLogSanitized = true;
        if (existsSync(log)) {
          const existing = readFileSync(log, "utf8");
          const sanitized = redactRuntimeDiagnostics(existing);
          if (sanitized !== existing) writeFileSync(log, sanitized, { mode: 0o600 });
        }
      }
      appendFileSync(
        log,
        `[${new Date().toISOString()}] ${redactRuntimeDiagnostics(message)}\n`,
      );
      chmodSync(log, 0o600);
    } catch {
      // Logging must never prevent startup.
    }
  }

  async openLogs() {
    const { root, log } = this.paths();
    mkdirSync(root, { recursive: true });
    if (!existsSync(log)) appendFileSync(log, "Chronicle runtime log\n");
    await shell.showItemInFolder(log);
  }

  getProviderInfo(): { provider: ModelProvider | null; configured: boolean } {
    if (process.env.GEMINI_API_KEY) {
      return { provider: "gemini", configured: true };
    }
    const providerPath = this.paths().provider;
    if (!existsSync(providerPath)) return { provider: null, configured: false };
    try {
      const stored = JSON.parse(readFileSync(providerPath, "utf8")) as {
        encrypted: boolean;
        content: string;
      };
      const buffer = Buffer.from(stored.content, "base64");
      const payload = stored.encrypted
        ? safeStorage.decryptString(buffer)
        : buffer.toString("utf8");
      const value = JSON.parse(payload) as { provider?: string };
      return value.provider === "gemini"
        ? { provider: "gemini", configured: true }
        : { provider: null, configured: false };
    } catch {
      return { provider: null, configured: false };
    }
  }

  configureProvider(provider: ModelProvider, apiKey: string) {
    const key = apiKey.trim();
    if (!key) throw new Error("API key is required");
    const payload = JSON.stringify({ provider, apiKey: key });
    const encrypted = safeStorage.isEncryptionAvailable();
    const content = encrypted
      ? safeStorage.encryptString(payload).toString("base64")
      : Buffer.from(payload, "utf8").toString("base64");
    const providerPath = this.paths().provider;
    writeFileSync(providerPath, JSON.stringify({ encrypted, content }), {
      mode: 0o600,
    });
    chmodSync(providerPath, 0o600);
  }

  private getProviderEnv(): NodeJS.ProcessEnv {
    if (process.env.GEMINI_API_KEY) {
      return {};
    }
    const providerPath = this.paths().provider;
    if (!existsSync(providerPath)) return {};
    try {
      const stored = JSON.parse(readFileSync(providerPath, "utf8")) as {
        encrypted: boolean;
        content: string;
      };
      const buffer = Buffer.from(stored.content, "base64");
      const payload = stored.encrypted
        ? safeStorage.decryptString(buffer)
        : buffer.toString("utf8");
      const value = JSON.parse(payload) as {
        provider?: string;
        apiKey: string;
      };
      if (value.provider !== "gemini" || !value.apiKey?.trim()) return {};
      return { GEMINI_API_KEY: value.apiKey };
    } catch (error) {
      this.writeLog(`provider credentials could not be read: ${String(error)}`);
      return {};
    }
  }

  start(): Promise<void> {
    if (this.activeStart) return this.activeStart;
    this.activeStart = this.startInternal().finally(() => {
      this.activeStart = null;
    });
    return this.activeStart;
  }

  async retry(): Promise<void> {
    await this.stop();
    this.status = initialRuntimeStatus();
    await this.start();
  }

  private hydraBackendEnv(): Record<string, string> {
    const token =
      readManagedApiKey(path.join(os.homedir(), ".chronicle", "hydradb")) ||
      "local-development-token-32-bytes";
    return {
      HYDRADB_HTTP_URL: HTTP_URL,
      HYDRADB_ADMIN_URL: ADMIN_URL,
      HYDRADB_AUTH_TOKEN: token,
    };
  }

  private async startInternal() {
    try {
      if (!app.isPackaged) {
        this.update("checking", "Waiting for development services", 20);
        await waitForHealth(ADMIN_READY, 90);
        this.update("starting-backend", "Connecting to the recorder", 75, {
          memoryReady: true,
        });
        await startBackend(
          { ...this.hydraBackendEnv(), ...this.getProviderEnv() },
          (message) => this.writeLog(`backend: ${message}`),
        );
        this.update("ready", "Local runtime ready", 100, {
          memoryReady: true,
          backendReady: true,
          error: undefined,
        });
        return;
      }

      if (!isSupportedRuntimePlatform(process.platform)) {
        throw this.runtimeError(
          "UNSUPPORTED_PLATFORM",
          "Chronicle requires Windows, macOS, or Linux.",
          false
        );
      }

      const paths = this.paths();
      mkdirSync(paths.memory, { recursive: true });
      this.update("checking", "Checking HydraDB", 10);

      const providerEnv = this.getProviderEnv();
      if (!(await reachable(ADMIN_READY))) {
        this.update("starting-memory", "Starting the memory graph", 55);
        await this.ensureHydra();
        await this.waitForMemoryHealth();
      }

      this.update("starting-backend", "Starting the Chronicle recorder", 78, {
        memoryReady: true,
      });
      try {
        await startBackend(
          {
            ...this.hydraBackendEnv(),
            CHRONICLE_NATIVE_DIR: path.join(process.resourcesPath, "backend-native"),
            CHRONICLE_AUTO_START: "0",
            ...providerEnv,
          },
          (message) => this.writeLog(`backend: ${message}`),
        );
      } catch (error) {
        throw this.runtimeError(
          String(error).includes("already in use") ? "PORT_IN_USE" : "BACKEND_START_FAILED",
          String(error).includes("already in use")
            ? `Port ${manifest.backendPort} is already in use by another process.`
            : "The Chronicle capture engine could not be started.",
          true,
          error instanceof Error ? error.stack : String(error)
        );
      }
      this.update("ready", "Chronicle is ready", 100, {
        memoryReady: true,
        backendReady: true,
        error: undefined,
      });
    } catch (error) {
      const runtimeError = this.asRuntimeError(error);
      this.fail(runtimeError);
      throw error;
    }
  }

  private ensureHydra(): Promise<void> {
    this.update("installing", "Starting the memory graph", 28);
    const script = path.join(__dirname, "..", "scripts", "hydradb-start.mjs");

    return new Promise((resolve, reject) => {
      const child = spawn("node", [script], {
        cwd: path.join(__dirname, ".."),
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32",
      });
      this.memoryProcess = child;
      this.pipeLogs(child, "hydradb", (text) => {
        this.memoryOutput = `${this.memoryOutput}\n${text}`.slice(-16_000);
      });
      child.once("error", (error) => {
        reject(
          this.runtimeError(
            "INSTALL_FAILED",
            "Could not start the HydraDB graph-node.",
            true,
            error.message
          )
        );
      });
      child.once("exit", (code) => {
        if (code === 0) resolve();
        else
          reject(
            this.runtimeError(
              "INSTALL_FAILED",
              "HydraDB could not be started. Run npm run memory:bootstrap, then retry.",
              true,
              this.memoryOutput
            )
          );
      });
    });
  }

  private pipeLogs(
    child: ChildProcess,
    label: string,
    capture?: (text: string) => void
  ) {
    const log = (data: Buffer) => {
      const text = data.toString().trim();
      this.writeLog(`${label}: ${text}`);
      capture?.(text);
    };
    child.stdout?.on("data", log);
    child.stderr?.on("data", log);
  }

  private async waitForMemoryHealth() {
    for (let attempt = 0; attempt < 240; attempt += 1) {
      if (await reachable(ADMIN_READY)) return;
      await delay(500);
    }
    throw this.runtimeError(
      "HEALTH_TIMEOUT",
      "HydraDB took too long to start.",
      true,
      this.memoryOutput
    );
  }

  async stop(): Promise<void> {
    this.update("stopping", "Stopping local services", 10, {
      backendReady: false,
    });
    stopBackend();
    await this.stopChild(this.memoryProcess);
    this.memoryProcess = null;
    this.update("stopping", "Local services stopped", 100, {
      memoryReady: false,
      backendReady: false,
    });
  }

  private async stopChild(child: ChildProcess | null) {
    if (!child || child.exitCode !== null || child.killed) return;
    child.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      delay(3_000),
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }

  private runtimeError(
    code: RuntimeError["code"],
    message: string,
    retryable: boolean,
    detail?: string
  ): RuntimeError {
    return { code, message, retryable, detail };
  }

  private asRuntimeError(error: unknown): RuntimeError {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      "retryable" in error
    ) {
      return error as RuntimeError;
    }
    const detail = error instanceof Error ? error.stack ?? error.message : String(error);
    const code = detail.includes("health check timed out")
      ? "HEALTH_TIMEOUT"
      : "UNKNOWN";
    return this.runtimeError(code, "The local runtime could not be started.", true, detail);
  }

  private fail(error: RuntimeError) {
    this.update("error", error.message, this.status.progress, {
      error,
      backendReady: false,
    });
  }
}
