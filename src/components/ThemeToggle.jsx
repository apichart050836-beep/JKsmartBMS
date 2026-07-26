import React from "react";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "../context/ThemeContext.jsx";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="group inline-flex size-8.5 cursor-pointer items-center justify-center rounded-xl bg-[var(--muted)] text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-all duration-150 hover:text-[var(--foreground)] active:scale-95"
    >
      {isDark ? (
        <Sun className="size-4 transition-transform duration-300 group-hover:rotate-45" />
      ) : (
        <Moon className="size-4 transition-transform duration-300 group-hover:-rotate-12" />
      )}
    </button>
  );
}
