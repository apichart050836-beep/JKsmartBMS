import React from "react";
import {
    Zap,
    Activity,
    Battery,
    RefreshCw,
    Power,
    BellRing,
} from "lucide-react";
import { statusTone } from "../lib/tone.js";
import { ElectricGauge } from "../ElectricGauge.jsx";

// Matches batteryHealthScore.js's 5 rating tiers - Excellent=green,
// Very Good=light green, Good=yellow, Fair=orange, Poor=red.
const HEALTH_TONE_TEXT = {
    excellent: "text-emerald-600",
    "very-good": "text-emerald-400",
    good: "text-yellow-500",
    fair: "text-orange-500",
    poor: "text-rose-500",
};
const HEALTH_TONE_BG = {
    excellent: "bg-emerald-600",
    "very-good": "bg-emerald-400",
    good: "bg-yellow-500",
    fair: "bg-orange-500",
    poor: "bg-rose-500",
};

export function SystemHero({
    deviceLabel,
    hubAccount,
    isOnline,
    onRefresh,
    cellCount,
    batteryType = "LiFePO4",
    maxBalancerCurrentA,
    power = 0,
    status = "Standby",
    current = 0,
    packVoltage = 0,
    ratedCapacityAh = 50,
    remainingAh = 0,
    socPercent = 0,
    cellAvgVoltage = 0,
    soh = 100,
    healthScore,
    chargedAh = 0,
    dischargedAh = 0,
    chargeMOS = true,
    dischargeMOS = true,
    balancerOn = false,
    balancerCurrentA = 0,
    voltDiffMv = 0,
    voltDiffTone = "brand",
    now = new Date(),
    alarms = [],
    onOpenAlarms,
}) {
    const isCharging = status === "Charging";

    return (
        <div className="rounded-3xl bg-[var(--card)] p-5 shadow-sm ring-1 ring-[var(--border)] md:p-6">
            {/* Header Info */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
                <div>
                    <div className="flex items-center gap-2">
                        <h1 className="text-lg font-bold text-[var(--foreground)]">{deviceLabel}</h1>
                        <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${isOnline ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500"
                                }`}
                        >
                            <span className={`size-1.5 rounded-full ${isOnline ? "bg-emerald-500" : "bg-rose-500"}`} />
                            {isOnline ? "Online" : "Offline"}
                        </span>
                        {onRefresh && (
                            <button
                                type="button"
                                onClick={onRefresh}
                                title="Refresh"
                                className="group inline-flex size-8 cursor-pointer items-center justify-center rounded-xl bg-[var(--info-10)] text-[var(--info)] ring-1 ring-[var(--info)]/30 transition-all duration-150 hover:bg-[var(--info)] hover:text-white hover:shadow-md active:scale-95"
                            >
                                <RefreshCw className="size-4 transition-transform duration-500 group-hover:rotate-180" />
                            </button>
                        )}
                        {onOpenAlarms && (
                            <button
                                type="button"
                                onClick={onOpenAlarms}
                                title={alarms.length ? `${alarms.length} active alarm${alarms.length === 1 ? "" : "s"}` : "No active alarms"}
                                className={`group relative inline-flex size-8 cursor-pointer items-center justify-center rounded-xl ring-1 transition-all duration-150 hover:shadow-md active:scale-95 ${
                                    alarms.length
                                        ? "bg-red-500/10 text-red-500 ring-red-500/30 hover:bg-red-500 hover:text-white"
                                        : "bg-[var(--muted)] text-[var(--muted-foreground)] ring-[var(--border)] hover:bg-[var(--muted-foreground)]/20"
                                }`}
                            >
                                <BellRing className={`size-4 ${alarms.length ? "animate-[wiggle_1.2s_ease-in-out_infinite]" : ""}`} />
                                {alarms.length > 0 && (
                                    <span className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white ring-2 ring-[var(--card)]">
                                        {alarms.length}
                                    </span>
                                )}
                            </button>
                        )}
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                        {batteryType} · {cellCount}S · Max Balancer {maxBalancerCurrentA}A
                    </p>
                </div>

                {/* Status Switches Indicators */}
                <div className="flex items-center gap-2">
                    {/* Charge Status */}
                    <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ${chargeMOS ? "bg-emerald-500/10 text-emerald-500" : "bg-zinc-500/10 text-zinc-400"}`}>
                        <Zap className="size-3.5" />
                        <span>Charge {chargeMOS ? "ON" : "OFF"}</span>
                    </span>

                    {/* Discharge Status */}
                    <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ${dischargeMOS ? "bg-emerald-500/10 text-emerald-500" : "bg-zinc-500/10 text-zinc-400"}`}>
                        <Power className="size-3.5" />
                        <span>Discharge {dischargeMOS ? "ON" : "OFF"}</span>
                    </span>

                    {/* Balance Status */}
                    <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ${balancerOn ? "bg-blue-500/10 text-blue-500" : "bg-zinc-500/10 text-zinc-400"}`}>
                        <RefreshCw className={`size-3.5 ${balancerOn ? "animate-spin" : ""}`} />
                        <span>Balance {balancerOn ? "ON" : "OFF"}</span>
                    </span>
                </div>
            </div>

            {/* Main Grid Section */}
            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">

                {/* ========================================================= */}
                {/* กล่อง 1: SOC + SOH                                        */}
                {/* ========================================================= */}
                <div className="flex flex-col justify-between rounded-2xl bg-[var(--card)] p-4 ring-1 ring-[var(--border)]">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-[var(--muted-foreground)]">State of Charge (SOC)</span>
                        <span className="rounded-lg bg-[var(--card)] p-1 text-[var(--muted-foreground)] shadow-xs ring-1 ring-[var(--border)]">
                            <Battery className="size-3.5 text-emerald-500" />
                        </span>
                    </div>

                    <div className="my-2 flex items-center justify-center gap-3">
                        <ElectricGauge
                            socPercent={socPercent}
                            isCharging={isCharging}
                        />
                        <div className="flex flex-col justify-center">
                            <div className="text-2xl font-extrabold text-[var(--foreground)] tabular-nums">
                                {socPercent.toFixed(1)}%
                            </div>
                            <div className="mt-0.5 text-xs text-[var(--muted-foreground)] tabular-nums">
                                {remainingAh.toFixed(1)} / {ratedCapacityAh} Ah
                            </div>
                        </div>
                    </div>

                    <div className="border-t border-[var(--border)]/80 pt-2">
                        <div className="mb-1 flex items-center justify-between text-xs">
                            <span className="font-semibold text-[var(--muted-foreground)]">State of Health (SOH)</span>
                            <span className="font-bold text-[var(--foreground)] tabular-nums">{soh}%</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
                            <div
                                className={`h-full rounded-full transition-all duration-500 ${soh >= 80 ? "bg-emerald-500" : soh >= 50 ? "bg-amber-500" : "bg-rose-500"
                                    }`}
                                style={{ width: `${Math.min(Math.max(soh, 0), 100)}%` }}
                            />
                        </div>
                    </div>

                    {healthScore?.score != null && (
                        <div className="mt-2 border-t border-[var(--border)]/80 pt-2">
                            <div className="mb-1 flex items-center justify-between text-xs">
                                <span className="font-semibold text-[var(--muted-foreground)]">Battery Health Score</span>
                                <span className={`font-bold tabular-nums ${HEALTH_TONE_TEXT[healthScore.tone] ?? "text-[var(--foreground)]"}`}>
                                    {healthScore.score}/100 · {healthScore.rating}
                                </span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
                                <div
                                    className={`h-full rounded-full transition-all duration-500 ${HEALTH_TONE_BG[healthScore.tone] ?? "bg-[var(--muted-foreground)]"}`}
                                    style={{ width: `${Math.min(Math.max(healthScore.score, 0), 100)}%` }}
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* ========================================================= */}
                {/* กล่อง 2: Pack Voltage & Current                           */}
                {/* ========================================================= */}
                <div className="flex flex-col justify-between rounded-2xl bg-[var(--card)] p-4 ring-1 ring-[var(--border)]">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-[var(--muted-foreground)]">Pack Voltage & Current</span>
                        <span className="rounded-lg bg-[var(--card)] p-1 text-[var(--muted-foreground)] shadow-xs ring-1 ring-[var(--border)]">
                            <Activity className="size-3.5" />
                        </span>
                    </div>

                    <div className="my-2.5 space-y-2">
                        <div className="flex items-center justify-between rounded-xl bg-[var(--card)] p-2.5 shadow-xs ring-1 ring-[var(--border)]/60">
                            <div className="flex items-center gap-2.5">
                                <div className="flex size-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
                                    <Zap className="size-4" />
                                </div>
                                <div>
                                    <div className="text-[10px] font-medium text-[var(--muted-foreground)]">Voltage</div>
                                    <div className="text-lg font-extrabold text-[var(--foreground)] tabular-nums leading-none">
                                        {packVoltage.toFixed(2)} <span className="text-xs font-semibold text-[var(--muted-foreground)]">V</span>
                                    </div>
                                </div>
                            </div>
                            <span className="rounded-md bg-[var(--muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]">
                                {cellCount ? `${(cellCount * 3.2).toFixed(0)}V Sys` : "System"}
                            </span>
                        </div>

                        <div className="relative flex items-center justify-between overflow-hidden rounded-xl bg-[var(--card)] p-2.5 shadow-xs ring-1 ring-[var(--border)]/60">
                            {/* Flowing current animation - a soft stripe that drifts across the
                                card, direction/color/speed tied to real current: right-to-left
                                while charging, left-to-right while discharging, still when idle. */}
                            {current !== 0 && (
                                <div
                                    className={`pointer-events-none absolute inset-0 opacity-40 ${current > 0 ? "animate-[flow-left_1.4s_linear_infinite]" : "animate-[flow-right_1.4s_linear_infinite]"
                                        }`}
                                    style={{
                                        backgroundImage: `repeating-linear-gradient(90deg, transparent 0px, transparent 10px, ${current > 0 ? "rgba(16,185,129,0.35)" : "rgba(245,158,11,0.35)"
                                            } 10px, transparent 22px)`,
                                        backgroundSize: "44px 100%",
                                    }}
                                />
                            )}
                            <div className="relative flex items-center gap-2.5">
                                <div className={`relative flex size-8 items-center justify-center rounded-lg ${current > 0 ? "bg-emerald-500/10 text-emerald-500" : current < 0 ? "bg-amber-500/10 text-amber-500" : "bg-zinc-500/10 text-zinc-400"
                                    }`}>
                                    {current !== 0 && (
                                        <span className={`absolute inline-flex size-full animate-ping rounded-lg opacity-40 ${current > 0 ? "bg-emerald-400" : "bg-amber-400"}`} />
                                    )}
                                    <Activity className="relative size-4" />
                                </div>
                                <div>
                                    <div className="text-[10px] font-medium text-[var(--muted-foreground)]">Current</div>
                                    <div className={`text-lg font-extrabold tabular-nums leading-none ${current > 0 ? "text-emerald-500" : current < 0 ? "text-amber-500" : "text-[var(--foreground)]"
                                        }`}>
                                        {current > 0 ? `+${current.toFixed(2)}` : current.toFixed(2)} <span className="text-xs font-semibold text-[var(--muted-foreground)]">A</span>
                                    </div>
                                </div>
                            </div>
                            <span className={`relative rounded-md px-2 py-0.5 text-[10px] font-bold ${current > 0
                                ? "bg-emerald-500/10 text-emerald-500"
                                : current < 0
                                    ? "bg-amber-500/10 text-amber-500"
                                    : "bg-zinc-500/10 text-zinc-400"
                                }`}>
                                {current > 0 ? "Charging" : current < 0 ? "Discharging" : "Idle"}
                            </span>
                        </div>
                    </div>
                    <style>{`
                        @keyframes flow-left {
                            from { background-position: 44px 0; }
                            to { background-position: 0 0; }
                        }
                        @keyframes flow-right {
                            from { background-position: 0 0; }
                            to { background-position: 44px 0; }
                        }
                        @keyframes wiggle {
                            0%, 100% { transform: rotate(0deg); }
                            20% { transform: rotate(-12deg); }
                            40% { transform: rotate(10deg); }
                            60% { transform: rotate(-6deg); }
                            80% { transform: rotate(4deg); }
                        }
                    `}</style>

                    <div className="flex items-center justify-between border-t border-[var(--border)]/80 pt-2.5 text-xs text-[var(--muted-foreground)]">
                        <span>Average Cell</span>
                        <span className="font-bold text-[var(--foreground)] tabular-nums">
                            {cellAvgVoltage.toFixed(3)} <span className="text-[10px] font-normal text-[var(--muted-foreground)]">V</span>
                        </span>
                    </div>

                    <div className="mt-1.5 flex items-center justify-between text-xs text-[var(--muted-foreground)]">
                        <span>Diff Volt (ΔV)</span>
                        <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                            voltDiffMv <= 15
                                ? "bg-emerald-500/10 text-emerald-500"
                                : voltDiffMv <= 30
                                    ? "bg-amber-500/10 text-amber-500"
                                    : "bg-rose-500/10 text-rose-500"
                        }`}>
                            {voltDiffMv} mV
                        </span>
                    </div>

                    <div className="mt-1.5 flex items-center justify-between text-xs text-[var(--muted-foreground)]">
                        <span>Bal Current</span>
                        <span className="font-bold text-[var(--foreground)] tabular-nums">
                            {balancerCurrentA.toFixed(2)} <span className="text-[10px] font-normal text-[var(--muted-foreground)]">A</span>
                        </span>
                    </div>
                </div>

                {/* ========================================================= */}
                {/* กล่อง 3: Power Output (เพิ่มสเกลตัวเลขรอบเกจ)            */}
                {/* ========================================================= */}
                <div className="flex flex-col justify-between rounded-2xl bg-[var(--card)] p-4 ring-1 ring-[var(--border)]">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-[var(--muted-foreground)]">Power</span>
                        <span className="rounded-lg bg-[var(--card)] p-1 text-[var(--muted-foreground)] shadow-xs ring-1 ring-[var(--border)]">
                            <Zap className="size-3.5 text-amber-500" />
                        </span>
                    </div>

                    <div className="my-1 flex flex-col items-center justify-center">
                        <div className="relative flex items-center justify-center">
                            {/* Ambient glow - pulses behind the dial whenever power is
                                actually flowing, colored by direction. Pure flair layer,
                                doesn't touch the real gauge math below it. */}
                            {power !== 0 && (
                                <div
                                    className="pointer-events-none absolute size-40 animate-pulse rounded-full blur-2xl"
                                    style={{ background: current > 0 ? "rgba(16,185,129,0.35)" : "rgba(245,158,11,0.35)" }}
                                />
                            )}
                            <svg className="relative size-48" viewBox="0 0 110 110">
                                {/* วงโค้งเกจวัดพลังงาน (หมุน -210 deg รอบจุดศูนย์กลาง 55, 55) */}
                                <g transform="rotate(-210 55 55)">
                                    {/* แถบพื้นหลัง (Background Track) */}
                                    <circle
                                        cx="55"
                                        cy="55"
                                        r="37"
                                        stroke="currentColor"
                                        strokeWidth="6"
                                        className="text-[var(--border)]"
                                        fill="transparent"
                                        strokeDasharray="155 235"
                                        strokeLinecap="round"
                                    />
                                    {/* แถบระดับพลังงาน (Dynamic Power Arc) */}
                                    <circle
                                        cx="55"
                                        cy="55"
                                        r="37"
                                        stroke="url(#powerGaugeGradient)"
                                        strokeWidth="6"
                                        fill="transparent"
                                        strokeDasharray="155 235"
                                        strokeDashoffset={155 - (155 * Math.min(Math.abs(power), 6000)) / 6000}
                                        strokeLinecap="round"
                                        className="transition-all duration-700 ease-out"
                                    />
                                </g>

                                <defs>
                                    {/* Charging = green, discharging = orange - matches the
                                        charge/discharge color convention used everywhere else
                                        in the dashboard (Pack Voltage & Current, Charge/Discharge
                                        chart, etc), driven by the real current sign. */}
                                    <linearGradient id="powerGaugeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                        {current > 0 ? (
                                            <>
                                                <stop offset="0%" stopColor="#6ee7b7" />
                                                <stop offset="100%" stopColor="#10b981" />
                                            </>
                                        ) : current < 0 ? (
                                            <>
                                                <stop offset="0%" stopColor="#fcd34d" />
                                                <stop offset="100%" stopColor="#f59e0b" />
                                            </>
                                        ) : (
                                            <>
                                                <stop offset="0%" stopColor="#d4d4d8" />
                                                <stop offset="100%" stopColor="#a1a1aa" />
                                            </>
                                        )}
                                    </linearGradient>
                                </defs>

                                {/* Glowing tip dot - rides the exact end of the power arc, a
                                    little "comet head" so the live level reads at a glance
                                    even before the eye finds the arc's color gradient. */}
                                {power !== 0 &&
                                    (() => {
                                        const frac = Math.min(Math.abs(power), 6000) / 6000;
                                        const tipDeg = -210 + frac * 240;
                                        const tipRad = (tipDeg * Math.PI) / 180;
                                        const tx = 55 + 37 * Math.cos(tipRad);
                                        const ty = 55 + 37 * Math.sin(tipRad);
                                        return (
                                            <circle cx={tx} cy={ty} r="3.2" fill="#fff">
                                                <animate attributeName="opacity" values="1;0.4;1" dur="1s" repeatCount="indefinite" />
                                            </circle>
                                        );
                                    })()}

                                {/* สเกลตัวเลข + ขีดบอกระดับรอบเกจ (Gauge Scale Ticks & Labels) */}
                                {[
                                    { val: "0", angle: 150, showLabel: true },
                                    { val: "1k", angle: 190, showLabel: true },
                                    { val: "2k", angle: 230, showLabel: true },
                                    { val: "3k", angle: 270, showLabel: true },
                                    { val: "4k", angle: 310, showLabel: true },
                                    { val: "5k", angle: 350, showLabel: true },
                                    { val: "6k", angle: 30, showLabel: true },
                                ].map(({ val, angle, showLabel }) => {
                                    const rad = (angle * Math.PI) / 180;
                                    const r1 = 41; // จุดเริ่มต้นขีดสเกล
                                    const r2 = showLabel ? 44.5 : 43; // ความยาวขีดสเกล
                                    const rText = 50; // ระยะรัศมีวางตัวเลข

                                    const x1 = 55 + r1 * Math.cos(rad);
                                    const y1 = 55 + r1 * Math.sin(rad);
                                    const x2 = 55 + r2 * Math.cos(rad);
                                    const y2 = 55 + r2 * Math.sin(rad);
                                    const xT = 55 + rText * Math.cos(rad);
                                    const yT = 55 + rText * Math.sin(rad);

                                    return (
                                        <g key={angle}>
                                            {/* ขีดสเกล */}
                                            <line
                                                x1={x1}
                                                y1={y1}
                                                x2={x2}
                                                y2={y2}
                                                stroke="currentColor"
                                                strokeWidth={showLabel ? "1" : "0.6"}
                                                className={showLabel ? "text-[var(--muted-foreground)]" : "text-[var(--border)]"}
                                            />
                                            {/* ตัวเลขสเกล */}
                                            {showLabel && (
                                                <text
                                                    x={xT}
                                                    y={yT}
                                                    textAnchor="middle"
                                                    dominantBaseline="central"
                                                    className="fill-[var(--muted-foreground)] text-[4.2px] font-bold tabular-nums"
                                                >
                                                    {val}
                                                </text>
                                            )}
                                        </g>
                                    );
                                })}
                            </svg>

                            {/* เนื้อหาตรงกลางเกจ: Watt + Amp */}
                            <div className="absolute flex flex-col items-center justify-center text-center">
                                <span className="text-2xl font-black leading-none text-[var(--foreground)] tabular-nums">
                                    {Math.abs(power).toFixed(0)}
                                </span>
                                <span className="mt-0.5 text-[10px] font-bold tracking-wider text-[var(--muted-foreground)]">WATT</span>
                                
                                {/* Badge แสดงค่า Amp */}
                                <span className={`mt-1.5 rounded-md px-2 py-0.5 text-xs font-bold tabular-nums shadow-xs ring-1 ring-[var(--border)]/60 ${
                                    current > 0 
                                        ? "bg-emerald-500/10 text-emerald-500" 
                                        : current < 0 
                                            ? "bg-amber-500/10 text-amber-500" 
                                            : "bg-[var(--card)] text-[var(--muted-foreground)]"
                                }`}>
                                    {current > 0 ? `+${current.toFixed(1)}` : current.toFixed(1)} A
                                </span>
                            </div>
                        </div>

                        {/* Status Badge - driven by the real current sign, not the
                            charge/discharge MOSFET enable switches (`status` prop):
                            a pack can have discharge ON while actually sitting idle,
                            or be mid-discharge while still MOSFET-labeled otherwise -
                            this badge should say what's actually happening right now. */}
                        <div className="-mt-3 inline-flex items-center gap-1.5 rounded-full bg-[var(--card)] px-3.5 py-1 text-xs font-semibold shadow-xs ring-1 ring-[var(--border)]">
                            <span className={`size-2 rounded-full ${current > 0
                                ? "bg-emerald-500 animate-pulse"
                                : current < 0
                                    ? "bg-amber-500 animate-pulse"
                                    : "bg-zinc-400"
                                }`} />
                            <span>{current > 0 ? "Charging" : current < 0 ? "Discharging" : "Idle"}</span>
                        </div>
                    </div>

                    <div className="flex items-center justify-between border-t border-[var(--border)]/80 pt-2 text-xs text-[var(--muted-foreground)]">
                        <span>Max Gauge Limit</span>
                        <span className="font-bold text-[var(--foreground)] tabular-nums">6,000 W</span>
                    </div>
                </div>

            </div>
        </div>
    );
}
