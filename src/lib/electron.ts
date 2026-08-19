import type { ModelProvider, RuntimeStatus } from "@/lib/runtime";

export interface PermissionStatus {
  platform: NodeJS.Platform;
  screen: string;
  microphone: string;
  accessibility: string;
}

export interface ElectronAPI {
  openWindow: (kind: "setup" | "home" | "settings" | "onboarding" | "search" | "chat") => Promise<void>;
  closeWindow: () => Promise<void>;
  setWindowSize: (width: number, height: number) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  getPlatform: () => Promise<NodeJS.Platform>;
  getVersion: () => Promise<string>;
  quit: () => Promise<void>;
  restart: () => Promise<void>;
  getLoginItemSettings: () => Promise<{ openAtLogin: boolean; openAsHidden?: boolean }>;
  setLoginItemSettings: (openAtLogin: boolean) => Promise<{ openAtLogin: boolean; openAsHidden?: boolean }>;
  openPath: (targetPath: string) => Promise<string>;
  getApiUrl: () => Promise<string>;
  apiRequest: (method: string, path: string, body?: unknown) => Promise<unknown>;
  engine: {
    start: () => Promise<unknown>;
    stop: () => Promise<unknown>;
    pause: () => Promise<unknown>;
    resume: () => Promise<unknown>;
    status: () => Promise<unknown>;
    health: () => Promise<unknown>;
  };
  runtime: {
    getStatus: () => Promise<RuntimeStatus>;
    retry: () => Promise<RuntimeStatus>;
    openLogs: () => Promise<void>;
    configureProvider: (provider: ModelProvider, apiKey: string) => Promise<void>;
    getProviderInfo: () => Promise<{ provider: ModelProvider | null; configured: boolean }>;
    onStatusChanged: (callback: (status: RuntimeStatus) => void) => () => void;
  };
  onboarding: {
    getComplete: () => Promise<boolean>;
    complete: () => Promise<void>;
  };
  permissions: {
    get: () => Promise<PermissionStatus>;
    request: (permission: "screen" | "microphone" | "accessibility") => Promise<boolean>;
  };
  onThemeChanged: (callback: (theme: string) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export const electron = window.electronAPI;
