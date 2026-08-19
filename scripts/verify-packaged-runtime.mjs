import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const asarPath = process.argv[2];
if (!asarPath || !existsSync(asarPath)) {
  throw new Error(`packaged ASAR not found: ${asarPath ?? "<missing argument>"}`);
}

const asarBin = path.resolve("node_modules", ".bin", "asar");
const entries = new Set(
  execFileSync(asarBin, ["list", asarPath], { encoding: "utf8" }).split("\n"),
);
const requiredEntries = [
  "/backend/dist/index.js",
  "/node_modules/zod/package.json",
  "/node_modules/semver/package.json",
  "/node_modules/@composio/core/package.json",
];

for (const entry of requiredEntries) {
  if (!entries.has(entry)) {
    throw new Error(`required packaged runtime entry is missing: ${entry}`);
  }
}

console.log("packaged runtime dependencies verified");
