import React from "react";
import { ArrowDownCircle, ArrowUpCircle } from "lucide-react";

const NOMINAL_CELL_VOLT = 3.2; // LiFePO4 nominal per cell

function ahToKwh(ah, nominalVoltage) {
  return (ah * nominalVoltage) / 1000;
}

const TONE_STYLES = {
  emerald: {
    wrap: "border-emerald-100 bg-emerald-50",
    iconWrap: "bg-emerald-100 text-emerald-600",
    value: "text-emerald-700",
    kwh: "bg-white/70 text-emerald-700/50",
  },
  amber: {
    wrap: "border-amber-100 bg-amber-50",
    iconWrap: "bg-amber-100 text-amber-600",
    value: "text-amber-700",
    kwh: "bg-white/70 text-amber-700/50",
  },
};

// Same shape as SensorRow's T1/T2 tags (small label on top, bold value
// below) rather than a dark panel - this sits directly on Primary Health's
// white card, so it needed to read as a tag, not its own boxed-off section.
function EnergyPill({ icon: Icon, label, ah, kwh, tone }) {
  const t = TONE_STYLES[tone];
  return (
    <div className={`flex min-w-[128px] flex-col items-center gap-1 rounded-xl border px-3 py-2.5 ${t.wrap}`}>
      <div className="flex items-center gap-1.5">
        <span className={`flex h-5 w-5 items-center justify-center rounded-full ${t.iconWrap}`}>
          <Icon className="h-3 w-3" strokeWidth={2.5} />
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className={`text-xl font-bold tabular-nums ${t.value}`}>{ah.toFixed(2)}</span>
        <span className="text-xs font-medium text-slate-400">Ah</span>
      </div>
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${t.kwh}`}>{kwh.toFixed(3)} kWh</span>
    </div>
  );
}

/**
 * Today's charged/used Ah + auto kWh conversion, as two small pastel pills
 * (not a boxed panel - kept deliberately light so it doesn't clash with the
 * white Primary Health card and the purple/blue brand header above it).
 *
 * chargedAh/dischargedAh come straight from the firmware (on-device coulomb
 * counting, persisted across reboots, resets at local midnight - see
 * jkbms-bridge.yaml) via useBmsPackLive - every pack is a live Firebase read
 * now, so this component just displays whatever it's given (0 for any slot
 * without real hardware writing to it yet).
 *
 * kWh = Ah x nominalVoltage / 1000, using THIS pack's real nominal voltage
 * (cellCount x 3.2V - 4 x 3.2 = 12.8V for the real device) rather than a
 * fixed 51.2, which is only correct for a 16S pack.
 */
export function EnergyTodayWidget({ chargedAh, dischargedAh, cellCount = 4 }) {
  const nominalVoltage = cellCount * NOMINAL_CELL_VOLT;
  const chargedKwh = ahToKwh(chargedAh, nominalVoltage);
  const usedKwh = ahToKwh(dischargedAh, nominalVoltage);

  return (
    <div className="flex flex-wrap justify-center gap-3">
      <EnergyPill icon={ArrowDownCircle} label="Charged" ah={chargedAh} kwh={chargedKwh} tone="emerald" />
      <EnergyPill icon={ArrowUpCircle} label="Used" ah={dischargedAh} kwh={usedKwh} tone="amber" />
    </div>
  );
}
