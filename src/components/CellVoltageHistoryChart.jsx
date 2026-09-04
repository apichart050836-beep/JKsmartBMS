import React, { useEffect, useMemo, useState } from "react";
import { Activity, ChevronLeft, ChevronRight } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { api } from "../lib/apiClient.js";

// Per explicit request: individual cell voltages over time, one line per
// cell, y-axis fixed to the real usable LiFePO4 cell range (3.1-3.65V) so
// the same vertical scale is comparable across devices/days, viewable
// day-by-day. With up to ~24 cells, giving each its own hue would violate
// the categorical-color rule (see the dataviz skill: "a 9th series is never
// a generated hue") and be unreadable anyway - instead every individual
// cell renders as one thin, muted, identical-color line (a classic
// "spaghetti" comparison: a chronically high or low cell visually
// separates itself from the pack without needing distinct colors), with
// two bold overlaid lines - the highest and lowest reading AT EACH
// timestamp (not a fixed physical cell, since which cell is highest/lowest
// can shift during the day) - answering "which line is low/high" directly.
// Colors reuse the exact same warning/info tones the live Cell Voltage
// Monitoring grid already uses for its own Max/Min pills (see
// BMSDashboard.jsx and src/lib/tone.js), so this chart reads as the
// historical extension of that grid, not a new color language.
const MAX_COLOR = "var(--warning)";
const MIN_COLOR = "var(--info)";
const CELL_LINE_COLOR = "var(--muted-foreground)";
const Y_MIN = 3.1;
const Y_MAX = 3.65;

function pad2(n) {
  return String(n).padStart(2, "0");
}
function toDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

const FIVE_MIN_GRID_TICKS = Array.from({ length: (24 * 60) / 5 + 1 }, (_, i) => (i * 5) / 60);

function CellTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-[var(--foreground)]">{p.timeLabel ?? label}</p>
      <p className="tabular-nums" style={{ color: MAX_COLOR }}>
        สูงสุด · {p.max.toFixed(3)} V (C{p.maxIdx + 1})
      </p>
      <p className="tabular-nums" style={{ color: MIN_COLOR }}>
        ต่ำสุด · {p.min.toFixed(3)} V (C{p.minIdx + 1})
      </p>
      <p className="tabular-nums text-[var(--muted-foreground)]">
        ผลต่าง · {((p.max - p.min) * 1000).toFixed(0)} mV · {p.cellCount} เซลล์
      </p>
    </div>
  );
}

// Historical Cell Voltage chart, day-navigable - the /daily.../history/cells
// analog to ChargeDischargeChart.jsx's own daily view (same day-cursor
// pattern, same numeric-hour X axis convention), reading
// telemetryLogger.js's new cell_voltages_json column via
// server/routes/history.js's /cells endpoint.
export function CellVoltageHistoryChart({ hubId, bmsKey }) {
  const [cursor, setCursor] = useState(() => new Date());
  const [daily, setDaily] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hubId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .historyCells(hubId, bmsKey, toDateStr(cursor))
      .then((r) => !cancelled && setDaily(r))
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [hubId, bmsKey, cursor]);

  const today = new Date();
  const atPresent = toDateStr(cursor) === toDateStr(today);

  function step(dir) {
    setCursor((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + dir);
      return next;
    });
  }

  const periodLabel = cursor.toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" });

  // Each point: { hour, timeLabel, cells: [...], max, maxIdx, min, minIdx, cellCount }
  // - max/min recomputed per point (not tied to one physical cell index)
  // since which cell is highest/lowest can change across the day.
  const points = useMemo(() => {
    if (!daily?.points?.length) return [];
    return daily.points
      .filter((p) => Array.isArray(p.cells) && p.cells.length > 0)
      .map((p) => {
        const d = new Date(p.ts);
        const maxV = Math.max(...p.cells);
        const minV = Math.min(...p.cells);
        return {
          hour: d.getHours() + d.getMinutes() / 60,
          timeLabel: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          cells: p.cells,
          max: maxV,
          maxIdx: p.cells.indexOf(maxV),
          min: minV,
          minIdx: p.cells.indexOf(minV),
          cellCount: p.cells.length,
        };
      });
  }, [daily]);

  const cellCount = points.length ? Math.max(...points.map((p) => p.cellCount)) : 0;
  const hasData = points.length >= 2;

  // Fixed axis (per explicit request: "3.1v จนถึง 3.65v"), with a small
  // margin so a value sitting exactly at 3.10/3.65 doesn't clip against the
  // plot edge.
  const yTicks = [3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.65];

  const periodKey = `cells-${toDateStr(cursor)}`;

  return (
    <section className="rounded-2xl bg-[var(--card)] p-5 shadow-sm ring-1 ring-[var(--border)] md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-xl bg-[var(--brand)]/10 text-[var(--brand)]">
            <Activity className="size-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[var(--foreground)]">Cell Voltage History</h2>
            <p className="text-[11px] text-[var(--muted-foreground)]">แรงดันแต่ละเซลล์ย้อนหลัง{cellCount ? ` · ${cellCount} เซลล์` : ""}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[11px] font-medium text-[var(--muted-foreground)]">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full" style={{ backgroundColor: MAX_COLOR }} />
            สูงสุด
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full" style={{ backgroundColor: MIN_COLOR }} />
            ต่ำสุด
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full opacity-40" style={{ backgroundColor: CELL_LINE_COLOR }} />
            แต่ละเซลล์
          </span>
        </div>
      </div>

      <div className="mb-3 flex items-center justify-center gap-1 rounded-xl bg-[var(--muted)] p-1">
        <button
          type="button"
          onClick={() => step(-1)}
          className="rounded-lg p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--card)] hover:text-[var(--foreground)]"
          title="ก่อนหน้า"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="min-w-[9rem] px-1 text-center text-xs font-semibold text-[var(--foreground)]">{periodLabel}</span>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={atPresent}
          className="rounded-lg p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--card)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-30"
          title="ถัดไป"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      {loading ? (
        <div className="mb-3 flex items-center gap-2 rounded-xl bg-[var(--muted)] px-4 py-2.5">
          <span className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-[var(--muted-foreground)] border-t-transparent" />
          <p className="text-xs font-medium text-[var(--muted-foreground)]">กำลังโหลดข้อมูล...</p>
        </div>
      ) : !hasData ? (
        <div className="flex h-56 items-center justify-center rounded-xl bg-[var(--muted)]">
          <p className="text-xs text-[var(--muted-foreground)]">ยังไม่มีข้อมูลแรงดันเซลล์ในวันนี้</p>
        </div>
      ) : (
        <div key={periodKey} className="h-56 w-full animate-fade-in-up">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeOpacity={0.6} />
              <XAxis
                dataKey="hour"
                type="number"
                domain={[0, 24]}
                ticks={FIVE_MIN_GRID_TICKS}
                tickFormatter={(h) => (Number.isInteger(h) && h % 4 === 0 ? `${pad2(h)}:00` : "")}
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                axisLine={{ stroke: "var(--border)" }}
                tickLine={false}
                interval={0}
              />
              <YAxis
                type="number"
                domain={[Y_MIN, Y_MAX]}
                ticks={yTicks}
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                width={36}
                unit="V"
              />
              <Tooltip content={<CellTooltip />} cursor={{ stroke: "var(--border)", strokeWidth: 1 }} />
              {/* Every individual cell, same muted color/low opacity so a
                  chronically high or low cell visually separates from the
                  pack without needing 16-24 distinct hues. */}
              {Array.from({ length: cellCount }, (_, i) => (
                <Line
                  key={i}
                  type="monotone"
                  dataKey={(p) => (i < p.cells.length ? p.cells[i] : null)}
                  stroke={CELL_LINE_COLOR}
                  strokeOpacity={0.35}
                  strokeWidth={1}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              ))}
              <Line
                type="monotone"
                dataKey="max"
                stroke={MAX_COLOR}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="min"
                stroke={MIN_COLOR}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
