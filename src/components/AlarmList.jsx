import React from "react";
import { ShieldCheck, TriangleAlert, OctagonAlert } from "lucide-react";

const SEVERITY_STYLES = {
  critical: {
    icon: OctagonAlert,
    ring: "ring-red-200 dark:ring-red-900/50",
    bg: "bg-red-50 dark:bg-red-950/30",
    fg: "text-red-600 dark:text-red-400",
  },
  warning: {
    icon: TriangleAlert,
    ring: "ring-amber-200 dark:ring-amber-900/50",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    fg: "text-amber-600 dark:text-amber-400",
  },
};

export function AlarmList({ alarms = [] }) {
  if (alarms.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <ShieldCheck className="size-9 text-emerald-500" />
        <p className="text-sm font-semibold text-[var(--foreground)]">ไม่มีการแจ้งเตือน</p>
        <p className="text-xs text-[var(--muted-foreground)]">ทุกค่าอยู่ในเกณฑ์ที่ตั้งไว้ ณ ขณะนี้</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {alarms.map((alarm) => {
        const style = SEVERITY_STYLES[alarm.severity] ?? SEVERITY_STYLES.warning;
        const Icon = style.icon;
        return (
          <div key={alarm.id} className={`flex items-center gap-3 rounded-xl p-3 ring-1 ${style.bg} ${style.ring}`}>
            <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${style.fg}`}>
              <Icon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[var(--foreground)]">{alarm.label}</p>
              <p className="text-xs text-[var(--muted-foreground)]">Limit {alarm.limit}</p>
            </div>
            <span className={`shrink-0 text-sm font-bold tabular-nums ${style.fg}`}>{alarm.value}</span>
          </div>
        );
      })}
    </div>
  );
}
