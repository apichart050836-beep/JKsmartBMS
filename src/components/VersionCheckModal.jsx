import React, { useEffect, useState } from "react";
import { Cpu, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";

/**
 * "Check for update" popup - auto-opened by BMSDashboard.jsx on login/
 * refresh whenever this device's Firebase firmware node reports a version
 * the browser hasn't acknowledged yet (see the bms-fw-ack-* localStorage
 * key there), per explicit request. Shows the live-reported ESP32
 * (software) and BMS (hardware) version fields honestly - a real read of
 * what's currently running - plus whatever the admin has published.
 * Positioned near the top of the screen (not vertically centered) so it
 * reads as an immediate notice rather than a dialog the user had to open.
 *
 * `deviceFirmware` is this specific device's own Firebase firmware node
 * ({latest_version, url, release_notes, update_flag}), written by the admin
 * upload panel and polled by the ESP32's own ota_updater component - see
 * server/routes/firmware.js and jkbms-bridge.yaml. When present, pressing
 * Update is a REAL action: it PATCHes update_flag=true for this exact
 * device (server/routes/hubs.js), which is the actual signal the device
 * checks on its own schedule. This app still never talks to the ESP32
 * directly or transfers the file itself - see comments there for why.
 *
 * `fallbackRelease` is the older, global SQLite-backed "latest published"
 * record (server/routes/firmware.js's firmware_releases table) - shown only
 * when this device was never targeted by an upload, so there's still
 * something to report instead of an empty state. No real button is shown
 * for it since there is no per-device signal to send.
 */
export function VersionCheckModal({
  open,
  onClose,
  deviceLabel,
  softwareVersion,
  hardwareVersion,
  deviceFirmware,
  fallbackRelease,
  onUpdate,
  updating,
  updateError,
  updateSent,
}) {
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!open) return;
    setChecking(true);
    const t = setTimeout(() => setChecking(false), 900);
    return () => clearTimeout(t);
  }, [open]);

  if (!open) return null;

  const hasDeviceTarget = !!deviceFirmware?.latest_version;
  const latestVersion = deviceFirmware?.latest_version ?? fallbackRelease?.version ?? null;
  const isNew = latestVersion != null && latestVersion !== softwareVersion;

  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-center bg-black/40 p-4 pt-16 sm:pt-24 backdrop-blur-sm" onClick={onClose}>
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

            {latestVersion && (
              <div
                className={`mt-3 rounded-xl p-3 text-left text-xs ${isNew ? "bg-[var(--brand-10)]" : "bg-[var(--muted)]"}`}
              >
                <p className={`font-bold ${isNew ? "text-[var(--brand)]" : "text-[var(--foreground)]"}`}>
                  {isNew ? "🆕 " : "✓ "}เวอร์ชันล่าสุดที่เผยแพร่: v{latestVersion}
                </p>
                {deviceFirmware?.release_notes && (
                  <p className="mt-1 whitespace-pre-wrap text-[var(--muted-foreground)]">{deviceFirmware.release_notes}</p>
                )}
                {!isNew && <p className="mt-0.5 text-[var(--muted-foreground)]">เป็นเวอร์ชันล่าสุดอยู่แล้ว</p>}
                {isNew && !hasDeviceTarget && (
                  <p className="mt-1 text-[var(--muted-foreground)]">
                    เผยแพร่แล้วแต่ยังไม่ได้กำหนดให้อุปกรณ์นี้ - ให้แอดมินอัปโหลดพร้อมเลือกอุปกรณ์นี้เป็นเป้าหมาย
                  </p>
                )}
              </div>
            )}

            {updateSent && !updateError && (
              <div className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-left text-xs text-emerald-700">
                <CheckCircle2 className="size-4 shrink-0" />
                <span>ส่งคำสั่งอัพเดทแล้ว - อุปกรณ์จะดึงเฟิร์มแวร์ใหม่เองในการเช็ครอบถัดไป</span>
              </div>
            )}
            {updateError && (
              <div className="mt-3 flex items-center gap-2 rounded-xl bg-red-50 p-3 text-left text-xs text-red-700">
                <AlertTriangle className="size-4 shrink-0" />
                <span>ส่งคำสั่งไม่สำเร็จ: {updateError}</span>
              </div>
            )}

            <div className="mt-5 flex flex-col gap-2">
              {isNew && hasDeviceTarget && (
                <button
                  type="button"
                  onClick={onUpdate}
                  disabled={updating}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[var(--brand)] py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RefreshCw className={`size-3.5 ${updating ? "animate-spin" : ""}`} />
                  {updating ? "กำลังส่งคำสั่ง..." : "อัพเดทเฟิร์มแวร์"}
                </button>
              )}
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
