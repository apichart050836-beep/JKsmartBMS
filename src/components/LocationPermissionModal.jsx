import React from "react";

export function LocationPermissionModal({ open, onAllow, onDismiss, loading }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm animate-[weather-modal-in_0.3s_ease] rounded-3xl bg-[var(--card)] p-6 text-center shadow-2xl ring-1 ring-[var(--border)]">
        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-[var(--brand-10)] text-3xl">📍</div>
        <h3 className="text-lg font-bold text-[var(--foreground)]">เปิดใช้งานตำแหน่งของคุณ</h3>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">เปิด Location เพื่อแสดงสภาพอากาศตามตำแหน่งจริงของคุณ</p>
        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={onAllow}
            disabled={loading}
            className="rounded-xl bg-[var(--brand)] py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "กำลังขอตำแหน่ง..." : "Allow Location"}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-xl py-2.5 text-sm font-semibold text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)]"
          >
            Not Now
          </button>
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
