import sharp from "sharp";
import { createWorker, type Worker } from "tesseract.js";
import { OCR_ENABLED, OCR_ENGINE } from "../config.js";
import { runNativeOcr } from "./ocr-native.js";

let worker: Worker | null = null;
let workerReady = false;

async function ensureWorker(): Promise<Worker | null> {
  if (worker && workerReady) return worker;

  try {
    worker = await createWorker("eng");
    workerReady = true;
    return worker;
  } catch (err) {
    console.error("[ocr] failed to init tesseract:", err);
    return null;
  }
}

async function runTesseract(imageBuffer: Buffer): Promise<{
  text: string;
  confidence: number;
}> {
  const ocrWorker = await ensureWorker();
  if (!ocrWorker) return { text: "", confidence: 0 };

  try {
    // Downscale before recognition — big speedup at minor accuracy cost
    const resized = await sharp(imageBuffer)
      .resize({ width: 1600, withoutEnlargement: true })
      .toBuffer();
    const result = await ocrWorker.recognize(resized);
    return {
      text: result.data.text.trim(),
      confidence: result.data.confidence,
    };
  } catch (err) {
    console.error("[ocr] recognition failed:", err);
    return { text: "", confidence: 0 };
  }
}

/**
 * Extract on-screen text from a captured frame.
 * darwin: Apple Vision (native helper), falling back to Tesseract.
 * elsewhere: Tesseract.
 */
export async function extractText(
  imagePath: string,
  imageBuffer: Buffer
): Promise<{ text: string; confidence: number }> {
  if (!OCR_ENABLED || OCR_ENGINE === "off") {
    return { text: "", confidence: 0 };
  }

  if (process.platform === "darwin" && OCR_ENGINE !== "tesseract") {
    const native = await runNativeOcr(imagePath);
    if (native) return native;
  }

  return runTesseract(imageBuffer);
}

export async function terminateOcr(): Promise<void> {
  if (worker) {
    await worker.terminate();
    worker = null;
    workerReady = false;
  }
}
