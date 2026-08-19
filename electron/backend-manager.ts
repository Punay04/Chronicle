import { type ChildProcess } from "child_process";
import { execFile } from "child_process";
import { existsSync, readFileSync } from "fs";
import { promisify } from "util";
import { app, utilityProcess, type UtilityProcess } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_PORT = Number(process.env.CHRONICLE_PORT ?? 3030);
const API_URL = `http://127.0.0.1:${API_PORT}`;

let backendProcess: ChildProcess | null = null;
let backendUtilityProcess: UtilityProcess | null = null;
type BackendLogSink = (message: string) => void;

function loadEnvFile(envPath: string): Record<string, string> {
  const vars: Record<string, string> = {};
  if (!existsSync(envPath)) return vars;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

function getBackendEntry(): { command: string; args: string[]; cwd: string } {
  const backendDir = path.join(__dirname, "..", "backend");
  const isDev = !app.isPackaged;

  // The backend needs node:sqlite (Node >= 22.5). Electron's bundled Node is
  // older, so process.execPath cannot run it — use the system node instead.
  if (isDev) {
    const tsxBin = path.join(
      backendDir,
      "node_modules",
      "tsx",
      "dist",
      "cli.mjs"
    );
    return {
      command: "node",
      args: [tsxBin, "src/index.ts"],
      cwd: backendDir,
    };
  }

  return {
    command: "node",
    args: [path.join(backendDir, "dist", "index.js")],
    // An ASAR path is readable by Node but cannot be used as an OS working
    // directory. Runtime data is explicitly routed to ~/.chronicle below.
    cwd: app.getPath("userData"),
  };
}

function getEnvForBackend(): NodeJS.ProcessEnv {
  const dataDir = path.join(os.homedir(), ".chronicle");
  const envPath = path.join(__dirname, "..", ".env");
  const dotenv = loadEnvFile(envPath);

  return {
    ...process.env,
    ...dotenv,
    CHRONICLE_DATA_DIR: dataDir,
    CHRONICLE_PORT: String(API_PORT),
  };
}

async function backendHasChatRoute(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    return res.status !== 404;
  } catch {
    return false;
  }
}

async function getPidsOnPort(port: number): Promise<number[]> {
  try {
    let stdout: string;
    if (process.platform === "win32") {
      ({ stdout } = await execFileAsync("powershell", [
        "-NoProfile",
        "-Command",
        `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).OwningProcess | Select-Object -Unique`,
      ]));
    } else {
      ({ stdout } = await execFileAsync("lsof", [
        "-ti",
        `tcp:${port}`,
        "-sTCP:LISTEN",
      ]).catch(() => ({ stdout: "" })));
    }
    return stdout
      .trim()
      .split(/\r?\n/)
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isFinite(pid) && pid > 0);
  } catch {
    return [];
  }
}

async function waitForPortFree(
  port: number,
  maxAttempts = 40
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const pids = await getPidsOnPort(port);
    if (pids.length === 0) return;
    await new Promise((r) => setTimeout(r, 250));
  }
}

export async function startBackend(
  envOverrides: NodeJS.ProcessEnv = {},
  logSink?: BackendLogSink,
): Promise<void> {
  // In dev, scripts/dev.mjs owns the backend process. Electron only connects so
  // main-process hot-reload does not kill ffmpeg/audio children on Windows.
  if (!app.isPackaged) {
    await waitForHealth(60);
    const chatReady = await backendHasChatRoute();
    if (!chatReady) {
      throw new Error(
        "Backend not reachable on port 3030. Ensure `npm run dev` started the backend."
      );
    }
    return;
  }

  if (backendUtilityProcess) {
    const hasChat = await backendHasChatRoute();
    if (hasChat) {
      await waitForHealth(5);
      return;
    }
    backendUtilityProcess.kill();
    backendUtilityProcess = null;
  }

  const hasChat = await backendHasChatRoute();
  if (hasChat) {
    await waitForHealth(5);
    return;
  } else {
    const pids = await getPidsOnPort(API_PORT);
    if (pids.length > 0) {
      throw new Error(`Port ${API_PORT} is already in use by another process`);
    }
  }

  const { args, cwd } = getBackendEntry();
  const entry = args[0];
  let startupFailure: string | null = null;
  let backendOutput = "";
  backendUtilityProcess = utilityProcess.fork(entry, [], {
    cwd,
    env: { ...getEnvForBackend(), ...envOverrides },
    stdio: "pipe",
    serviceName: "Chronicle Capture Engine",
  });

  const recordOutput = (chunk: Buffer, isError: boolean) => {
    const text = chunk.toString().trim();
    if (!text) return;
    backendOutput = `${backendOutput}\n${text}`.slice(-16_000);
    logSink?.(text);
    if (isError) console.error(`[backend] ${text}`);
    else console.log(`[backend] ${text}`);
  };
  backendUtilityProcess.stdout?.on("data", (chunk: Buffer) =>
    recordOutput(chunk, false),
  );
  backendUtilityProcess.stderr?.on("data", (chunk: Buffer) =>
    recordOutput(chunk, true),
  );

  backendUtilityProcess.on("exit", (code) => {
    startupFailure = `Backend exited before becoming healthy (${code ?? "signal"}).${backendOutput}`;
    logSink?.(`process exited with code ${code ?? "signal"}`);
    console.log(`[backend] exited with code ${code}`);
    backendUtilityProcess = null;
  });

  await waitForHealth(30, () => startupFailure);

  const chatReady = await backendHasChatRoute();
  if (!chatReady) {
    throw new Error("Backend started but /chat route is unavailable");
  }
}

export function stopBackend(): void {
  if (!app.isPackaged) return;
  if (backendUtilityProcess) {
    backendUtilityProcess.kill();
    backendUtilityProcess = null;
  }
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill("SIGTERM");
    backendProcess = null;
  }
}

export async function waitForHealth(
  maxAttempts = 30,
  getStartupFailure?: () => string | null,
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const startupFailure = getStartupFailure?.();
    if (startupFailure) throw new Error(startupFailure);
    try {
      const res = await fetch(`${API_URL}/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const startupFailure = getStartupFailure?.();
  if (startupFailure) throw new Error(startupFailure);
  throw new Error("Backend failed to start on port 3030");
}

export function getApiUrl(): string {
  return API_URL;
}

export async function proxyApi(
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  const url = `${API_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${method} ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}
