import React from "react";
import { statusTone } from "../lib/tone.js";

/**
 * Table markup/classes cloned from the kit's components/ui/table.tsx
 * (border-b rows, h-10 heads, hover:bg-muted/50). Badge styling matches
 * components/ui/badge.tsx's shape (rounded-md, border, px-2 py-0.5,
 * text-xs font-medium) with our status tokens standing in for its
 * default/secondary/destructive variants.
 */

function LogBadge({ tone, children }) {
  const t = statusTone(tone);
  return (
    <span
      className={`inline-flex w-fit items-center justify-center gap-1 whitespace-nowrap rounded-md border border-transparent px-2 py-0.5 text-xs font-medium ${t.bg} ${t.fg}`}
    >
      {children}
    </span>
  );
}

const STATUS_TONE = { Charging: "good", Discharging: "info", Standby: "warning" };

export function DetailedLog({ entries }) {
  return (
    <div>
      <p className="mb-3 text-xs text-[var(--muted-foreground)]">Most recent readings, newest first</p>

      <div className="relative w-full overflow-x-auto">
        <table className="w-full caption-bottom text-sm">
          <thead className="[&_tr]:border-b [&_tr]:border-[var(--border)]">
            <tr>
              <th className="h-10 px-2 text-left align-middle text-xs font-medium text-[var(--muted-foreground)]">Timestamp</th>
              <th className="h-10 px-2 text-left align-middle text-xs font-medium text-[var(--muted-foreground)]">Cell Voltage</th>
              <th className="h-10 px-2 text-left align-middle text-xs font-medium text-[var(--muted-foreground)]">BMS Temp</th>
              <th className="h-10 px-2 text-left align-middle text-xs font-medium text-[var(--muted-foreground)]">Status</th>
            </tr>
          </thead>
          <tbody className="[&_tr:last-child]:border-0">
            {entries.map((row) => (
              <tr
                key={row.id}
                className="border-b border-[var(--border)] transition-colors hover:bg-[var(--muted)]/50"
              >
                <td className="p-2 align-middle whitespace-nowrap text-[var(--muted-foreground)] tabular-nums">
                  {row.time}
                </td>
                <td className="p-2 align-middle whitespace-nowrap font-medium text-[var(--foreground)] tabular-nums">
                  {row.minV.toFixed(3)}–{row.maxV.toFixed(3)} V
                </td>
                <td className="p-2 align-middle whitespace-nowrap text-[var(--foreground)] tabular-nums">
                  {row.temp.toFixed(1)} °C
                </td>
                <td className="p-2 align-middle whitespace-nowrap">
                  <LogBadge tone={STATUS_TONE[row.status]}>{row.status}</LogBadge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
