import React from "react";

// Glassmorphism button - frosted translucent surface, soft shadow, scales
// up on hover, works over both light and dark app backgrounds since it
// doesn't depend on --card (a solid surface would look flat here).
export function WeatherButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-xl border border-white/25 bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-[var(--foreground)] shadow-lg backdrop-blur-md transition-all duration-200 hover:scale-105 hover:bg-white/20 hover:shadow-xl active:scale-95"
    >
      <span className="text-sm leading-none">☀️</span>
      <span>สภาพอากาศ</span>
    </button>
  );
}
