import { spawn } from "node:child_process";
import { platform } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const children = [];
const isWin = platform() === "win32";

function run(label, command, args, { fatal = false } = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: isWin,
    env: process.env,
  });

  children.push(child);

  child.on("exit", (code, signal) => {
    if (signal) return;
    if (code && code !== 0) {
      console.error(`[dev] ${label} exited with code ${code}`);
      if (fatal) shutdown(code ?? 1);
    }
  });

  return child;
}

function shutdown(exitCode = 0) {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exit(exitCode);
}

run("hydradb", "node", [path.join(root, "scripts", "hydradb-start.mjs")]);
run("backend", "npm", ["run", "backend:dev"], { fatal: true });

const app = run("app", "npx", ["vite"], { fatal: true });
app.on("exit", (code) => shutdown(code ?? 0));

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
