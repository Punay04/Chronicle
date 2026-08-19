import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DATA_DIR } from "../config.js";

const execFileAsync = promisify(execFile);

const SWIFT_SOURCE = process.env.CHRONICLE_NATIVE_DIR
  ? path.join(process.env.CHRONICLE_NATIVE_DIR, "macos-system-audio.swift")
  : path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../native/macos-system-audio.swift"
    );
const BIN_DIR = path.join(DATA_DIR, "bin");
const BIN_PATH = path.join(BIN_DIR, "macos-system-audio");

let binaryPromise: Promise<string | null> | null = null;
let unavailableLogged = false;

async function compileBinary(): Promise<string | null> {
  if (process.platform !== "darwin" || !fs.existsSync(SWIFT_SOURCE)) return null;

  try {
    const binStat = fs.statSync(BIN_PATH, { throwIfNoEntry: false });
    const srcStat = fs.statSync(SWIFT_SOURCE);
    if (binStat && binStat.mtimeMs >= srcStat.mtimeMs) return BIN_PATH;

    fs.mkdirSync(BIN_DIR, { recursive: true });
    console.log("[system-audio] compiling macOS capture helper with swiftc...");
    const moduleCache = path.join(DATA_DIR, "swift-module-cache");
    fs.mkdirSync(moduleCache, { recursive: true });
    await execFileAsync(
      "xcrun",
      [
        "swiftc",
        "-module-cache-path",
        moduleCache,
        "-O",
        SWIFT_SOURCE,
        "-o",
        BIN_PATH,
      ],
      { timeout: 120_000 }
    );
    console.log(`[system-audio] compiled ${BIN_PATH}`);
    return BIN_PATH;
  } catch (err) {
    if (!unavailableLogged) {
      unavailableLogged = true;
      console.warn(
        "[system-audio] native capture unavailable; meetings will use microphone only:",
        err instanceof Error ? err.message : err
      );
    }
    return null;
  }
}

export function ensureMacSystemAudioBinary(): Promise<string | null> {
  if (!binaryPromise) binaryPromise = compileBinary();
  return binaryPromise;
}
