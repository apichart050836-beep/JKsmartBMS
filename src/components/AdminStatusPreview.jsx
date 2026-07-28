import React from "react";
import { Zap, Activity, Gauge, BatteryFull, HeartPulse, PlugZap, Unplug } from "lucide-react";
import { useHubData } from "../context/HubDataContext.jsx";
import { resolveHubPath } from "../lib/flattenHubs.js";
import { pick } from "../lib/pick.js";

// Every class string here is written out literally (not built with template
// strings/`.replace()`) so Tailwind's content scanner can actually find and
// keep it - dynamically assembled class names get purged from the build.
const TONE = {
  emerald: {
    bg: "bg-emerald-50",
    ring: "ring-emerald-200",
    icon: "bg-emerald-100 text-emerald-600",
    text: "text-emerald-600",
    bar: "bg-emerald-400",
  },
  amber: {
    bg: "bg-amber-50",
    ring: "ring-amber-200",
    icon: "bg-amber-100 text-amber-600",
    text: "text-amber-600",
    bar: "bg-amber-400",
  },
  rose: {
    bg: "bg-rose-50",
    ring: "ring-rose-200",
    icon: "bg-rose-100 text-rose-600",
    text: "text-rose-600",
    bar: "bg-rose-400",
  },
  blue: {
    bg: "bg-blue-50",
    ring: "ring-blue-200",
    icon: "bg-blue-100 text-blue-600",
    text: "text-blue-600",
    bar: "bg-blue-400",
  },
  violet: {
    bg: "bg-violet-50",
    ring: "ring-violet-200",
    icon: "bg-violet-100 text-violet-600",
    text: "text-violet-600",
    bar: "bg-violet-400",
  },
  zinc: {
    bg: "bg-zinc-50",
    ring: "ring-zinc-200",
    icon: "bg-zinc-100 text-zinc-500",
    text: "text-zinc-600",
    bar: "bg-zinc-400",
  },
};

// SOC: >60 green, 20-60 orange, <20 red - same bands as the Dashboard's
// LiquidBattery. SOH: >=80 green, >=50 orange, else red - same as
// SystemHero's SOH ring/progress bar.
function socTone(v) {
  if (v < 20) return "rose";
  if (v <= 60) return "amber";
  return "emerald";
}
function sohTone(v) {
  if (v < 50) return "rose";
  if (v < 80) return "amber";
  return "emerald";
}

function StatTile({ icon: Icon, label, value, unit, tone = "zinc" }) {
  const t = TONE[tone];
  return (
    <div className={`rounded-xl p-3 ring-1 ${t.bg} ${t.ring}`}>
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
        <span className={`flex size-6 items-center justify-center rounded-lg ${t.icon}`}>
          <Icon className="size-3.5" />
        </span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className={`text-xl font-extrabold tabular-nums ${t.text}`}>{value}</span>
        {unit && <span className="text-xs font-medium text-zinc-400">{unit}</span>}
      </div>
    </div>
  );
}

function Bar({ pct, tone }) {
  const t = TONE[tone];
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
      <div
        className={`h-full rounded-full transition-all duration-500 ${t.bar}`}
        style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
      />
    </div>
  );
}

/**
 * Read-only condensed status popup for a single device row on Admin Monitor
 * - same two groupings as the Dashboard's JK BMS Control Center hero
 * (Power & Energy Status / Remaining & Health Metrics), colorized to match
 * (tone-by-value tiles, not flat gray) instead of the Dashboard's gradient
 * glass panel. Reads the same real field names/fallback chains as
 * useBmsPackLive.js (via the shared `pick` helper) so the numbers shown here
 * always match what the owner's Dashboard shows.
 */
export function AdminStatusPreview({ path }) {
  const { hubs, loaded } = useHubData();
  const data = resolveHubPath(hubs, path);

  if (!loaded) return <p className="text-sm text-zinc-400">Connecting...</p>;
  if (data == null) return <p className="text-sm text-amber-500">Connected, but this path returned nothing.</p>;

  const status = data.status ?? {};
  const power = pick(status, "power", "battery_power") ?? 0;
  const current = pick(status, "current", "charge_current") ?? 0;
  const packVoltage = pick(status, "totalVoltage", "battery_voltage") ?? 0;
  const isCharging = current > 0;
  const isDischarging = current < 0;
  // Charge ON/OFF badge reads charging_state directly, per explicit
  // instruction (see useBmsPackLive.js's matching comment/revert).
  const chargeMOS = !!pick(status, "charging_state", "charge");
  const dischargeMOS = !!status.discharge;
  const statusLabel = isCharging ? "Charging" : isDischarging ? "Discharging" : "Idle";
  const currentTone = isCharging ? "emerald" : isDischarging ? "amber" : "zinc";
  const soc = pick(status, "soc", "percent_remain") ?? 0;
  const soh = pick(status, "state_of_health", "primaryHealth") ?? 100;
  const socT = socTone(soc);
  const sohT = typeof soh === "number" ? sohTone(soh) : "zinc";
  const remainingAh = status.capacity_remain ?? 0;
  const ratedCapacityAh = status.nominal_capacity ?? null;
  const remainingPct = ratedCapacityAh ? (remainingAh / ratedCapacityAh) * 100 : soc;

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Power &amp; Energy Status</p>
        <div className="grid grid-cols-3 gap-2.5">
          <StatTile icon={Zap} label="Battery Power" value={Math.round(Math.abs(power))} unit="W" tone="violet" />
          <StatTile
            icon={Activity}
            label={statusLabel}
            value={`${current >= 0 ? "+" : ""}${Math.round(current)}`}
            unit="A"
            tone={currentTone}
          />
          <StatTile icon={Gauge} label="Battery Volt." value={packVoltage.toFixed(2)} unit="V" tone="blue" />
        </div>
      </div>
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
          Remaining &amp; Health Metrics
        </p>
        <div className="grid grid-cols-3 gap-2.5">
          <div>
            <StatTile icon={BatteryFull} label="SOC" value={soc.toFixed(0)} unit="%" tone={socT} />
            <Bar pct={soc} tone={socT} />
          </div>
          <div>
            <StatTile icon={HeartPulse} label="SOH" value={typeof soh === "number" ? soh.toFixed(0) : soh} unit="%" tone={sohT} />
            <Bar pct={typeof soh === "number" ? soh : 100} tone={sohT} />
          </div>
          <div>
            <StatTile icon={BatteryFull} label="Remaining" value={remainingAh.toFixed(1)} unit={`/ ${ratedCapacityAh ?? "—"} Ah`} tone="blue" />
            <Bar pct={remainingPct} tone="blue" />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2.5 border-t border-zinc-100 pt-3">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
            chargeMOS ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-400"
          }`}
        >
          <PlugZap className="size-3.5" /> Charge {chargeMOS ? "ON" : "OFF"}
        </span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
            dischargeMOS ? "bg-blue-100 text-blue-700" : "bg-zinc-100 text-zinc-400"
          }`}
        >
          <Unplug className="size-3.5" /> Discharge {dischargeMOS ? "ON" : "OFF"}
        </span>
      </div>
    </div>
  );
}
