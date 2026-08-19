import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface ActiveWindow {
  app: string;
  title: string;
  browserUrl: string | null;
}

const WIN_PS = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class ChronicleWin32 {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Auto)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$hwnd = [ChronicleWin32]::GetForegroundWindow()
$pid = [uint32]0
[void][ChronicleWin32]::GetWindowThreadProcessId($hwnd, [ref]$pid)
$title = New-Object System.Text.StringBuilder 512
[void][ChronicleWin32]::GetWindowText($hwnd, $title, 512)
$proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
@{ app = if ($proc) { $proc.ProcessName } else { "unknown" }; title = $title.ToString() } | ConvertTo-Json -Compress
`.trim();

export async function getActiveWindow(): Promise<ActiveWindow | null> {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("powershell", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        WIN_PS,
      ]);
      const parsed = JSON.parse(stdout.trim()) as { app: string; title: string };
      return {
        app: parsed.app || "unknown",
        title: parsed.title || "",
        browserUrl: extractBrowserUrl(parsed.title),
      };
    }

    if (process.platform === "darwin") {
      const { stdout } = await execFileAsync("osascript", [
        "-e",
        'tell application "System Events" to get name of first application process whose frontmost is true',
      ]);
      const app = stdout.trim();
      const { stdout: titleOut } = await execFileAsync("osascript", [
        "-e",
        `tell application "System Events" to tell process "${app}" to get name of front window`,
      ]).catch(() => ({ stdout: "" }));
      return {
        app,
        title: titleOut.trim(),
        browserUrl: extractBrowserUrl(titleOut.trim()),
      };
    }

    return null;
  } catch {
    return null;
  }
}

function extractBrowserUrl(title: string): string | null {
  const chromeMatch = title.match(/ - (.+?) - Google Chrome$/);
  if (chromeMatch) return chromeMatch[1];
  const edgeMatch = title.match(/ - (.+?) - Microsoft[\u200b]? Edge$/);
  if (edgeMatch) return edgeMatch[1];
  const firefoxMatch = title.match(/ — Mozilla Firefox$/);
  if (firefoxMatch) {
    const parts = title.split(" — ");
    return parts.length > 1 ? parts[parts.length - 2] : null;
  }
  if (title.includes("http://") || title.includes("https://")) {
    const urlMatch = title.match(/https?:\/\/[^\s]+/);
    return urlMatch?.[0] ?? null;
  }
  return null;
}
