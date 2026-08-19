import React, { createContext, useContext, useEffect } from "react";
import { useSettingsStore, applyTheme, type ThemeMode } from "@/lib/stores/settings-store";

interface ThemeContextValue {
  isDark: boolean;
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSettingsStore((s) => s.settings.theme);
  const fontSize = useSettingsStore((s) => s.settings.fontSize);
  const setSetting = useSettingsStore((s) => s.setSetting);

  useEffect(() => {
    applyTheme();
  }, [theme, fontSize]);

  return (
    <ThemeContext.Provider
      value={{
        isDark: theme === "dark",
        theme,
        setTheme: (next) => setSetting("theme", next),
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
