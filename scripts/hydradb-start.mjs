import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IMAGE = process.env.HYDRADB_IMAGE ?? "ghcr.io/hydra-db/hydradb:latest";
const CONTAINER = process.env.HYDRADB_CONTAINER ?? "chronicle-hydradb";
const HTTP_PORT = Number(process.env.HYDRADB_HTTP_PORT ?? 8443);
const BOLT_PORT = Number(process.env.HYDRADB_BOLT_PORT ?? 7687);
const ADMIN_PORT = Number(process.env.HYDRADB_ADMIN_PORT ?? 9090);
const AUTH_TOKEN =
  process.env.HYDRADB_AUTH_TOKEN ?? "local-development-token-32-bytes";
const DATA_ROOT =
  process.env.HYDRADB_DATA_DIR ??
  path.join(os.homedir(), ".chronicle", "hydradb");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
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
  const tokenFile = path.join(DATA_ROOT, "auth-token");
  writeFileSync(tokenFile, `${AUTH_TOKEN}\n`, { encoding: "utf8" });
  return { store, cache, tokenFile };
}

async function waitForReady(attempts = 90) {
  const url = `http://127.0.0.1:${ADMIN_PORT}/readyz`;
  for (let i = 0; i < attempts; i += 1) {
    if (await reachable(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`HydraDB did not become ready at ${url}`);
}

async function main() {
  const admin = `http://127.0.0.1:${ADMIN_PORT}/readyz`;
  if (await reachable(admin)) {
    console.log(`[hydradb] already running at ${admin}`);
    return;
  }

  try {
    await run("docker", ["version"]);
  } catch {
    throw new Error(
      "Docker is required to run the local HydraDB graph node. Start Docker Desktop and retry."
    );
  }

  const { store, cache, tokenFile } = prepareDirs();

  try {
    await run("docker", ["rm", "-f", CONTAINER]);
  } catch {
    // Container may not exist yet.
  }

  console.log(`[hydradb] pulling ${IMAGE}`);
  await run("docker", ["pull", IMAGE]);

  const args = [
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
    `${store}:/data/store`,
    "-v",
    `${cache}:/data/cache`,
    "-v",
    `${tokenFile}:/data/auth-token`,
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
  ];

  console.log("[hydradb] starting graph-node");
  await run("docker", args);
  await waitForReady();
  console.log(
    `[hydradb] ready  http://127.0.0.1:${HTTP_PORT}  bolt://127.0.0.1:${BOLT_PORT}`
  );
}

main().catch((error) => {
  console.error(`[hydradb] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
