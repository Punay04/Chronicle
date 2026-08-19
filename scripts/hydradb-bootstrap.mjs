import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toWslPath, wslAvailable } from "./wsl-path.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "hydradb-bootstrap-wsl.sh");
const marker = path.join(os.homedir(), ".chronicle", "hydradb", "wsl-bin");
const hostBinDir = path.join(os.homedir(), ".chronicle", "hydradb", "bin");

function runInherit(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      shell: false,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code}`));
    });
  });
}

async function bootstrapWindows() {
  if (!wslAvailable()) {
    throw new Error(
      "WSL is required to compile HydraDB without Docker on Windows. Install Ubuntu from Microsoft Store, then retry."
    );
  }

  mkdirSync(path.dirname(marker), { recursive: true });
  const wslScript = toWslPath(script);
  const wslMarker = toWslPath(marker);
  const remote = [
    `export HYDRADB_MARKER='${wslMarker}'`,
    `sed 's/\\r$//' '${wslScript}' | bash`,
  ].join("; ");

  console.log("[hydradb] compiling graph-node inside WSL (no Docker)");
  await runInherit("wsl", ["-e", "bash", "-lc", remote]);
}

async function bootstrapUnix() {
  mkdirSync(hostBinDir, { recursive: true });
  console.log("[hydradb] compiling graph-node on this host (no Docker)");
  await runInherit("bash", [script]);
}

async function main() {
  if (!existsSync(script)) {
    throw new Error(`missing ${script}`);
  }

  if (process.platform === "win32") {
    await bootstrapWindows();
  } else if (process.platform === "linux") {
    await bootstrapUnix();
  } else {
    throw new Error(
      [
        "On macOS, compile HydraDB yourself (no Docker):",
        "  brew install just cmake pkg-config llvm suite-sparse",
        "  brew install cleishm/neo4j/libcypher-parser",
        "  git clone https://github.com/hydra-db/hydradb ~/src/hydradb",
        "  cd ~/src/hydradb && cargo build --locked --features server-runtime --bin graph-node --release",
        `  mkdir -p ${hostBinDir}`,
        `  cp ~/src/hydradb/target/release/graph-node ${path.join(hostBinDir, "graph-node")}`,
        "Then run: npm run memory:start",
      ].join("\n")
    );
  }

  console.log("[hydradb] bootstrap finished. Next: npm run memory:start");
}

main().catch((error) => {
  console.error(`[hydradb] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
