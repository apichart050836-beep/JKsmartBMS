import React, { useEffect, useState } from "react";
import { Cpu, RefreshCw } from "lucide-react";

/**
 * "Check for update" popup opened from the version badge next to the
 * Dashboard pill. There's no remote release manifest this app can compare
 * against, so this shows the live-reported ESP32 (software) and BMS
 * (hardware) version fields honestly - a real read of what's currently
 * running, not a fabricated "update available" claim. Pressing Update
 * reuses the same firmware-update loading animation (FirmwareUpdateToast)
 * already built for the auto-detected version-change case.
 */
export function VersionCheckModal({
  open,
  onClose,
  deviceLabel,
  softwareVersion,
  hardwareVersion,
  onUpdate,
  pendingRelease,
}) {
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!open) return;
    setChecking(true);
    const t = setTimeout(() => setChecking(false), 900);
    return () => clearTimeout(t);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-sm animate-[weather-modal-in_0.3s_ease] rounded-3xl bg-[var(--card)] p-6 text-center shadow-2xl ring-1 ring-[var(--border)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-[var(--brand-10)]">
          <Cpu className={`size-7 text-[var(--brand)] ${checking ? "animate-pulse" : ""}`} />
        </div>
        <h3 className="text-lg font-bold text-[var(--foreground)]">ตรวจสอบอัพเดทเฟิร์มแวร์ ESP32</h3>
        {deviceLabel && <p className="mt-1 text-xs text-[var(--muted-foreground)]">{deviceLabel}</p>}

        {checking ? (
          <div className="mt-6 flex flex-col items-center gap-3 py-4">
            <div className="size-6 animate-spin rounded-full border-2 border-[var(--brand)] border-t-transparent" />
            <p className="text-xs text-[var(--muted-foreground)]">กำลังตรวจสอบเวอร์ชันปัจจุบัน...</p>
          </div>
        ) : (
          <>
            <div className="mt-5 grid grid-cols-2 gap-2 rounded-xl bg-[var(--muted)] p-3 text-left text-xs">
              <div>
                <p className="text-[var(--muted-foreground)]">ESP32 Software</p>
                <p className="mt-0.5 font-bold tabular-nums text-[var(--foreground)]">
                  {softwareVersion ? `v${softwareVersion}` : "-"}
                </p>
              </div>
              <div>
                <p className="text-[var(--muted-foreground)]">BMS Version</p>
                <p className="mt-0.5 font-bold tabular-nums text-[var(--foreground)]">{hardwareVersion ?? "-"}</p>
              </div>
            </div>

            {pendingRelease && (
              <div className="mt-3 rounded-xl bg-[var(--brand-10)] p-3 text-left text-xs">
                <p className="font-bold text-[var(--brand)]">🆕 มีเวอร์ชันใหม่: v{pendingRelease.version}</p>
                <p className="mt-0.5 text-[var(--muted-foreground)]">{pendingRelease.filename}</p>
              </div>
            )}

            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                onClick={onUpdate}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[var(--brand)] py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              >
                <RefreshCw className="size-3.5" />
                อัพเดทเฟิร์มแวร์
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl py-2.5 text-sm font-semibold text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)]"
              >
                ปิด
              </button>
            </div>
          </>
        )}
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
