import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toWslPath, wslAvailable } from "./wsl-path.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTTP_PORT = Number(process.env.HYDRADB_HTTP_PORT ?? 8443);
const BOLT_PORT = Number(process.env.HYDRADB_BOLT_PORT ?? 7687);
const ADMIN_PORT = Number(process.env.HYDRADB_ADMIN_PORT ?? 9090);
const AUTH_TOKEN =
  process.env.HYDRADB_AUTH_TOKEN ?? "local-development-token-32-bytes";
const DATA_ROOT =
  process.env.HYDRADB_DATA_DIR ??
  path.join(os.homedir(), ".chronicle", "hydradb");
const USE_DOCKER = process.env.HYDRADB_USE_DOCKER === "1";
const IMAGE = process.env.HYDRADB_IMAGE ?? "ghcr.io/hydra-db/hydradb:latest";
const CONTAINER = process.env.HYDRADB_CONTAINER ?? "chronicle-hydradb";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let out = "";
    child.stdout?.on("data", (chunk) => {
      out += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      out += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(out.trim() || `${command} exited ${code}`));
    });
  });
}

function lookupOnPath(command) {
  try {
    const output = execFileSync(
      process.platform === "win32" ? "where" : "which",
      [command],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
    return output.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
  } catch {
    return null;
  }
}

function hasWsl() {
  return process.platform === "win32" && wslAvailable();
}

async function reachable(url, timeoutMs = 1500) {
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

function prepareDirs() {
  const store = path.join(DATA_ROOT, "store");
  const cache = path.join(DATA_ROOT, "cache");
  mkdirSync(store, { recursive: true });
  mkdirSync(cache, { recursive: true });
  mkdirSync(path.join(DATA_ROOT, "bin"), { recursive: true });
  const tokenFile = path.join(DATA_ROOT, "auth-token");
  writeFileSync(tokenFile, `${AUTH_TOKEN}\n`, { encoding: "utf8" });
  return { store, cache, tokenFile };
}

function graphEnv({ store, cache, tokenFile }) {
  return {
    CLOUD_PROVIDER: "local",
    LOCAL_PATH: store,
    GRAPH_NAMESPACE: "default",
    GRAPH_ID: "default",
    GRAPH_CELL_ID: "cell-0",
    GRAPH_CELLS: "cell-0",
    GRAPH_NODE_ID: "node-0",
    GRAPH_BOLT_NODE_ADDRESSES: `node-0=127.0.0.1:${BOLT_PORT}`,
    GRAPH_ADVERTISED_BOLT_ADDR: `127.0.0.1:${BOLT_PORT}`,
    GRAPH_DATA_CACHE_DIR: cache,
    GRAPH_AUTH_TOKEN_FILE: tokenFile,
    GRAPH_ALLOW_PLAINTEXT: "true",
    RUST_MIN_STACK: "33554432",
  };
}

function dumpGraphNodeLog() {
  const logPath = path.join(DATA_ROOT, "graph-node.log");
  if (!existsSync(logPath)) {
    console.error(`[hydradb] no graph-node.log at ${logPath}`);
    return;
  }
  const tail = readFileSync(logPath, "utf8").trim().split(/\r?\n/).slice(-20).join("\n");
  if (tail) console.error(`[hydradb] graph-node.log:\n${tail}`);
}

async function waitForReady(attempts = 90) {
  const url = `http://127.0.0.1:${ADMIN_PORT}/readyz`;
  for (let i = 0; i < attempts; i += 1) {
    if (await reachable(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  dumpGraphNodeLog();
  throw new Error(`HydraDB did not become ready at ${url}`);
}

function resolveHostBinary() {
  const exe = process.platform === "win32" ? "graph-node.exe" : "graph-node";
  const candidates = [
    process.env.HYDRADB_BIN,
    path.join(DATA_ROOT, "bin", exe),
    path.join(DATA_ROOT, "bin", "graph-node"),
    lookupOnPath("graph-node"),
    lookupOnPath("graph-node.exe"),
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function spawnDetached(command, args, env) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: false,
  });
  child.unref();
  writeFileSync(path.join(DATA_ROOT, "graph-node.pid"), String(child.pid ?? ""), {
    encoding: "utf8",
  });
}

async function startHostBinary(bin, dirs) {
  console.log(`[hydradb] starting native graph-node: ${bin}`);
  spawnDetached(bin, [], graphEnv(dirs));
  await waitForReady();
}

function readWslBinMarker() {
  const marker = path.join(DATA_ROOT, "wsl-bin");
  if (!existsSync(marker)) return null;
  const value = readFileSync(marker, "utf8").trim();
  return value || null;
}

async function resolveWslBinary() {
  if (process.env.HYDRADB_WSL_BIN) return process.env.HYDRADB_WSL_BIN;
  const marked = readWslBinMarker();
  if (marked) return marked;
  try {
    const found = await run("wsl", ["-e", "bash", "-lc", "command -v graph-node"]);
    return found.trim() || null;
  } catch {
    return null;
  }
}

async function startWsl(dirs) {
  const bin = await resolveWslBinary();
  if (!bin) return false;

  const store = await toWslPath(dirs.store);
  const cache = await toWslPath(dirs.cache);
  const tokenFile = await toWslPath(dirs.tokenFile);
  const logFile = await toWslPath(path.join(DATA_ROOT, "graph-node.log"));

  const remote = [
    "export CLOUD_PROVIDER=local",
    `export LOCAL_PATH='${store}'`,
    "export GRAPH_NAMESPACE=default",
    "export GRAPH_ID=default",
    "export GRAPH_CELL_ID=cell-0",
    "export GRAPH_CELLS=cell-0",
    "export GRAPH_NODE_ID=node-0",
    `export GRAPH_BOLT_NODE_ADDRESSES='node-0=127.0.0.1:${BOLT_PORT}'`,
    `export GRAPH_ADVERTISED_BOLT_ADDR='127.0.0.1:${BOLT_PORT}'`,
    `export GRAPH_DATA_CACHE_DIR='${cache}'`,
    `export GRAPH_AUTH_TOKEN_FILE='${tokenFile}'`,
    "export GRAPH_ALLOW_PLAINTEXT=true",
    "export RUST_MIN_STACK=33554432",
    // nohup ... & is killed when this `wsl.exe` invocation exits. setsid -f
    // forks into a new session so graph-node survives in the WSL VM.
    `setsid -f '${bin}' </dev/null > '${logFile}' 2>&1`,
  ].join("; ");

  console.log(`[hydradb] starting graph-node in WSL: ${bin}`);
  await run("wsl", ["-e", "bash", "-lc", remote]);
  await waitForReady();
  return true;
}

async function startDocker(dirs) {
  await run("docker", ["version"]);
  try {
    await run("docker", ["rm", "-f", CONTAINER]);
  } catch {
    // Container may not exist yet.
  }
  console.log(`[hydradb] pulling ${IMAGE}`);
  await run("docker", ["pull", IMAGE]);
  await run("docker", [
    "run",
    "-d",
    "--name",
    CONTAINER,
    "-p",
    `${BOLT_PORT}:7687`,
    "-p",
    `${HTTP_PORT}:8443`,
    "-p",
    `${ADMIN_PORT}:9090`,
    "-v",
    `${dirs.store}:/data/store`,
    "-v",
    `${dirs.cache}:/data/cache`,
    "-v",
    `${dirs.tokenFile}:/data/auth-token`,
    "-e",
    "CLOUD_PROVIDER=local",
    "-e",
    "LOCAL_PATH=/data/store",
    "-e",
    "GRAPH_NAMESPACE=default",
    "-e",
    "GRAPH_ID=default",
    "-e",
    "GRAPH_CELL_ID=cell-0",
    "-e",
    "GRAPH_CELLS=cell-0",
    "-e",
    "GRAPH_NODE_ID=node-0",
    "-e",
    "GRAPH_BOLT_NODE_ADDRESSES=node-0=127.0.0.1:7687",
    "-e",
    "GRAPH_ADVERTISED_BOLT_ADDR=127.0.0.1:7687",
    "-e",
    "GRAPH_DATA_CACHE_DIR=/data/cache",
    "-e",
    "GRAPH_AUTH_TOKEN_FILE=/data/auth-token",
    "-e",
    "GRAPH_ALLOW_PLAINTEXT=true",
    "-e",
    "RUST_MIN_STACK=33554432",
    IMAGE,
  ]);
  await waitForReady();
}

async function main() {
  const admin = `http://127.0.0.1:${ADMIN_PORT}/readyz`;
  if (await reachable(admin)) {
    console.log(`[hydradb] already running at ${admin}`);
    return;
  }

  const dirs = prepareDirs();
  const hostBin = resolveHostBinary();

  if (hostBin) {
    await startHostBinary(hostBin, dirs);
  } else if (hasWsl() && (await startWsl(dirs))) {
    // started in WSL
  } else if (USE_DOCKER) {
    await startDocker(dirs);
  } else {
    throw new Error(
      [
        "No native HydraDB graph-node found.",
        "Build one (no Docker): npm run memory:bootstrap",
        "Or put the binary at ~/.chronicle/hydradb/bin/graph-node",
        "Docker is opt-in only: HYDRADB_USE_DOCKER=1 npm run memory:start",
      ].join("\n")
    );
  }

  console.log(
    `[hydradb] ready  http://127.0.0.1:${HTTP_PORT}  bolt://127.0.0.1:${BOLT_PORT}`
  );
}

main().catch((error) => {
  console.error(`[hydradb] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
