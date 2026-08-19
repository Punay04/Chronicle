import React from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "@/components/theme-provider";
import { SidebarProvider, AppSidebarLayout } from "@/components/app-sidebar";
import { HomePage } from "@/pages/HomePage";
import { SettingsPage } from "@/pages/SettingsPage";
import { OnboardingPage } from "@/pages/OnboardingPage";
import { SearchPage } from "@/pages/SearchPage";
import { ChatPage } from "@/pages/ChatPage";
import { SetupPage } from "@/pages/SetupPage";
import { useOnboardingStore } from "@/lib/stores/onboarding-store";
import { Toaster } from "sonner";
import { useGlobalShortcuts } from "@/lib/hooks/use-global-shortcuts";
import { useSettingsStore } from "@/lib/stores/settings-store";

function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebarLayout>{children}</AppSidebarLayout>
    </SidebarProvider>
  );
}

function AppRoutes() {
  const isCompleted = useOnboardingStore((s) => s.isCompleted);

  return (
    <Routes>
      <Route path="/" element={<Navigate to={isCompleted ? "/home" : "/onboarding"} replace />} />
      <Route
        path="/home"
        element={
          <MainLayout>
            <HomePage />
          </MainLayout>
        }
      />
      <Route
        path="/settings"
        element={
          <MainLayout>
            <SettingsPage />
          </MainLayout>
        }
      />
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/search" element={<SearchPage />} />
      <Route path="/chat" element={<ChatPage />} />
      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  );
}

export default function App() {
  useGlobalShortcuts();
  const theme = useSettingsStore((s) => s.settings.theme);
  return (
    <ThemeProvider>
      <HashRouter>
        <AppRoutes />
      </HashRouter>
      <Toaster position="bottom-right" theme={theme === "dark" ? "dark" : "light"} />
    </ThemeProvider>
  );
}
