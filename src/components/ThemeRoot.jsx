import React from "react";
import { useTheme } from "../context/ThemeContext.jsx";

/**
 * Shared theme tokens (lifted 1:1 from the ThemeWagon Smart Home kit's
 * globals.css, default "purple" brand preset) - factored out of
 * BMSDashboard so any page in this app (AdminMonitor included) can use the
 * same --card/--border/--brand/etc CSS vars without redefining them.
 * Dark values swap in via ThemeContext - same token names, different oklch
 * lightness, so every component reading --card/--foreground/etc adapts with
 * zero changes.
 */
const LIGHT_TOKENS = {
  "--background": "oklch(0.97 0 0)",
  "--card": "oklch(1 0 0)",
  "--foreground": "oklch(0.145 0 0)",
  "--muted": "oklch(0.97 0 0)",
  "--muted-foreground": "oklch(0.556 0 0)",
  "--border": "oklch(0.922 0 0)",
  "--brand": "oklch(0.61 0.24 300)",
  "--brand-10": "color-mix(in oklab, oklch(0.61 0.24 300) 12%, transparent)",
  "--good": "oklch(0.63 0.17 149)",
  "--good-10": "color-mix(in oklab, oklch(0.63 0.17 149) 12%, transparent)",
  "--warning": "oklch(0.72 0.17 60)",
  "--warning-10": "color-mix(in oklab, oklch(0.72 0.17 60) 14%, transparent)",
  "--critical": "oklch(0.63 0.22 25)",
  "--critical-10": "color-mix(in oklab, oklch(0.63 0.22 25) 12%, transparent)",
  "--info": "oklch(0.62 0.15 235)",
  "--info-10": "color-mix(in oklab, oklch(0.62 0.15 235) 12%, transparent)",
};

const DARK_TOKENS = {
  "--background": "oklch(0.16 0 0)",
  "--card": "oklch(0.21 0 0)",
  "--foreground": "oklch(0.96 0 0)",
  "--muted": "oklch(0.26 0 0)",
  "--muted-foreground": "oklch(0.68 0 0)",
  "--border": "oklch(0.32 0 0)",
  "--brand": "oklch(0.71 0.22 300)",
  "--brand-10": "color-mix(in oklab, oklch(0.71 0.22 300) 28%, transparent)",
  "--good": "oklch(0.75 0.17 149)",
  "--good-10": "color-mix(in oklab, oklch(0.75 0.17 149) 28%, transparent)",
  "--warning": "oklch(0.8 0.17 60)",
  "--warning-10": "color-mix(in oklab, oklch(0.8 0.17 60) 30%, transparent)",
  "--critical": "oklch(0.74 0.2 25)",
  "--critical-10": "color-mix(in oklab, oklch(0.74 0.2 25) 28%, transparent)",
  "--info": "oklch(0.75 0.14 235)",
  "--info-10": "color-mix(in oklab, oklch(0.75 0.14 235) 28%, transparent)",
};

export function ThemeRoot({ children }) {
  const { theme } = useTheme();
  const tokens = theme === "dark" ? DARK_TOKENS : LIGHT_TOKENS;

  return (
    <div
      className={`bms-theme min-h-screen bg-[var(--background)] transition-colors duration-200 ${theme === "dark" ? "dark" : ""}`}
      style={{
        ...tokens,
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {children}
    </div>
  );
}
