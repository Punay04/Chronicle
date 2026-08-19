import screenshot from "screenshot-desktop";
import sharp from "sharp";
import type { MonitorInfo } from "../types.js";

export async function listMonitors(): Promise<MonitorInfo[]> {
  try {
    const displays = await screenshot.listDisplays();
    return displays.map((display, index) => ({
      id: display.id,
      name: display.name || `display ${index + 1}`,
      width: (display as { width?: number }).width ?? 1920,
      height: (display as { height?: number }).height ?? 1080,
      active: true,
    }));
  } catch {
    return [{ id: 0, name: "display 1", width: 1920, height: 1080, active: true }];
  }
}

export async function captureMonitor(monitorId: number | string): Promise<Buffer> {
  const raw = await screenshot({ screen: monitorId, format: "png" });
  const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  return sharp(buffer).jpeg({ quality: 75 }).toBuffer();
}

export async function captureAllMonitors(): Promise<
  Array<{ monitorId: number | string; buffer: Buffer }>
> {
  const monitors = await listMonitors();
  const results: Array<{ monitorId: number | string; buffer: Buffer }> = [];

  for (const monitor of monitors) {
    try {
      const buffer = await captureMonitor(monitor.id);
      results.push({ monitorId: monitor.id, buffer });
    } catch (err) {
      console.error(`[capture] monitor ${monitor.id} failed:`, err);
    }
  }

  return results;
}
