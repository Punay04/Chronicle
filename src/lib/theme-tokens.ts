import { useEffect, useState } from "react";

/**
 * Resolve a design-system CSS custom property (which holds a bare "H S% L%"
 * triplet) into a concrete color string.
 *
 * Canvas 2D cannot consume `hsl(var(--token))` the way CSS and SVG can, so
 * anything painting to a canvas has to resolve tokens itself — and re-resolve
 * them when the theme changes. Pair this with `useThemeVersion()`.
 */
export function cssColor(name: string, alpha = 1): string {
  if (typeof document === "undefined") return "transparent";
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return "transparent";
  return alpha >= 1 ? `hsl(${raw})` : `hsl(${raw} / ${alpha})`;
}

/**
 * Increments whenever the theme class on <html> changes. Use it as a dependency
 * so memoized palettes recompute on a light/dark switch.
 */
export function useThemeVersion(): number {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const observer = new MutationObserver(() => setVersion((v) => v + 1));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return version;
}
