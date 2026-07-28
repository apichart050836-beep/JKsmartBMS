import React from "react";
import { Sparkles } from "lucide-react";

/**
 * Auto-pops up once per new admin-published firmware release (see
 * HubDataContext's firmwareIsNew - driven by server/routes/firmware.js's
 * "firmware:release" broadcast). "อัพเดทตอนนี้" acknowledges permanently
 * (won't show again for this release); "เตือนภายหลัง" only hides it for
 * this session - the badge next to Dashboard stays colored either way, and
 * this popup will reappear on the next load until acknowledged. Purely a
 * publish+notify workflow - see FirmwareUpdateToast for what "Update"
 * actually does (nothing reaches a physical ESP32 from here).
 */
export function FirmwareReleaseModal({ open, release, onUpdate, onRemindLater }) {
  if (!open || !release) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm animate-[weather-modal-in_0.3s_ease] overflow-hidden rounded-3xl bg-[var(--card)] shadow-2xl ring-1 ring-[var(--border)]">
        <div className="relative bg-gradient-to-br from-[var(--brand)] to-[var(--info)] px-6 pb-8 pt-7 text-center text-white">
          <div className="mx-auto mb-3 flex size-16 items-center justify-center rounded-full bg-white/15 ring-4 ring-white/20">
            <Sparkles className="size-7" />
          </div>
          <h3 className="text-lg font-extrabold">มีเฟิร์มแวร์ ESP32 เวอร์ชันใหม่!</h3>
          <p className="mt-1 text-sm text-white/85">v{release.version}</p>
        </div>

        <div className="p-6">
          <div className="mb-4 rounded-xl bg-[var(--muted)] p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[var(--muted-foreground)]">ไฟล์</span>
              <span className="font-semibold text-[var(--foreground)]">{release.filename}</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between">
              <span className="text-[var(--muted-foreground)]">เผยแพร่เมื่อ</span>
              <span className="font-semibold text-[var(--foreground)]">
                {new Date(release.uploadedAt).toLocaleString("th-TH")}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={onUpdate}
              className="rounded-xl bg-[var(--brand)] py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              อัพเดทตอนนี้
            </button>
            <button
              type="button"
              onClick={onRemindLater}
              className="rounded-xl py-2.5 text-sm font-semibold text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)]"
            >
              เตือนภายหลัง
            </button>
          </div>
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
