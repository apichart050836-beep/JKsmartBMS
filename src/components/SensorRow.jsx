import React from "react";
import { Thermometer, RotateCw } from "lucide-react";
import { statusTone } from "../lib/tone.js";

/**
 * "Sensor Row": Temperature / Cycle Capacity / Cycle Count, sitting right
 * below Primary Health. Current now lives merged into the hero's Battery
 * Power tile, so it's no longer duplicated here. Plain rounded-2xl bg-card
 * tiles (same shell as the kit's DeviceCard) rather than glass, per spec
 * ("UI ขอบมนแบบคลีน").
 *
 * `channels` is per-pack (useBmsPackLive reports T1/T2/T4/T5/CMOS - 5 real
 * sensor fields, T3 deliberately excluded per spec), passed in rather than a
 * fixed import, and the tile just renders whatever list it's given - the "N-
 * Channel" label below reads channels.length directly, so it grows on its
 * own if another channel is ever added there.
 */

// A sensor alarms as soon as it crosses the configured OTP; it flags amber a
// few degrees before that so the approach is visible, not just the trip.
const ALERT_BAND_C = 5;

function channelTone(value, otpLimit) {
  if (value > otpLimit) return "critical";
  if (value > otpLimit - ALERT_BAND_C) return "warning";
  return "info";
}

// Cycle Capacity and Cycle Count in one card (previously two separate
// tiles) - both pulled from the exact same backend fields as before
// (status.cycle_capacity / status.cycle_count via useBmsPackLive's
// cycleAh/cycleCount), just presented together.
function CycleInfoTile({ cycleAh, cycleCount }) {
  return (
    <div className="rounded-2xl bg-[var(--card)] p-4 shadow-sm ring-1 ring-[var(--border)] sm:col-span-2">
      <div className="mb-3 flex items-center justify-between">
        <span className="grid size-9 place-items-center rounded-xl bg-[var(--brand-10)]">
          <RotateCw className="size-4 text-[var(--brand)]" />
        </span>
        <span className="text-[10px] text-[var(--muted-foreground)]">Lifetime throughput</span>
      </div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
        Cycle Information
      </p>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold text-[var(--foreground)] tabular-nums">{cycleAh.toFixed(1)}</span>
            <span className="text-xs text-[var(--muted-foreground)]">Ah</span>
          </div>
          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">Cycle Capacity</p>
        </div>
        <div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold text-[var(--foreground)] tabular-nums">{cycleCount.toFixed(1)}</span>
            <span className="text-xs text-[var(--muted-foreground)]">cycles</span>
          </div>
          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">Cycle Count</p>
        </div>
      </div>
    </div>
  );
}

function TemperatureTile({ channels, temps, maxTemp, otpLimit }) {
  return (
    <div className="rounded-2xl bg-[var(--card)] p-4 shadow-sm ring-1 ring-[var(--border)] sm:col-span-2">
      <div className="mb-3 flex items-center justify-between">
        <span className="grid size-9 place-items-center rounded-xl bg-[var(--info-10)]">
          <Thermometer className="size-4 text-[var(--info)]" />
        </span>
        <span className="text-[10px] text-[var(--muted-foreground)]">
          Max {maxTemp.toFixed(1)}°C · OTP {otpLimit}°C
        </span>
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
        Temperature · {channels.length}-Channel
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {channels.map((c) => {
          const value = temps[c.key];
          const t = statusTone(channelTone(value, otpLimit));
          return (
            <div key={c.key} className={`flex min-w-[58px] flex-1 flex-col items-center rounded-xl px-2 py-1.5 ${t.bg}`}>
              <span className="text-[10px] font-semibold text-[var(--muted-foreground)]">{c.label}</span>
              <span className={`text-sm font-bold tabular-nums ${t.fg}`}>{value.toFixed(1)}°</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SensorRow({ channels, temps, maxTemp, otpLimit, cycleAh, cycleCount }) {
  return (
    <section>
    
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TemperatureTile channels={channels} temps={temps} maxTemp={maxTemp} otpLimit={otpLimit} />
        <CycleInfoTile cycleAh={cycleAh} cycleCount={cycleCount} />
      </div>
    </section>
  );
}
