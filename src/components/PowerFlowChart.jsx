import React from "react";
import { Zap, ArrowUpRight, ArrowDownRight, Activity } from "lucide-react";

/**
 * Power Flow Component
 * คำนวณและแสดงผลการไหลของพลังงาน Realtime (Charge + / Discharge -)
 */
export function PowerFlowChart({
    packVoltage = 0,
    current = 0,
    chargedAh = 0,
    dischargedAh = 0,
    chargedWh = 0,
    dischargedWh = 0,
    socPercent = 0,
    remainingRuntime,
    history = [],
}) {
    // 1. คำนวณ Power Realtime (P = V * I)
    const rawPowerW = packVoltage * current;
    const absPowerW = Math.abs(rawPowerW);

    // 2. กำหนดสถานะ Flow (Charge > 0.1A, Discharge < -0.1A, Idle)
    const isCharging = current > 0.1;
    const isDischarging = current < -0.1;

    // 3. Real energy today so far - chargedWh/dischargedWh come from the
    // server's actual V x I x t integration over telemetry_log (see
    // useDailyEnergy.js / server/routes/history.js), not an Ah x
    // current-instant-voltage approximation.

    // 4. คำนวณ Net Energy Balance (สุทธิ)
    const netAh = chargedAh - dischargedAh;

    return (
        <section className="rounded-2xl bg-[var(--card)] p-5 shadow-sm ring-1 ring-[var(--border)] md:p-6">
            {/* Header */}
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <div className="flex size-8 items-center justify-center rounded-xl bg-[var(--brand)]/10 text-[var(--brand)]">
                        <Zap className="size-4" />
                    </div>
                    <div>
                        <h2 className="text-sm font-semibold text-[var(--foreground)]">Power Flow & Energy Tracker</h2>
                        <p className="text-[11px] text-[var(--muted-foreground)]">คำนวณการไหลของกำลังไฟฟ้า Realtime</p>
                    </div>
                </div>

                {/* Status Badge */}
                <div className="flex items-center gap-2">
                    <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${isCharging
                                ? "bg-emerald-500/10 text-emerald-500 ring-1 ring-emerald-500/20"
                                : isDischarging
                                    ? "bg-amber-500/10 text-amber-500 ring-1 ring-amber-500/20"
                                    : "bg-[var(--muted)] text-[var(--muted-foreground)] ring-1 ring-[var(--border)]"
                            }`}
                    >
                        <span
                            className={`size-2 rounded-full ${isCharging
                                    ? "animate-pulse bg-emerald-500"
                                    : isDischarging
                                        ? "animate-pulse bg-amber-500"
                                        : "bg-gray-400"
                                }`}
                        />
                        {isCharging ? "Charging (+)" : isDischarging ? "Discharging (-)" : "Standby"}
                    </span>
                </div>
            </div>

            {/* Main Flow Diagram / Summary */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {/* Card 1: Charge Inflow (+) */}
                <div
                    className={`relative overflow-hidden rounded-xl p-4 ring-1 transition-all ${isCharging
                            ? "bg-emerald-500/5 ring-emerald-500/30"
                            : "bg-[var(--card)] ring-[var(--border)]"
                        }`}
                >
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-[var(--muted-foreground)]">Charge Rate (+)</span>
                        <ArrowUpRight className={`size-4 ${isCharging ? "text-emerald-500" : "text-gray-400"}`} />
                    </div>
                    <div className="mt-2 flex items-baseline gap-1">
                        <span className="text-2xl font-bold text-[var(--foreground)] tabular-nums">
                            {isCharging ? current.toFixed(1) : "0.0"}
                        </span>
                        <span className="text-xs text-[var(--muted-foreground)]">A</span>
                        <span className="ml-auto text-xs font-semibold text-emerald-500 tabular-nums">
                            {isCharging ? `+${absPowerW.toFixed(0)} W` : "0 W"}
                        </span>
                    </div>
                    <div className="mt-3 flex justify-between border-t border-[var(--border)]/60 pt-2 text-[11px] text-[var(--muted-foreground)]">
                        <span>Daily Charged:</span>
                        <span className="font-semibold text-[var(--foreground)] tabular-nums">
                            {chargedAh.toFixed(1)} Ah ({(chargedWh / 1000).toFixed(2)} kWh)
                        </span>
                    </div>
                </div>

                {/* Card 2: Main Power Hub Center */}
                <div className="flex flex-col justify-between rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--border)]">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-[var(--muted-foreground)]">Remaining Runtime</span>
                        <Activity className="size-4 text-[var(--brand)]" />
                    </div>
                    <div className="my-2 text-center">
                        <div
                            className={`text-2xl font-extrabold tabular-nums ${remainingRuntime?.state === "charging"
                                    ? "text-emerald-500"
                                    : remainingRuntime?.state === "standby"
                                        ? "text-[var(--muted-foreground)]"
                                        : "text-[var(--foreground)]"
                                }`}
                        >
                            {remainingRuntime?.label ?? "-"}
                        </div>
                        <div className="text-xs text-[var(--muted-foreground)] tabular-nums">
                            {absPowerW.toFixed(0)} Watts @ {packVoltage.toFixed(2)}V
                        </div>
                    </div>
                    <div className="flex items-center justify-around border-t border-[var(--border)]/60 pt-2 text-[11px]">
                        <span className="text-[var(--muted-foreground)]">Net Balance:</span>
                        <span
                            className={`font-bold tabular-nums ${netAh >= 0 ? "text-emerald-500" : "text-amber-500"
                                }`}
                        >
                            {netAh >= 0 ? `+${netAh.toFixed(1)}` : netAh.toFixed(1)} Ah
                        </span>
                    </div>
                </div>

                {/* Card 3: Discharge Outflow (-) */}
                <div
                    className={`relative overflow-hidden rounded-xl p-4 ring-1 transition-all ${isDischarging
                            ? "bg-amber-500/5 ring-amber-500/30"
                            : "bg-[var(--card)] ring-[var(--border)]"
                        }`}
                >
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-[var(--muted-foreground)]">Discharge Rate (-)</span>
                        <ArrowDownRight className={`size-4 ${isDischarging ? "text-amber-500" : "text-gray-400"}`} />
                    </div>
                    <div className="mt-2 flex items-baseline gap-1">
                        <span className="text-2xl font-bold text-[var(--foreground)] tabular-nums">
                            {isDischarging ? current.toFixed(1) : "0.0"}
                        </span>
                        <span className="text-xs text-[var(--muted-foreground)]">A</span>
                        <span className="ml-auto text-xs font-semibold text-amber-500 tabular-nums">
                            {isDischarging ? `-${absPowerW.toFixed(0)} W` : "0 W"}
                        </span>
                    </div>
                    <div className="mt-3 flex justify-between border-t border-[var(--border)]/60 pt-2 text-[11px] text-[var(--muted-foreground)]">
                        <span>Daily Discharged:</span>
                        <span className="font-semibold text-[var(--foreground)] tabular-nums">
                            {dischargedAh.toFixed(1)} Ah ({(dischargedWh / 1000).toFixed(2)} kWh)
                        </span>
                    </div>
                </div>
            </div>
        </section>
    );
}