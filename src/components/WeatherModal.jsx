import React from "react";
import { weatherIcon } from "../lib/weatherService.js";

export function WeatherModal({ open, onClose, weather, loading, error, location, onRetry }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-sm animate-[weather-modal-in_0.3s_ease] overflow-hidden rounded-3xl bg-[var(--card)] shadow-2xl ring-1 ring-[var(--border)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h3 className="text-sm font-bold text-[var(--foreground)]">☀️ สภาพอากาศปัจจุบัน</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            ✕
          </button>
        </div>

        <div className="p-5">
          {loading && (
            <div className="flex flex-col items-center gap-3 py-10">
              <div className="size-8 animate-spin rounded-full border-2 border-[var(--brand)] border-t-transparent" />
              <p className="text-xs text-[var(--muted-foreground)]">กำลังโหลดข้อมูลสภาพอากาศ...</p>
            </div>
          )}

          {!loading && error && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <span className="text-3xl">⚠️</span>
              <p className="text-sm text-[var(--critical)]">{error}</p>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="rounded-lg bg-[var(--brand)] px-4 py-2 text-xs font-semibold text-white hover:opacity-90"
                >
                  ลองอีกครั้ง
                </button>
              )}
            </div>
          )}

          {!loading && !error && weather && (
            <>
              <p className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                📍 {weather.locationName}
                {weather.country ? `, ${weather.country}` : ""}
              </p>

              <div className="my-4 flex items-center justify-center gap-4">
                <span className="text-5xl leading-none">{weatherIcon(weather.condition)}</span>
                <div>
                  <div className="text-3xl font-extrabold tabular-nums text-[var(--foreground)]">
                    🌡️ {Math.round(weather.temperature)}°C
                  </div>
                  <div className="text-xs text-[var(--muted-foreground)]">{weather.description}</div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 rounded-xl bg-[var(--muted)] p-3 text-center text-xs">
                <div>
                  <div className="text-[var(--muted-foreground)]">🌧️ ฝน</div>
                  <div className="font-bold tabular-nums text-[var(--foreground)]">{weather.rainMm} mm</div>
                </div>
                <div>
                  <div className="text-[var(--muted-foreground)]">ความชื้น</div>
                  <div className="font-bold tabular-nums text-[var(--foreground)]">{weather.humidity}%</div>
                </div>
                <div>
                  <div className="text-[var(--muted-foreground)]">ลม</div>
                  <div className="font-bold tabular-nums text-[var(--foreground)]">{weather.windSpeed} m/s</div>
                </div>
              </div>

              {location?.accuracy != null && (
                <p className="mt-3 text-center text-[10px] text-[var(--muted-foreground)]">
                  ความแม่นยำ ±{Math.round(location.accuracy)} เมตร
                </p>
              )}
              <p className="mt-1 text-center text-[10px] text-[var(--muted-foreground)]">
                อัปเดตล่าสุด {new Date(weather.updatedAt).toLocaleTimeString("th-TH")}
              </p>
            </>
          )}
        </div>
      </div>
      <style>{`
        @keyframes weather-modal-in {
          0% { opacity: 0; transform: scale(0.95) translateY(8px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}
