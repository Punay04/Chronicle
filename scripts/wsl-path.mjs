import { execFileSync } from "node:child_process";

export function windowsPathForWsl(winPath) {
  return String(winPath).replace(/\\/g, "/");
}

export function toWslPath(winPath) {
  return execFileSync(
    "wsl",
    ["-e", "wslpath", "-a", windowsPathForWsl(winPath)],
    { encoding: "utf8" }
  ).trim();
}

export function wslAvailable() {
  try {
    execFileSync("wsl", ["-e", "true"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
