import { contextBridge, ipcRenderer } from "electron";
import type { ModelProvider, RuntimeStatus } from "./runtime-types.js";

export type WindowKind = "setup" | "home" | "settings" | "onboarding" | "search" | "chat";

const electronAPI = {
  openWindow: (kind: WindowKind) => ipcRenderer.invoke("window:open", kind),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  setWindowSize: (width: number, height: number) =>
    ipcRenderer.invoke("window:set-size", width, height),
  openExternal: (url: string) => ipcRenderer.invoke("shell:open-external", url),
  getPlatform: () => ipcRenderer.invoke("app:get-platform") as Promise<NodeJS.Platform>,
  getVersion: () => ipcRenderer.invoke("app:get-version") as Promise<string>,
  quit: () => ipcRenderer.invoke("app:quit"),
  restart: () => ipcRenderer.invoke("app:restart"),
  getLoginItemSettings: () =>
    ipcRenderer.invoke("app:get-login-item-settings") as Promise<{
      openAtLogin: boolean;
      openAsHidden?: boolean;
    }>,
  setLoginItemSettings: (openAtLogin: boolean) =>
    ipcRenderer.invoke("app:set-login-item-settings", openAtLogin) as Promise<{
      openAtLogin: boolean;
      openAsHidden?: boolean;
    }>,
  openPath: (targetPath: string) =>
    ipcRenderer.invoke("app:open-path", targetPath) as Promise<string>,
  getApiUrl: () => ipcRenderer.invoke("api:get-url") as Promise<string>,
  apiRequest: (method: string, path: string, body?: unknown) =>
    ipcRenderer.invoke("api:request", method, path, body) as Promise<unknown>,
  engine: {
    start: () => ipcRenderer.invoke("engine:start"),
    stop: () => ipcRenderer.invoke("engine:stop"),
    pause: () => ipcRenderer.invoke("engine:pause"),
    resume: () => ipcRenderer.invoke("engine:resume"),
    status: () => ipcRenderer.invoke("engine:status"),
    health: () => ipcRenderer.invoke("engine:health"),
  },
  runtime: {
    getStatus: () => ipcRenderer.invoke("runtime:get-status") as Promise<RuntimeStatus>,
    retry: () => ipcRenderer.invoke("runtime:retry") as Promise<RuntimeStatus>,
    openLogs: () => ipcRenderer.invoke("runtime:open-logs") as Promise<void>,
    configureProvider: (provider: ModelProvider, apiKey: string) =>
      ipcRenderer.invoke("runtime:configure-provider", provider, apiKey) as Promise<void>,
    getProviderInfo: () =>
      ipcRenderer.invoke("runtime:get-provider-info") as Promise<{
        provider: ModelProvider | null;
        configured: boolean;
      }>,
    onStatusChanged: (callback: (status: RuntimeStatus) => void) => {
      const handler = (_: unknown, status: RuntimeStatus) => callback(status);
      ipcRenderer.on("runtime:status-changed", handler);
      return () => ipcRenderer.removeListener("runtime:status-changed", handler);
    },
  },
  onboarding: {
    getComplete: () => ipcRenderer.invoke("onboarding:get-complete") as Promise<boolean>,
    complete: () => ipcRenderer.invoke("onboarding:complete") as Promise<void>,
  },
  permissions: {
    get: () => ipcRenderer.invoke("permissions:get"),
    request: (permission: "screen" | "microphone" | "accessibility") =>
      ipcRenderer.invoke("permissions:request", permission) as Promise<boolean>,
  },
  onThemeChanged: (callback: (theme: string) => void) => {
    const handler = (_: unknown, theme: string) => callback(theme);
    ipcRenderer.on("theme-changed", handler);
    return () => ipcRenderer.removeListener("theme-changed", handler);
  },
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

export type ElectronAPI = typeof electronAPI;
