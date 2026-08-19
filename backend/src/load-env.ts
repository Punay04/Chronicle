import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

function parseEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const eq = trimmed.indexOf("=");
  if (eq === -1) return null;

  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return [key, value];
}

export function loadRootEnvFile(envPath: string): Record<string, string> {
  const vars: Record<string, string> = {};
  if (!existsSync(envPath)) return vars;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    const [key, value] = parsed;
    vars[key] = value;
  }
  return vars;
}

/** Load root `.env` into process.env (does not override existing vars). */
export function loadRootEnv(): void {
  const rootDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../.."
  );
  const envPath = path.join(rootDir, ".env");
  const vars = loadRootEnvFile(envPath);
  for (const [key, value] of Object.entries(vars)) {
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

export function getProjectRootEnvPath(): string {
  const rootDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../.."
  );
  return path.join(rootDir, ".env");
}
