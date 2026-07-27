import React from "react";
import { Cpu } from "lucide-react";

// Slides in from the top when a device's real info.software_version
// (see BMSDashboard.jsx's version-change watcher) changes - the only
// signal available that the ESP32 firmware itself just updated, since
// there's no dedicated "update in progress" field in Firebase.
export function FirmwareUpdateToast({ update }) {
  if (!update) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-gradient-to-br from-[var(--brand)] to-[var(--info)] px-5 py-3 text-white shadow-2xl shadow-[var(--brand)]/40 ring-1 ring-white/10 animate-[toast-in_0.4s_cubic-bezier(0.34,1.56,0.64,1)]">
        <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-white/15">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-white/30" />
          <Cpu className="relative size-4 animate-[spin_2s_linear_infinite]" />
        </span>
        <div className="leading-tight">
          <div className="text-xs font-semibold uppercase tracking-wide text-white/80">อัพเดทเฟิร์มแวร์ ESP32</div>
          <div className="text-sm font-bold">
            {update.deviceLabel} · v{update.version}
          </div>
        </div>
      </div>
      <style>{`
        @keyframes toast-in {
          0% { opacity: 0; transform: translateY(-16px) scale(0.95); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
