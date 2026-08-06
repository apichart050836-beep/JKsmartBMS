import React from "react";
import { Zap, Gauge, Activity, Thermometer } from "lucide-react";
import { statusTone } from "../lib/tone.js";

// A sensor alarms as soon as it crosses the configured OTP; it flags amber a
// few degrees before that so the approach is visible, not just the trip -
// same band SensorRow.jsx used before this tile moved here.
const ALERT_BAND_C = 5;
function channelTone(value, otpLimit) {
  if (value > otpLimit) return "critical";
  if (value > otpLimit - ALERT_BAND_C) return "warning";
  return "info";
}

/**
 * Power Flow Component
 * คำนวณและแสดงผลการไหลของพลังงาน Realtime (Charge + / Discharge -)
 */
export function PowerFlowChart({
    current = 0,
    socPercent = 0,
    remainingRuntime,
    timeToFullCharge,
    recommendedChargeCurrentA,
    recommendedDischargeCurrentA,
    configuredChargeCurrentA,
    configuredDischargeCurrentA,
    history = [],
    channels = [],
    temps = {},
    maxTemp = 0,
    otpLimit = 0,
    cycleAh = 0,
    cycleCount = 0,
}) {
    // Flow state for the header badge (Charge > 0.1A, Discharge < -0.1A, Idle)
    const isCharging = current > 0.1;
    const isDischarging = current < -0.1;

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
                {/* Card 1: Temperature (5-Channel) + Cycle Information - moved
                    here from SensorRow.jsx in place of the Charge Rate (+)
                    card, per explicit request. */}
                <div className="relative overflow-hidden rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--border)]">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-[var(--muted-foreground)]">
                            Temperature · {channels.length}-Ch
                        </span>
                        <Thermometer className="size-4 text-[var(--info)]" />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {channels.map((c) => {
                            const value = temps[c.key];
                            const t = statusTone(channelTone(value, otpLimit));
                            return (
                                <div key={c.key} className={`flex min-w-[44px] flex-1 flex-col items-center rounded-lg px-1.5 py-1 ${t.bg}`}>
                                    <span className="text-[9px] font-semibold text-[var(--muted-foreground)]">{c.label}</span>
                                    <span className={`text-xs font-bold tabular-nums ${t.fg}`}>{value.toFixed(1)}°</span>
                                </div>
                            );
                        })}
                    </div>
                    <div className="mt-3 flex justify-between border-t border-[var(--border)]/60 pt-2 text-[11px] text-[var(--muted-foreground)]">
                        <span>Cycle Capacity</span>
                        <span className="font-semibold text-[var(--foreground)] tabular-nums">{cycleAh.toFixed(1)} Ah</span>
                    </div>
                    <div className="mt-1.5 flex justify-between text-[11px] text-[var(--muted-foreground)]">
                        <span>Cycle Count</span>
                        <span className="font-semibold text-[var(--foreground)] tabular-nums">{cycleCount.toFixed(1)} cycles</span>
                    </div>
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

                {/* Card 3: Current Limits - live Discharge Rate readout
                    removed per explicit request, leaving just the
                    recommended/configured limit lines for both directions
                    (charge lines moved back in here from the old Card 1). */}
                <div className="relative overflow-hidden rounded-xl bg-[var(--card)] p-4 ring-1 ring-[var(--border)]">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-[var(--muted-foreground)]">Current Limits</span>
                        <Gauge className="size-4 text-[var(--brand)]" />
                    </div>
                    <div className="mt-3 space-y-1.5">
                        {typeof recommendedDischargeCurrentA === "number" && (
                            <div className="flex justify-between text-[11px] text-[var(--muted-foreground)]">
                                <span>แนะนำดิสชาร์จไม่เกิน (0.5C)</span>
                                <span className="font-semibold text-amber-500 tabular-nums">
                                    {recommendedDischargeCurrentA.toFixed(1)} A
                                </span>
                            </div>
                        )}
                        {typeof configuredDischargeCurrentA === "number" && (
                            <div className="flex justify-between text-[11px] text-[var(--muted-foreground)]">
                                <span>ค่าดิสชาร์จที่ตั้งไว้</span>
                                <span className="font-semibold text-amber-500 tabular-nums">
                                    {configuredDischargeCurrentA.toFixed(1)} A
                                </span>
                            </div>
                        )}
                        <div className="border-t border-[var(--border)]/60 pt-1.5" />
                        {typeof recommendedChargeCurrentA === "number" && (
                            <div className="flex justify-between text-[11px] text-[var(--muted-foreground)]">
                                <span>แนะนำชาร์จไม่เกิน (0.25C)</span>
                                <span className="font-semibold text-[var(--brand)] tabular-nums">
                                    {recommendedChargeCurrentA.toFixed(1)} A
                                </span>
                            </div>
                        )}
                        {typeof configuredChargeCurrentA === "number" && (
                            <div className="flex justify-between text-[11px] text-[var(--muted-foreground)]">
                                <span>ค่าชาร์จที่ตั้งไว้</span>
                                <span className="font-semibold text-[var(--brand)] tabular-nums">
                                    {configuredChargeCurrentA.toFixed(1)} A
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
}