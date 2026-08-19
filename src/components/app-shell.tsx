import React, { useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { AppSidebar, useSidebarContext } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface AppShellProps {
  /** Nav content portalled into the resizable sidebar. */
  nav: React.ReactNode;
  /** Right-aligned header content — status pills, search, primary actions. */
  headerActions?: React.ReactNode;
  /** Extra content between the sidebar toggle and the wordmark (e.g. Back). */
  headerLeading?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * The window chrome shared by /home and /settings: a 48px draggable header,
 * the portalled sidebar, and the main content pane. Settings previously had no
 * header at all, which is the main reason it read as a separate app.
 */
export function AppShell({ nav, headerActions, headerLeading, children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { isTranslucent } = useSidebarContext();

  return (
    <TooltipProvider>
      <div className="flex h-screen min-h-0 min-w-0 flex-1 flex-col">
        <header
          className={cn(
            "drag-region flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4",
            isTranslucent
              ? "border-border/60 bg-background/80 backdrop-blur-md"
              : "border-border bg-background"
          )}
        >
          <div className="no-drag flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setSidebarOpen((o) => !o)}
                  aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
                >
                  {sidebarOpen ? (
                    <PanelLeftClose className="h-4 w-4" />
                  ) : (
                    <PanelLeftOpen className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Toggle sidebar</TooltipContent>
            </Tooltip>
            {headerLeading}
            <span className="text-sm font-semibold tracking-tight text-foreground">Chronicle</span>
          </div>

          {headerActions && (
            <div className="no-drag flex items-center gap-2">{headerActions}</div>
          )}
        </header>

        <div className="flex min-h-0 min-w-0 flex-1">
          {sidebarOpen && (
            <AppSidebar>
              <nav className="flex min-h-0 flex-1 flex-col gap-0.5">{nav}</nav>
            </AppSidebar>
          )}
          <main className="flex min-h-0 w-full min-w-0 flex-1 bg-background">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  );
}

/** A single sidebar nav row. Shared by the main nav and the settings nav. */
export function NavButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn("nav-item w-full", active && "nav-item-active")}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </button>
  );
}
