import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatShortcut(keys: string): string {
  const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
  return keys
    .replace(/Cmd|Meta/gi, isMac ? "⌘" : "Ctrl")
    .replace(/Alt/gi, isMac ? "⌥" : "Alt")
    .replace(/Shift/gi, "⇧");
}
