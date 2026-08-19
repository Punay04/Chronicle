import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "dark" | "light";

export interface AppSettings {
  translucentSidebar: boolean;
  disableTimeline: boolean;
  fontSize: number;
  launchAtStartup: boolean;
  theme: ThemeMode;
}

interface SettingsState {
  settings: AppSettings;
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: {
        translucentSidebar: true,
        disableTimeline: false,
        fontSize: 16,
        launchAtStartup: false,
        theme: "dark",
      },
      setSetting: (key, value) =>
        set((state) => ({
          settings: { ...state.settings, [key]: value },
        })),
    }),
    { name: "chronicle-settings" }
  )
);

export function applyTheme() {
  const { theme, fontSize } = useSettingsStore.getState().settings;
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.setProperty("--font-size-base", `${fontSize}px`);
}
