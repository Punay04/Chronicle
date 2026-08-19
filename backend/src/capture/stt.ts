import { GEMINI_API_KEY } from "../config.js";
import { transcribeAudio } from "../llm/gemini.js";

export function sttStatus(): string {
  return GEMINI_API_KEY ? "gemini" : "gemini (not configured)";
}

export async function transcribeChunk(filePath: string): Promise<string> {
  if (!GEMINI_API_KEY) return "";
  return transcribeAudio(filePath);
}
