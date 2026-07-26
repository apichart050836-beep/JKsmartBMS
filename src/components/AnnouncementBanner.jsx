import React from "react";
import { Megaphone, Wrench, RefreshCw, TriangleAlert, X } from "lucide-react";
import { useHubData } from "../context/HubDataContext.jsx";

const CATEGORY_STYLE = {
  ปรับปรุงระบบ: { icon: Wrench, fg: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950/30", ring: "ring-blue-200 dark:ring-blue-900/50" },
  อัพเดทระบบ: { icon: RefreshCw, fg: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30", ring: "ring-emerald-200 dark:ring-emerald-900/50" },
  ระบบขัดข้อง: { icon: TriangleAlert, fg: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/30", ring: "ring-amber-200 dark:ring-amber-900/50" },
};
const DEFAULT_STYLE = { icon: Megaphone, fg: "text-[var(--brand)]", bg: "bg-[var(--brand-10)]", ring: "ring-[var(--border)]" };

// Live push from an admin's "แจ้ง Update" broadcast (AnnounceModal.jsx) -
// see HubDataContext for the Socket.IO listener + the catch-up fetch for a
// dashboard that loaded shortly after the broadcast rather than being open
// live at send-time.
export function AnnouncementBanner() {
  const { announcement, dismissAnnouncement } = useHubData();
  if (!announcement) return null;

  const style = CATEGORY_STYLE[announcement.category] ?? DEFAULT_STYLE;
  const Icon = style.icon;

  return (
    <div className={`mb-4 flex items-start gap-3 rounded-2xl p-4 shadow-sm ring-1 ${style.bg} ${style.ring}`}>
      <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--card)] ${style.fg}`}>
        <Icon className="size-4.5" />
      </span>
      <div className="min-w-0 flex-1">
        {announcement.category && (
          <p className={`text-[11px] font-bold uppercase tracking-wide ${style.fg}`}>{announcement.category}</p>
        )}
        <p className="mt-0.5 text-sm font-medium text-[var(--foreground)]">{announcement.message}</p>
        <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">
          {new Date(announcement.createdAt).toLocaleString()}
        </p>
      </div>
      <button
        type="button"
        onClick={dismissAnnouncement}
        className="shrink-0 rounded-full p-1 text-[var(--muted-foreground)] hover:bg-[var(--card)]"
        title="ปิด"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
