import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DATA_DIR } from "../config.js";

const execFileAsync = promisify(execFile);

const SWIFT_SOURCE = process.env.CHRONICLE_NATIVE_DIR
  ? path.join(process.env.CHRONICLE_NATIVE_DIR, "macos-ocr.swift")
  : path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../native/macos-ocr.swift"
    );
const BIN_DIR = path.join(DATA_DIR, "bin");
const BIN_PATH = path.join(BIN_DIR, "macos-ocr");

let binaryPromise: Promise<string | null> | null = null;
let unavailableLogged = false;

async function compileBinary(): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  if (!fs.existsSync(SWIFT_SOURCE)) return null;

  try {
    const binStat = fs.statSync(BIN_PATH, { throwIfNoEntry: false });
    const srcStat = fs.statSync(SWIFT_SOURCE);
    if (binStat && binStat.mtimeMs >= srcStat.mtimeMs) return BIN_PATH;

    fs.mkdirSync(BIN_DIR, { recursive: true });
    console.log("[ocr-native] compiling macos-ocr helper with swiftc...");
    await execFileAsync("swiftc", ["-O", SWIFT_SOURCE, "-o", BIN_PATH], {
      timeout: 120000,
    });
    console.log(`[ocr-native] compiled ${BIN_PATH}`);
    return BIN_PATH;
  } catch (err) {
    if (!unavailableLogged) {
      unavailableLogged = true;
      console.warn(
        "[ocr-native] Apple Vision OCR unavailable (swiftc missing or compile failed), falling back to tesseract:",
        err instanceof Error ? err.message : err
      );
    }
    return null;
  }
}

export function ensureMacOcrBinary(): Promise<string | null> {
  if (!binaryPromise) binaryPromise = compileBinary();
  return binaryPromise;
}

export async function runNativeOcr(imagePath: string): Promise<{
  text: string;
  confidence: number;
} | null> {
  const bin = await ensureMacOcrBinary();
  if (!bin) return null;

  try {
    const { stdout } = await execFileAsync(bin, [imagePath], {
      timeout: 15000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout) as { text: string; confidence: number };
    return {
      text: (parsed.text ?? "").trim(),
      // Vision confidence is 0-1; normalize to 0-100 like tesseract
      confidence: Math.round((parsed.confidence ?? 0) * 100),
    };
  } catch (err) {
    console.error("[ocr-native] recognition failed:", err);
    return null;
  }
}
