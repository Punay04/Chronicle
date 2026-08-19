import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/lib/stores/settings-store";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

interface SidebarContextValue {
  isTranslucent: boolean;
}

const SidebarContext = createContext<SidebarContextValue>({ isTranslucent: false });

export function useSidebarContext() {
  return useContext(SidebarContext);
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const translucentSidebar = useSettingsStore((s) => s.settings.translucentSidebar);
  const isTranslucent = translucentSidebar !== false;

  useEffect(() => {
    if (isTranslucent) {
      document.documentElement.classList.add("macos-vibrancy");
      document.body.classList.add("macos-vibrancy");
      return () => {
        document.documentElement.classList.remove("macos-vibrancy");
        document.body.classList.remove("macos-vibrancy");
      };
    }
  }, [isTranslucent]);

  return (
    <SidebarContext.Provider value={{ isTranslucent }}>{children}</SidebarContext.Provider>
  );
}

const DEFAULT_WIDTH = 220;
const MIN_WIDTH = 180;
const MAX_WIDTH = 320;

interface SidebarSlot {
  className?: string;
}

interface SidebarShellContextValue {
  container: HTMLDivElement | null;
  setSlot: (slot: SidebarSlot | null) => void;
}

const SidebarShellContext = createContext<SidebarShellContextValue | null>(null);

export function AppSidebarLayout({ children }: { children: React.ReactNode }) {
  const { isTranslucent } = useSidebarContext();
  const [width, setWidth] = useState(() => {
    const stored = localStorage.getItem("chronicle-sidebar-width");
    return stored ? Number(stored) : DEFAULT_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [slot, setSlotState] = useState<SidebarSlot | null>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  useEffect(() => setHydrated(true), []);

  const setSlot = useCallback((next: SidebarSlot | null) => {
    setSlotState((prev) => {
      if (prev?.className === next?.className && prev !== null && next !== null) {
        return prev;
      }
      if (prev === next) return prev;
      return next;
    });
  }, []);

  const shellValue = useMemo(
    () => ({ container, setSlot }),
    [container, setSlot]
  );

  const beginResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = width;

    const onMove = (ev: PointerEvent) => {
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + ev.clientX - startX));
      setWidth(next);
    };
    const onUp = () => {
      setIsResizing(false);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      const stored = localStorage.getItem("chronicle-sidebar-width");
      const finalWidth = stored ? Number(stored) : width;
      localStorage.setItem("chronicle-sidebar-width", String(finalWidth));
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }, [width]);

  useEffect(() => {
    localStorage.setItem("chronicle-sidebar-width", String(width));
  }, [width]);

  return (
    <SidebarShellContext.Provider value={shellValue}>
      <div
        className={cn(
          "flex h-screen min-h-0 overflow-hidden",
          isTranslucent ? "bg-transparent" : "bg-background"
        )}
      >
        {slot && (
          <div
            style={{ width }}
            className={cn(
              "relative flex flex-col min-h-0 flex-shrink-0 border-r",
              isResizing || !hydrated ? "" : "transition-[width] duration-300",
              isTranslucent ? "vibrant-sidebar" : "bg-sidebar border-sidebar-border",
              slot.className
            )}
          >
            <div
              ref={setContainer}
              className="flex flex-col min-h-0 flex-1 overflow-x-hidden overflow-y-auto scrollbar-hide px-2 py-3"
            />
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              onPointerDown={beginResize}
              className="absolute top-0 right-0 h-full w-1.5 -mr-[3px] z-20 cursor-col-resize group/resize"
            >
              <div
                className={cn(
                  "absolute inset-y-0 right-[3px] w-px transition-colors",
                  isResizing
                    ? "bg-foreground/25"
                    : "bg-transparent group-hover/resize:bg-foreground/10"
                )}
              />
            </div>
          </div>
        )}
        {children}
      </div>
    </SidebarShellContext.Provider>
  );
}

export function AppSidebar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const shell = useContext(SidebarShellContext);
  const setSlot = shell?.setSlot;

  useIsomorphicLayoutEffect(() => {
    if (!setSlot) return;
    setSlot({ className });
    return () => setSlot(null);
  }, [setSlot, className]);

  if (!shell?.container) return null;
  return createPortal(children, shell.container);
}
