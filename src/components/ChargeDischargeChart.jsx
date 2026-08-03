import React, { useEffect, useId, useMemo, useState } from "react";
import { BatteryCharging, TriangleAlert, ChevronLeft, ChevronRight } from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { api } from "../lib/apiClient.js";

// Plausible day-cycle shape (discharge overnight, charge midday, discharge
// evening) - purely illustrative so the Daily chart isn't a blank/flat line
// while real session history is still thin. Clearly labeled as simulated in
// the UI below, never silently swapped in as if it were live telemetry.
const MOCK_DATA = [
  { time: "00:00", hour: 0, current: -3.2 },
  { time: "02:00", hour: 2, current: -2.8 },
  { time: "04:00", hour: 4, current: -2.1 },
  { time: "06:00", hour: 6, current: -1.4 },
  { time: "08:00", hour: 8, current: 1.8 },
  { time: "10:00", hour: 10, current: 4.6 },
  { time: "12:00", hour: 12, current: 5.9 },
  { time: "14:00", hour: 14, current: 5.1 },
  { time: "16:00", hour: 16, current: 2.7 },
  { time: "18:00", hour: 18, current: -1.9 },
  { time: "20:00", hour: 20, current: -3.6 },
  { time: "22:00", hour: 22, current: -3.9 },
];

const CHARGE_COLOR = "#8b5cf6";
const DISCHARGE_COLOR = "#f97316";

// Same illustrative purpose as MOCK_DATA above, but shaped for the bar
// views (Monthly/Yearly) - a smooth two-phase wave per label so it never
// looks like a flat, broken chart while real accumulated history is still
// thin. Deterministic (no Math.random), always clearly labeled as mock in
// the UI, never mistaken for real telemetry.
function mockBarSeries(labels, chargedAmp, dischargedAmp) {
  return labels.map((label, i) => {
    const phase = (i / labels.length) * Math.PI * 2;
    return {
      label,
      charged: Math.max(0, chargedAmp * (0.55 + 0.45 * Math.sin(phase + 0.6))),
      discharged: -Math.max(0, dischargedAmp * (0.55 + 0.45 * Math.sin(phase + 3.6))),
    };
  });
}

const VIEWS = [
  { id: "daily", label: "รายวัน" },
  { id: "monthly", label: "รายเดือน" },
  { id: "yearly", label: "รายปี" },
];

function pad2(n) {
  return String(n).padStart(2, "0");
}
function toDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function toMonthStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function LegendDot({ color, label }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--muted-foreground)]">
      <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function AreaTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  // charge/discharge are now both always-present positive-or-zero magnitudes
  // (see areaData above) rather than one being null - so "which one is
  // active" is a >0 check, not a typeof check.
  const charge = payload.find((p) => p.dataKey === "charge")?.value ?? 0;
  const discharge = payload.find((p) => p.dataKey === "discharge")?.value ?? 0;
  // The X axis now plots by numeric hour-of-day (so the daily chart always
  // spans the full 0-24h range regardless of how much of the day has real
  // data), so `label` here is a bare number (e.g. 13.5) - the human-readable
  // clock time rides along on each point instead, as timeLabel.
  const displayLabel = payload[0]?.payload?.timeLabel ?? label;
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-[var(--foreground)]">{displayLabel}</p>
      {charge > 0 && (
        <p className="tabular-nums" style={{ color: CHARGE_COLOR }}>Charge · {charge.toFixed(2)} A</p>
      )}
      {discharge > 0 && (
        <p className="tabular-nums" style={{ color: DISCHARGE_COLOR }}>Discharge · {discharge.toFixed(2)} A</p>
      )}
      {charge === 0 && discharge === 0 && (
        <p className="tabular-nums text-[var(--muted-foreground)]">Idle · 0.00 A</p>
      )}
    </div>
  );
}

function BarTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const charged = payload.find((p) => p.dataKey === "charged")?.value ?? 0;
  const discharged = Math.abs(payload.find((p) => p.dataKey === "discharged")?.value ?? 0);
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-[var(--foreground)]">{label}</p>
      <p className="tabular-nums" style={{ color: CHARGE_COLOR }}>Charged · {charged.toFixed(2)} Ah</p>
      <p className="tabular-nums" style={{ color: DISCHARGE_COLOR }}>Discharged · {discharged.toFixed(2)} Ah</p>
    </div>
  );
}

// Charge/Discharge history, with Daily/Monthly/Yearly views and day-by-day
// (or month/year) navigation. Firebase never stores history (only the
// current-moment status node) so everything here beyond the live session
// buffer (`history`, used only as the Daily fallback while real backend
// history is thin) comes from the backend's telemetry_log table - see
// server/telemetryLogger.js and server/routes/history.js. Charged/discharged
// Ah are derived from capacity_remain deltas (the BMS's own coulomb
// counter), not from integrating current, since no discharge-current
// magnitude field exists anywhere in Firebase.
export function ChargeDischargeChart({ history = [], hubId, bmsKey }) {
  const gradientId = useId();
  const [view, setView] = useState("daily");
  const [cursor, setCursor] = useState(() => new Date());
  const [daily, setDaily] = useState(null);
  const [monthly, setMonthly] = useState(null);
  const [yearly, setYearly] = useState(null);
  // Distinguishes "fetch still in flight" from "fetch resolved and real
  // data is genuinely thin" - both used to render the same mock-fallback
  // UI, which meant the MOCK DATA warning flashed on every single view/date
  // switch for the ~200-500ms the request takes, even when real data
  // existed and would show correctly a moment later. Confirmed live: a
  // day with real logged data rendered the mock banner immediately after
  // clicking, then the correct real bar chart once the fetch resolved.
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hubId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const done = () => !cancelled && setLoading(false);
    if (view === "daily") {
      api.historyDaily(hubId, bmsKey, toDateStr(cursor)).then((r) => !cancelled && setDaily(r)).catch(() => {}).finally(done);
    } else if (view === "monthly") {
      api.historyMonthly(hubId, bmsKey, toMonthStr(cursor)).then((r) => !cancelled && setMonthly(r)).catch(() => {}).finally(done);
    } else {
      api.historyYearly(hubId, bmsKey, cursor.getFullYear()).then((r) => !cancelled && setYearly(r)).catch(() => {}).finally(done);
    }
    return () => {
      cancelled = true;
    };
  }, [hubId, bmsKey, view, cursor]);

  const today = new Date();
  const atPresent =
    view === "daily"
      ? toDateStr(cursor) === toDateStr(today)
      : view === "monthly"
        ? toMonthStr(cursor) === toMonthStr(today)
        : cursor.getFullYear() === today.getFullYear();

  function step(dir) {
    setCursor((prev) => {
      const next = new Date(prev);
      if (view === "daily") next.setDate(next.getDate() + dir);
      else if (view === "monthly") next.setMonth(next.getMonth() + dir);
      else next.setFullYear(next.getFullYear() + dir);
      return next;
    });
  }

  const periodLabel =
    view === "daily"
      ? cursor.toLocaleDateString("th-TH", { day: "numeric", month: "long", year: "numeric" })
      : view === "monthly"
        ? cursor.toLocaleDateString("th-TH", { month: "long", year: "numeric" })
        : String(cursor.getFullYear());

  // Daily: the real signed charge_current reading at each snapshot -
  // charge_current is confirmed genuinely signed (positive = charging,
  // negative = discharging; ranges -2.567 to +3.679 in real logged data,
  // sign matches capacity_remain moving up/down), so this is a direct real
  // reading, not a derived rate. Using capacity_remain deltas here (the
  // earlier approach) went flat/wrong whenever capacity_remain froze for a
  // stretch (a stale device/Firebase read) even though charge_current kept
  // reporting the real live value - confirmed live, not hypothetical.
  const dailyPoints = useMemo(() => {
    if (!daily?.points?.length) return [];
    return daily.points
      .filter((p) => typeof p.chargeCurrent === "number")
      .map((p) => {
        const d = new Date(p.ts);
        return {
          time: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          hour: d.getHours() + d.getMinutes() / 60,
          current: p.chargeCurrent,
        };
      });
  }, [daily]);

  const hasRealDaily = dailyPoints.length >= 3;
  // Gated on !loading - see the `loading` state above. Without this, every
  // view/date switch briefly shows MOCK_DATA (and the warning banner) for
  // the ~200-500ms the request takes, even on days with plenty of real data,
  // since `daily` starts each fetch cycle back at its prior/null value.
  const isAreaMock = view === "daily" && !loading && !hasRealDaily;
  const areaSource = isAreaMock ? MOCK_DATA : hasRealDaily ? dailyPoints : history.map((h) => ({ time: h.time, hour: h.hour, current: h.current }));
  // Two genuinely separate series, both plotted as positive magnitudes
  // rising from a shared 0 baseline (not split above/below zero) - gives the
  // overlapping-wave look requested, with color (purple vs orange) as the
  // only thing distinguishing which is which. `charge` is 0 (not null)
  // whenever discharging and vice versa, since the pack is never doing both
  // at once - that's what makes the two curves trade off across the day
  // instead of leaving gaps.
  // `hour` (numeric, 0-24) drives X position so the axis always spans the
  // full day - a `time`-keyed categorical axis only shows however many
  // hours actually have data, which looked like the chart was "missing"
  // the rest of the day per explicit request to always show the full 24h.
  const areaData = areaSource.map((d) => ({
    hour: d.hour,
    timeLabel: d.time,
    charge: d.current > 0 ? d.current : 0,
    discharge: d.current < 0 ? Math.abs(d.current) : 0,
  }));

  const values = areaSource.map((d) => d.current);
  const maxV = Math.max(0, ...values);
  const minV = Math.min(0, ...values);

  // Fixed 10A steps on a single unsigned axis (0 upward) - both series climb
  // from the same baseline now, so there's no need for a symmetric +/- scale.
  const A_STEP = 10;
  const areaAxisMax = Math.ceil(Math.max(10, Math.abs(maxV), Math.abs(minV)) / A_STEP) * A_STEP;
  const areaTicks = [];
  for (let v = 0; v <= areaAxisMax; v += A_STEP) areaTicks.push(v);

  // Full calendar skeleton (all days of the month / all 12 months of the
  // year), independent of whether the history fetch has resolved yet - a
  // slow or failed request (e.g. the backend hasn't been restarted since
  // this feature was added) should still show a normal-looking empty chart
  // with real day/month labels, not a blank one with no axis at all.
  const monthlySkeleton = useMemo(() => {
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => ({ label: String(i + 1), charged: 0, discharged: 0 }));
  }, [view === "monthly" ? toMonthStr(cursor) : null]);
  const yearlySkeleton = useMemo(() => {
    const y = cursor.getFullYear();
    return Array.from({ length: 12 }, (_, i) =>
      new Date(y, i, 1).toLocaleDateString("th-TH", { month: "short" })
    ).map((label) => ({ label, charged: 0, discharged: 0 }));
  }, [view === "yearly" ? cursor.getFullYear() : null]);

  const realBarData =
    view === "monthly"
      ? monthlySkeleton.map((d, i) => {
          const real = monthly?.days?.[i];
          return real ? { label: d.label, charged: real.chargedAh, discharged: -real.dischargedAh } : d;
        })
      : view === "yearly"
        ? yearlySkeleton.map((m, i) => {
            const real = yearly?.months?.[i];
            return real ? { label: m.label, charged: real.chargedAh, discharged: -real.dischargedAh } : m;
          })
        : [];
  const hasBarData = realBarData.some((d) => d.charged !== 0 || d.discharged !== 0);
  const isBarMock = (view === "monthly" || view === "yearly") && !loading && !hasBarData;
  const barData = isBarMock
    ? mockBarSeries(
        (view === "monthly" ? monthlySkeleton : yearlySkeleton).map((d) => d.label),
        view === "monthly" ? 8 : 180,
        view === "monthly" ? 7 : 160
      )
    : realBarData;

  // Fixed 20 Ah steps, symmetric around 0 (charged bars go up, discharged go
  // down) - a clean, predictable scale instead of whatever odd numbers
  // recharts' auto-domain would otherwise pick.
  const AH_STEP = 20;
  const barMaxAbs = Math.max(20, ...barData.flatMap((d) => [Math.abs(d.charged), Math.abs(d.discharged)]));
  const barAxisMax = Math.ceil(barMaxAbs / AH_STEP) * AH_STEP;
  const barTicks = [];
  for (let v = -barAxisMax; v <= barAxisMax; v += AH_STEP) barTicks.push(v);

  const fillId = `fill-${gradientId}`;
  const strokeId = `stroke-${gradientId}`;

  return (
    <section className="rounded-2xl bg-[var(--card)] p-5 shadow-sm ring-1 ring-[var(--border)] md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-xl bg-[var(--brand)]/10 text-[var(--brand)]">
            <BatteryCharging className="size-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[var(--foreground)]">Charge / Discharge</h2>
            <p className="text-[11px] text-[var(--muted-foreground)]">กระแสไฟฟ้า (A) ตลอดวัน</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <LegendDot color={CHARGE_COLOR} label="Charge" />
          <LegendDot color={DISCHARGE_COLOR} label="Discharge" />
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1 rounded-xl bg-[var(--muted)] p-1">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setView(v.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                view === v.id ? "bg-[var(--card)] text-[var(--brand)] shadow-sm" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="inline-flex items-center gap-1 rounded-xl bg-[var(--muted)] p-1">
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
      </div>

      {loading ? (
        <div className="mb-3 flex items-center gap-2 rounded-xl bg-[var(--muted)] px-4 py-2.5">
          <span className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-[var(--muted-foreground)] border-t-transparent" />
          <p className="text-xs font-medium text-[var(--muted-foreground)]">กำลังโหลดข้อมูล...</p>
        </div>
      ) : (
        (isAreaMock || isBarMock) && (
          <div className="mb-3 flex items-center gap-2 rounded-xl border-2 border-dashed border-[var(--warning)] bg-[var(--warning-10)] px-4 py-2.5">
            <TriangleAlert className="size-5 shrink-0 text-[var(--warning)]" />
            <p className="text-sm font-bold uppercase tracking-wide text-[var(--warning)]">ข้อมูลจำลองเด้อจ้า - MOCK DATA, NOT REAL TELEMETRY</p>
          </div>
        )
      )}

      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {view === "daily" ? (
            <AreaChart data={areaData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                {/* Both series now climb from the same 0 baseline, so both
                    gradients fade the same direction: dense near the curve,
                    transparent down at the axis. */}
                <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHARGE_COLOR} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={CHARGE_COLOR} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id={strokeId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={DISCHARGE_COLOR} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={DISCHARGE_COLOR} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="hour"
                type="number"
                domain={[0, 24]}
                ticks={[0, 4, 8, 12, 16, 20, 24]}
                tickFormatter={(h) => `${pad2(h)}:00`}
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                axisLine={{ stroke: "var(--border)" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                width={32}
                unit="A"
                domain={[0, areaAxisMax]}
                ticks={areaTicks}
              />
              <Tooltip content={<AreaTooltip />} cursor={{ stroke: "var(--border)", strokeWidth: 1 }} />
              {/* Two genuinely separate series sharing one baseline, not
                  split above/below zero - color (purple/orange) is what
                  distinguishes which is which, giving the overlapping-wave
                  look instead of a mirrored up/down chart. */}
              <Area
                type="monotone"
                dataKey="charge"
                stroke={CHARGE_COLOR}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill={`url(#${fillId})`}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                isAnimationActive={!isAreaMock}
              />
              <Area
                type="monotone"
                dataKey="discharge"
                stroke={DISCHARGE_COLOR}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill={`url(#${strokeId})`}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                isAnimationActive={!isAreaMock}
              />
            </AreaChart>
          ) : (
            <BarChart data={barData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
              <YAxis
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                width={36}
                unit="Ah"
                domain={[-barAxisMax, barAxisMax]}
                ticks={barTicks}
              />
              <Tooltip content={<BarTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
              <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.4} />
              <Bar dataKey="charged" fill={CHARGE_COLOR} radius={[3, 3, 0, 0]} maxBarSize={28} />
              <Bar dataKey="discharged" fill={DISCHARGE_COLOR} radius={[0, 0, 3, 3]} maxBarSize={28} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </section>
  );
}
