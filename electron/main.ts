import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  shell,
  systemPreferences,
} from "electron";
import Store from "electron-store";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getApiUrl, proxyApi } from "./backend-manager.js";
import { RuntimeManager } from "./runtime-manager.js";
import type { ModelProvider } from "./runtime-types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

type WindowKind =
  | "setup"
  | "home"
  | "settings"
  | "onboarding"
  | "search"
  | "chat";

interface WindowConfig {
  width: number;
  height: number;
  transparent?: boolean;
  frame?: boolean;
  resizable?: boolean;
  route: string;
}

const WINDOW_CONFIGS: Record<WindowKind, WindowConfig> = {
  setup: { width: 520, height: 520, resizable: false, route: "/setup" },
  home: { width: 1280, height: 800, route: "/home" },
  settings: { width: 1100, height: 760, route: "/settings" },
  onboarding: { width: 500, height: 560, route: "/onboarding" },
  search: {
    width: 720,
    height: 520,
    transparent: true,
    frame: false,
    route: "/search",
  },
  chat: { width: 900, height: 700, route: "/chat" },
};

const preferences = new Store<{ onboardingComplete: boolean }>({
  name: "preferences",
  defaults: { onboardingComplete: false },
});
const runtime = new RuntimeManager();
const windows = new Map<WindowKind, BrowserWindow>();
let quitting = false;
let servicesStopped = false;

function getPreloadPath() {
  return path.join(__dirname, "preload.mjs");
}

function createWindow(kind: WindowKind): BrowserWindow {
  const config = WINDOW_CONFIGS[kind];
  const win = new BrowserWindow({
    width: config.width,
    height: config.height,
    minWidth: kind === "setup" || kind === "onboarding" ? 500 : 800,
    minHeight: kind === "setup" || kind === "onboarding" ? 480 : 600,
    show: false,
    frame: config.frame !== false,
    transparent: config.transparent ?? false,
    resizable: config.resizable !== false,
    backgroundColor: config.transparent ? "#00000000" : "#1a1717",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const url = isDev
    ? `http://localhost:1420/#${config.route}`
    : `file://${path.join(__dirname, "../dist/index.html")}#${config.route}`;
  void win.loadURL(url);
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => windows.delete(kind));
  windows.set(kind, win);
  return win;
}

function getOrCreateWindow(kind: WindowKind): BrowserWindow {
  const existing = windows.get(kind);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return existing;
  }
  return createWindow(kind);
}

function showApplicationWindow() {
  const setup = windows.get("setup");
  if (setup && !setup.isDestroyed()) setup.close();
  getOrCreateWindow(
    preferences.get("onboardingComplete") ? "home" : "onboarding"
  );
}

function getPermissionStatus() {
  return {
    platform: process.platform,
    screen:
      process.platform === "darwin"
        ? systemPreferences.getMediaAccessStatus("screen")
        : "granted",
    microphone:
      process.platform === "darwin"
        ? systemPreferences.getMediaAccessStatus("microphone")
        : "granted",
    accessibility:
      process.platform === "darwin"
        ? systemPreferences.isTrustedAccessibilityClient(false)
          ? "granted"
          : "denied"
        : "granted",
  };
}

function capturePermissionsGranted() {
  const permissions = getPermissionStatus();
  return permissions.screen === "granted" && permissions.microphone === "granted";
}

function openPermissionSettings(permission: "screen" | "microphone" | "accessibility") {
  const pane = {
    screen: "Privacy_ScreenCapture",
    microphone: "Privacy_Microphone",
    accessibility: "Privacy_Accessibility",
  }[permission];
  return shell.openExternal(
    `x-apple.systempreferences:com.apple.preference.security?${pane}`,
  );
}

const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const target = windows.get("home") ?? windows.get("onboarding") ?? windows.get("setup");
    if (target?.isMinimized()) target.restore();
    target?.show();
    target?.focus();
  });
}

runtime.subscribe((status) => {
  for (const win of windows.values()) {
    if (!win.isDestroyed()) win.webContents.send("runtime:status-changed", status);
  }
});

app.whenReady().then(async () => {
  getOrCreateWindow("setup");
  try {
    await runtime.start();
    if (preferences.get("onboardingComplete") && capturePermissionsGranted()) {
      await proxyApi("POST", "/engine/start").catch((error) =>
        console.error("[main] capture engine could not auto-start:", error),
      );
    }
    showApplicationWindow();
  } catch (error) {
    console.error("[main] local runtime failed:", error);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (runtime.getStatus().phase === "ready") showApplicationWindow();
      else getOrCreateWindow("setup");
    }
  });
});

app.on("before-quit", (event) => {
  if (servicesStopped) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  void runtime.stop().finally(() => {
    servicesStopped = true;
    app.quit();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("window:open", (_event, kind: WindowKind) => getOrCreateWindow(kind));
ipcMain.handle("window:close", (event) => BrowserWindow.fromWebContents(event.sender)?.close());
ipcMain.handle("window:set-size", (event, width: number, height: number) =>
  BrowserWindow.fromWebContents(event.sender)?.setSize(width, height)
);
ipcMain.handle("shell:open-external", (_event, url: string) => shell.openExternal(url));
ipcMain.handle("app:get-platform", () => process.platform);
ipcMain.handle("app:get-version", () => app.getVersion());
ipcMain.handle("app:quit", () => app.quit());
ipcMain.handle("app:restart", () => {
  app.relaunch();
  app.quit();
});
ipcMain.handle("app:get-login-item-settings", () => app.getLoginItemSettings());
ipcMain.handle("app:set-login-item-settings", (_event, openAtLogin: boolean) => {
  app.setLoginItemSettings({
    openAtLogin,
    openAsHidden: true,
    args: openAtLogin ? ["--hidden"] : [],
  });
  return app.getLoginItemSettings();
});
ipcMain.handle("app:open-path", (_event, targetPath: string) =>
  shell.openPath(targetPath)
);
ipcMain.handle("runtime:get-provider-info", () => runtime.getProviderInfo());

ipcMain.handle("runtime:get-status", () => runtime.getStatus());
ipcMain.handle("runtime:retry", async () => {
  await runtime.retry();
  showApplicationWindow();
  return runtime.getStatus();
});
ipcMain.handle("runtime:open-logs", () => runtime.openLogs());
ipcMain.handle(
  "runtime:configure-provider",
  (_event, provider: ModelProvider, apiKey: string) =>
    runtime.configureProvider(provider, apiKey)
);

ipcMain.handle("onboarding:get-complete", () =>
  preferences.get("onboardingComplete")
);
ipcMain.handle("onboarding:complete", () => {
  preferences.set("onboardingComplete", true);
});

ipcMain.handle("permissions:get", () => getPermissionStatus());
ipcMain.handle("permissions:request", async (_event, permission: string) => {
  if (process.platform !== "darwin") return true;
  if (permission === "microphone") {
    const status = systemPreferences.getMediaAccessStatus("microphone");
    if (status === "granted") return true;
    if (status !== "not-determined") {
      await openPermissionSettings("microphone");
      return false;
    }
    return systemPreferences.askForMediaAccess("microphone");
  }
  if (permission === "accessibility") {
    if (systemPreferences.isTrustedAccessibilityClient(false)) return true;
    return systemPreferences.isTrustedAccessibilityClient(true);
  }
  if (permission === "screen") {
    const status = systemPreferences.getMediaAccessStatus("screen");
    if (status === "granted") return true;
    if (status !== "not-determined") {
      await openPermissionSettings("screen");
      return false;
    }
    try {
      await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 1, height: 1 },
      });
    } catch (error) {
      console.warn("Unable to request screen capture permission:", error);
      return false;
    }
    return systemPreferences.getMediaAccessStatus("screen") === "granted";
  }
  return false;
});

ipcMain.handle("api:get-url", () => getApiUrl());
ipcMain.handle(
  "api:request",
  async (_event, method: string, requestPath: string, body?: unknown) =>
    proxyApi(method, requestPath, body)
);
ipcMain.handle("engine:start", async () => proxyApi("POST", "/engine/start"));
ipcMain.handle("engine:stop", async () => proxyApi("POST", "/engine/stop"));
ipcMain.handle("engine:pause", async () => proxyApi("POST", "/engine/pause"));
ipcMain.handle("engine:resume", async () => proxyApi("POST", "/engine/resume"));
ipcMain.handle("engine:status", async () => proxyApi("GET", "/engine/status"));
ipcMain.handle("engine:health", async () => proxyApi("GET", "/health"));
