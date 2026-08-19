import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn("node", [path.join(root, "scripts", "hydradb-start.mjs")], {
  stdio: "inherit",
  cwd: root,
  shell: process.platform === "win32",
});
child.on("exit", (code) => process.exit(code ?? 1));
