import React from "react";

export function LocationMovedToast({ open, onUpdate, onDismiss }) {
  if (!open) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-[var(--card)] px-4 py-3 shadow-2xl ring-1 ring-[var(--border)] animate-[weather-toast-in_0.4s_cubic-bezier(0.34,1.56,0.64,1)]">
        <span className="text-xl">📍</span>
        <p className="text-xs font-medium text-[var(--foreground)]">ตรวจพบว่าคุณอยู่คนละพื้นที่ ต้องการอัปเดตสภาพอากาศหรือไม่?</p>
        <button
          type="button"
          onClick={onUpdate}
          className="shrink-0 rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
        >
          Update Location
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          ✕
        </button>
      </div>
      <style>{`
        @keyframes weather-toast-in {
          0% { opacity: 0; transform: translateY(-16px) scale(0.95); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
