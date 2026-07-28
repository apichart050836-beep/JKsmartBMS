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
    timeToFullCharge,
    recommendedChargeCurrentA,
    recommendedDischargeCurrentA,
    configuredChargeCurrentA,
    configuredDischargeCurrentA,
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
                    {typeof recommendedChargeCurrentA === "number" && (
                        <div className="mt-1.5 flex justify-between text-[11px] text-[var(--muted-foreground)]">
                            <span>แนะนำไม่เกิน (0.25C)</span>
                            <span className="font-semibold text-[var(--foreground)] tabular-nums">
                                {recommendedChargeCurrentA.toFixed(1)} A
                            </span>
                        </div>
                    )}
                    {typeof configuredChargeCurrentA === "number" && (
                        <div className="mt-1.5 flex justify-between text-[11px] text-[var(--muted-foreground)]">
                            <span>ค่าชาร์จที่ตั้งไว้</span>
                            <span className="font-semibold text-[var(--foreground)] tabular-nums">
                                {configuredChargeCurrentA.toFixed(1)} A
                            </span>
                        </div>
                    )}
                </div>

                {/* Card 2: Main Power Hub Center */}
                <div className="flex flex-col justify-center gap-3 rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--border)]">
                    <div className="text-center">
                        <div className="flex items-center justify-center gap-1.5">
                            <Activity className="size-3.5 text-[var(--brand)]" />
                            <span className="text-xs font-semibold text-[var(--muted-foreground)]">Remaining Runtime</span>
                        </div>
                        <div
                            className={`mt-1 text-[22px] font-extrabold tabular-nums ${remainingRuntime?.state === "charging"
                                    ? "text-emerald-500"
                                    : remainingRuntime?.state === "standby"
                                        ? "text-[var(--muted-foreground)]"
                                        : remainingRuntime?.state === "discharging"
                                            ? "text-amber-500"
                                            : "text-[var(--foreground)]"
                                }`}
                        >
                            {remainingRuntime?.label ?? "-"}
                        </div>
                    </div>
                    <div className="border-t border-[var(--border)]/60 pt-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                            <Zap className="size-3.5 text-[var(--brand)]" />
                            <span className="text-xs font-semibold text-[var(--muted-foreground)]">Time to Full Charge</span>
                        </div>
                        <div
                            className={`mt-1 text-[22px] font-extrabold tabular-nums ${timeToFullCharge?.state === "charging"
                                    ? "text-emerald-500"
                                    : timeToFullCharge?.state === "standby"
                                        ? "text-[var(--muted-foreground)]"
                                        : timeToFullCharge?.state === "not_charging"
                                            ? "text-amber-500"
                                            : "text-[var(--foreground)]"
                                }`}
                        >
                            {timeToFullCharge?.label ?? "-"}
                        </div>
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
                    {typeof recommendedDischargeCurrentA === "number" && (
                        <div className="mt-1.5 flex justify-between text-[11px] text-[var(--muted-foreground)]">
                            <span>แนะนำไม่เกิน (0.5C)</span>
                            <span className="font-semibold text-[var(--foreground)] tabular-nums">
                                {recommendedDischargeCurrentA.toFixed(1)} A
                            </span>
                        </div>
                    )}
                    {typeof configuredDischargeCurrentA === "number" && (
                        <div className="mt-1.5 flex justify-between text-[11px] text-[var(--muted-foreground)]">
                            <span>ค่าดิสชาร์จที่ตั้งไว้</span>
                            <span className="font-semibold text-[var(--foreground)] tabular-nums">
                                {configuredDischargeCurrentA.toFixed(1)} A
                            </span>
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
}