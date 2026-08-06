import React, { useState, useEffect} from "react";
import axios from 'axios';
import {
    Zap,
    Activity,
    Battery,
    RefreshCw,
    Power,
    BellRing,
    Cpu,
    X,
    Upload,
    CheckCircle2,
    AlertTriangle,
    Server,
    KeyRound,
    BatteryCharging, PlugZap ,Lightbulb
} from "lucide-react";
import { statusTone } from "../lib/tone.js";
import { ElectricGauge } from "../ElectricGauge.jsx";
 

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
    deviceMac,
    info, // <-- รับวัตถุ info (ห้ามระบุ deviceIp ซ้ำใน Props นี้)
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
    chargeStatus = null,
    balancerOn = false,
    balancerCurrentA = 0,
    voltDiffMv = 0,
    voltDiffTone = "brand",
    now = new Date(),
    alarms = [],
    onOpenAlarms,
    onFirmwareUpdate,
    // Real field, written by the ESP32 itself (esp_firmware_version text
    // sensor) - distinct from info.software_version, which is the JK BMS
    // chip's own version, not the ESP32's. Explicit `firmwareVersion` prop
    // (if ever passed) still wins; falls back to a placeholder only when
    // neither is available (e.g. this device has never reported it).
    firmwareVersion = info?.esp_firmware_version ? `v${info.esp_firmware_version}` : "v1.2.4.3",
}) {
    const isCharging = status === "Charging";
  
    // 1. ดึง IP จาก info.esp_ip_address มาเตรียมไว้
    const initialIp = info?.esp_ip_address || "";

    // 2. State สำหรับ Firmware Update Modal
    const [deviceIp, setDeviceIp] = useState(initialIp); // <-- ประกาศแค่จุดนี้จุดเดียว
    const [otaPassword, setOtaPassword] = useState("");
    const [selectedFile, setSelectedFile] = useState(null);

    const [updateProgress, setUpdateProgress] = useState(0);

    const [statusMessage, setStatusMessage] = useState("");

    const [isModalOpen, setIsModalOpen] = useState(false);

    // 3. อัปเดต deviceIp ทุกครั้งที่ info.esp_ip_address เปลี่ยน (สลับ BMS tab
    // ก็นับด้วย - ก่อนหน้านี้ผูก effect นี้ไว้กับ isFwModalOpen ที่เป็น state
    // ค้างจากโค้ดเก่า ไม่มีใครสั่ง setIsFwModalOpen(true) อีกแล้วหลังเปลี่ยน
    // มาใช้ isModalOpen เลย effect นี้เลยไม่เคยทำงาน ทำให้ deviceIp ค้างอยู่ที่
    // ค่าตอน mount ครั้งแรกตลอด ไม่ว่าจะสลับไปดู BMS ตัวไหนก็ตาม - ยืนยันแล้ว
    // จาก user report ที่ IP ไม่เปลี่ยนตอนสลับแท็บ
    useEffect(() => {
        setDeviceIp(info?.esp_ip_address || "");
    }, [info?.esp_ip_address]);

    const targetIp = deviceIp;

return (
        <div className="rounded-3xl bg-[var(--card)] p-5 shadow-sm ring-1 ring-[var(--border)] md:p-6">
            {/* Top Action Bar: รวมปุ่มควบคุมทั้งหมดไว้บนสุด */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
                <div className="flex flex-wrap items-center gap-2">
                    {/* Action Buttons */}
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

                    {/* เรียกใช้งาน Modal และส่ง Props ที่จำเป็นเข้าไป */}
                    <OTAUpdateModal 
                        isOpen={isModalOpen} 
                        onClose={() => setIsModalOpen(false)} 
                        deviceIp={targetIp} 
                    />
                </div>

                {/* Status Switches Indicators (ย้ายมาฝั่งขวาของแถวบนเพื่อให้บาลานซ์) */}
                <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ${chargeMOS ? "bg-emerald-500/10 text-emerald-500" : "bg-zinc-500/10 text-zinc-400"}`}>
                        <Zap className="size-3.5" />
                        <span>
                            Charge {chargeMOS ? "ON" : "OFF"}
                            {chargeMOS && chargeStatus ? ` · ${chargeStatus}` : ""}
                        </span>
                    </span>

                    <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ${dischargeMOS ? "bg-emerald-500/10 text-emerald-500" : "bg-zinc-500/10 text-zinc-400"}`}>
                        <Power className="size-3.5" />
                        <span>Discharge {dischargeMOS ? "ON" : "OFF"}</span>
                    </span>

                    <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ${balancerOn ? "bg-blue-500/10 text-blue-500" : "bg-zinc-500/10 text-zinc-400"}`}>
                        <RefreshCw className={`size-3.5 ${balancerOn ? "animate-spin" : ""}`} />
                        <span>Balance {balancerOn ? "ON" : "OFF"}</span>
                    </span>
                </div>
            </div>

            {/* Header Info: ชื่ออุปกรณ์ สถานะ Online/Offline และปุ่มอัปเดต OTA อยู่ขวาสุด */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2">
                        <h1 className="text-lg font-bold text-[var(--foreground)]">{deviceLabel}</h1>
                        <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                                isOnline ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500"
                            }`}
                        >
                            <span className={`size-1.5 rounded-full ${isOnline ? "bg-emerald-500" : "bg-rose-500"}`} />
                            {isOnline ? "Online" : "Offline"}
                        </span>
                    </div>

                    <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                        {deviceMac && <span className="font-mono">{deviceMac} · </span>}
                        {batteryType} · {cellCount}S · Max Balancer {maxBalancerCurrentA}A · <span className="font-semibold text-[var(--foreground)]">FW {firmwareVersion}</span>
                    </p>
                </div>

                {/* ปุ่มสำหรับคลิกเปิด Modal อัปเดตเฟิร์มแวร์ (ย้ายมาอยู่แถวเดียวกับ Online/Offline และชิดขวาสุด) */}
                <button
                    type="button"
                    onClick={() => setIsModalOpen(true)}
                    className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand)] px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:opacity-90 transition-all active:scale-95"
                >
                    <Cpu className="size-4" />
                    <span>อัปเดต OTA</span>
                </button>
            </div>

            {/* Main Grid Section */}
            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {/* SOC & SOH */}
                <div className="flex flex-col justify-between rounded-2xl bg-[var(--card)] p-4 ring-1 ring-[var(--border)]">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-[var(--muted-foreground)]">State of Charge (SOC)</span>
                        <span className="rounded-lg bg-[var(--card)] p-1 text-[var(--muted-foreground)] shadow-xs ring-1 ring-[var(--border)]">
                            <Battery className="size-3.5 text-emerald-500" />
                        </span>
                    </div>

                    <div className="my-2 flex items-center justify-center gap-3">
                        <ElectricGauge socPercent={socPercent} isCharging={isCharging} />
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
                                className={`h-full rounded-full transition-all duration-500 ${
                                    soh >= 80 ? "bg-emerald-500" : soh >= 50 ? "bg-amber-500" : "bg-rose-500"
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

               {/* Pack Voltage & Current Card */}
                <div className="flex flex-col justify-between rounded-2xl bg-[var(--card)] p-4 ring-1 ring-[var(--border)] shadow-xs">
                    <style>{`
                        @keyframes energyFlowIn {
                            0% { background-position: 200% 0; }
                            100% { background-position: -200% 0; }
                        }
                        @keyframes energyFlowOut {
                            0% { background-position: -200% 0; }
                            100% { background-position: 200% 0; }
                        }
                    `}</style>

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
                                    <div className="text-lg font-extrabold tabular-nums leading-none text-[var(--foreground)]">
                                        {packVoltage.toFixed(2)} <span className="text-xs font-semibold text-[var(--muted-foreground)]">V</span>
                                    </div>
                                </div>
                            </div>
                            <span className="rounded-md bg-[var(--muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--muted-foreground)]">
                                {cellCount ? `${(cellCount * 3.2).toFixed(0)}V Sys` : "System"}
                            </span>
                        </div>
                            
                        <div 
                            className={`relative flex items-center justify-between overflow-hidden rounded-xl bg-[var(--card)] p-2.5 shadow-xs ring-1 transition-colors ${
                                current > 0
                                    ? "ring-emerald-500/30"
                                    : current < 0
                                    ? "ring-amber-500/30"
                                    : "ring-[var(--border)]/60"
                            }`}
                        >
                            {current !== 0 && (
                                <div
                                    className="pointer-events-none absolute inset-0 opacity-40"
                                    style={{
                                        backgroundImage: `linear-gradient(${
                                            current > 0 ? "270deg" : "90deg"
                                        }, transparent 0%, ${
                                            current > 0 ? "rgba(16,185,129,0.5)" : "rgba(245,158,11,0.5)"
                                        } 50%, transparent 100%)`,
                                        backgroundSize: "200% 100%",
                                        animation: current > 0 
                                            ? "energyFlowOut 1.5s linear infinite" 
                                            : "energyFlowIn 1.5s linear infinite",
                                    }}
                                />
                            )}

                            <div className="relative flex items-center gap-2.5">
                                <div
                                    className={`relative flex size-9 items-center justify-center rounded-lg ${
                                        current > 0 
                                            ? "bg-emerald-500/10 text-emerald-500" 
                                            : current < 0 
                                            ? "bg-amber-500/10 text-amber-500" 
                                            : "bg-zinc-500/10 text-zinc-400"
                                    }`}
                                >
                                    {current !== 0 && (
                                        <span className={`absolute inline-flex size-full animate-ping rounded-lg opacity-30 ${
                                            current > 0 ? "bg-emerald-400" : "bg-amber-400"
                                        }`} />
                                    )}
                                    
                                    {current > 0 ? (
                                        <BatteryCharging className="relative size-5" />
                                    ) : (
                                        <Battery className="relative size-5" />
                                    )}
                                </div>

                                <div>
                                    <div className="text-[10px] font-medium text-[var(--muted-foreground)]">Current</div>
                                    <div
                                        className={`text-lg font-extrabold tabular-nums leading-none ${
                                            current > 0 ? "text-emerald-500" : current < 0 ? "text-amber-500" : "text-[var(--foreground)]"
                                        }`}
                                    >
                                        {current > 0 ? `+${current.toFixed(2)}` : current.toFixed(2)}{" "}
                                        <span className="text-xs font-semibold text-[var(--muted-foreground)]">A</span>
                                    </div>
                                </div>
                            </div>

                            <div className="relative flex items-center gap-2">
                                <span
                                    className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                                        current > 0
                                            ? "bg-emerald-500/10 text-emerald-500"
                                            : current < 0
                                            ? "bg-amber-500/10 text-amber-500"
                                            : "bg-zinc-500/10 text-zinc-400"
                                    }`}
                                >
                                    {current > 0 ? "Charging" : current < 0 ? "Discharging" : "Idle"}
                                </span>

                                {current > 0 && (
                                    <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500" title="Charger">
                                        <PlugZap className="size-4.5" />
                                    </div>
                                )}

                                {current < 0 && (
                                    <div className="flex size-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500" title="Load">
                                        <Lightbulb className="size-4.5" />
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center justify-between border-t border-[var(--border)]/80 pt-2.5 text-xs text-[var(--muted-foreground)]">
                        <span>Average Cell</span>
                        <span className="font-bold tabular-nums text-[var(--foreground)]">
                            {cellAvgVoltage.toFixed(3)} <span className="text-[10px] font-normal text-[var(--muted-foreground)]">V</span>
                        </span>
                    </div>

                    <div className="mt-1.5 flex items-center justify-between text-xs text-[var(--muted-foreground)]">
                        <span>Diff Volt (ΔV)</span>
                        <span
                            className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                                voltDiffMv <= 15
                                    ? "bg-emerald-500/10 text-emerald-500"
                                    : voltDiffMv <= 30
                                    ? "bg-amber-500/10 text-amber-500"
                                    : "bg-rose-500/10 text-rose-500"
                            }`}
                        >
                            {voltDiffMv} mV
                        </span>
                    </div>

                    <div className="mt-1.5 flex items-center justify-between text-xs text-[var(--muted-foreground)]">
                        <span>Bal Current</span>
                        <span className="font-bold tabular-nums text-[var(--foreground)]">
                            {balancerCurrentA.toFixed(2)} <span className="text-[10px] font-normal text-[var(--muted-foreground)]">A</span>
                        </span>
                    </div>
                </div>

                {/* Power Output */}
                <div className="flex flex-col justify-between rounded-2xl bg-[var(--card)] p-4 ring-1 ring-[var(--border)]">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-[var(--muted-foreground)]">Power</span>
                        <span className="rounded-lg bg-[var(--card)] p-1 text-[var(--muted-foreground)] shadow-xs ring-1 ring-[var(--border)]">
                            <Zap className="size-3.5 text-amber-500" />
                        </span>
                    </div>

                    <div className="my-1 flex flex-col items-center justify-center">
                        <div className="relative flex items-center justify-center">
                            {power !== 0 && (
                                <div
                                    className="pointer-events-none absolute size-40 animate-pulse rounded-full blur-2xl"
                                    style={{ background: current > 0 ? "rgba(16,185,129,0.35)" : "rgba(245,158,11,0.35)" }}
                                />
                            )}
                            <svg className="relative size-48" viewBox="0 0 110 110">
                                <g transform="rotate(-210 55 55)">
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
                                    const r1 = 41;
                                    const r2 = showLabel ? 44.5 : 43;
                                    const rText = 50;

                                    const x1 = 55 + r1 * Math.cos(rad);
                                    const y1 = 55 + r1 * Math.sin(rad);
                                    const x2 = 55 + r2 * Math.cos(rad);
                                    const y2 = 55 + r2 * Math.sin(rad);
                                    const xT = 55 + rText * Math.cos(rad);
                                    const yT = 55 + rText * Math.sin(rad);

                                    return (
                                        <g key={angle}>
                                            <line
                                                x1={x1}
                                                y1={y1}
                                                x2={x2}
                                                y2={y2}
                                                stroke="currentColor"
                                                strokeWidth={showLabel ? "1" : "0.6"}
                                                className={showLabel ? "text-[var(--muted-foreground)]" : "text-[var(--border)]"}
                                            />
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

                            <div className="absolute flex flex-col items-center justify-center text-center">
                                <span className="text-2xl font-black leading-none text-[var(--foreground)] tabular-nums">
                                    {Math.abs(power).toFixed(0)}
                                </span>
                                <span className="mt-0.5 text-[10px] font-bold tracking-wider text-[var(--muted-foreground)]">WATT</span>

                                <span
                                    className={`mt-1.5 rounded-md px-2 py-0.5 text-xs font-bold tabular-nums shadow-xs ring-1 ring-[var(--border)]/60 ${
                                        current > 0
                                            ? "bg-emerald-500/10 text-emerald-500"
                                            : current < 0
                                            ? "bg-amber-500/10 text-amber-500"
                                            : "bg-[var(--card)] text-[var(--muted-foreground)]"
                                    }`}
                                >
                                    {current > 0 ? `+${current.toFixed(1)}` : current.toFixed(1)} A
                                </span>
                            </div>
                        </div>

                        <div className="-mt-3 inline-flex items-center gap-1.5 rounded-full bg-[var(--card)] text-[var(--muted-foreground)]  px-3.5 py-1 text-xs font-semibold shadow-xs ring-1 ring-[var(--border)]">
                            <span
                                className={`size-2 rounded-full ${
                                    current > 0
                                        ? "bg-emerald-500 animate-pulse"
                                        : current < 0
                                        ? "bg-amber-500 animate-pulse"
                                        : "bg-zinc-400"
                                }`}
                            />
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

export default function OTAUpdateModal({ isOpen, onClose, deviceIp = "192.168.1.50" }) {
  const [status, setStatus] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [flashStage, setFlashStage] = useState("idle"); // 'idle' | 'flashing' | 'success' | 'error'

  if (!isOpen) return null;

    const handleTriggerButton = async (e) => {
        e.preventDefault();
        if (!deviceIp) return alert("ไม่พบ IP Address ของอุปกรณ์");

        setIsUpdating(true);
        setFlashStage("flashing");
        setStatus("กำลังส่งคำสั่งกดปุ่ม Trigger OTA ไปยังบอร์ด ESPHome...");

        try {
            // เปลี่ยนจาก axios.post เป็น axios.get (หรือลองสลับดูกรณีที่ POST แล้วเงียบ)
            const response = await axios.get(`http://${deviceIp}/button/btn_trigger_Ota_pdate/press`, {
                timeout: 5000,
            });
            
            console.log("Command sent successfully", response.data);
            setFlashStage("success");
            setStatus("สั่งกดปุ่มอัปเดตสำเร็จ!");

        } catch (error) {
        console.error("Failed to trigger action:", error);
        
        // เพิ่มการเช็ค error.code === 'ECONNABORTED' และคำว่า 'timeout' ให้ชัดเจน
        if (
            error.code === 'ECONNABORTED' || 
            error.code === 'ERR_NETWORK' || 
            (error.message && error.message.includes('timeout')) ||
            (error.message && error.message.includes('Network Error'))
        ) {
            console.warn("บอร์ดรับคำสั่งและน่าจะเริ่มกระบวนการแล้ว");
            setFlashStage("success");
            setStatus("สั่งกดปุ่มอัปเดตสำเร็จ! บอร์ดกำลังดำเนินการ");
        } else {
            setFlashStage("error");
            setStatus(`สั่งงานไม่สำเร็จ: ${error.message}`);
        }
        } finally {
            setIsUpdating(false);
            }
    };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-2xl bg-[var(--card)] p-5 shadow-xl ring-1 ring-[var(--border)] animate-in fade-in zoom-in-95 duration-200">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-xl bg-[var(--brand-10)] text-[var(--brand)]">
              <Upload className="size-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--foreground)]">อัปเดตเฟิร์มแวร์ผ่าน GitHub (OTA)</h3>
              <p className="text-[11px] text-[var(--muted-foreground)]">สั่งกดปุ่ม `btn_trigger_Ota_pdate` เพื่อให้บอร์ดดึงไฟล์ .bin ล่าสุด</p>
            </div>
          </div>
          <button
            type="button"
            disabled={isUpdating}
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Modal Form Content */}
        <form onSubmit={handleTriggerButton} className="mt-4 space-y-3.5">
          {/* Target IP Display */}
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-[var(--foreground)]">
              <Server className="size-3.5 text-[var(--muted-foreground)]" />
              Target Device IP:
            </label>
            <div className="w-full rounded-xl bg-[var(--muted)]/50 px-3 py-2 text-xs font-mono font-semibold text-[var(--foreground)] ring-1 ring-[var(--border)]">
              {deviceIp}
            </div>
          </div>

          {/* Warning Alert */}
          <div className="flex items-start gap-2 rounded-xl bg-amber-500/15 p-2.5 text-amber-500 text-xs">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <span>ระบบจะส่งคำสั่งไปกดปุ่มบนบอร์ดทันที บอร์ดจะทำการดาวน์โหลดไฟล์จาก GitHub และอัปเดตตัวเองโดยอัตโนมัติ</span>
          </div>

          {/* Status Box */}
          {(isUpdating || flashStage !== "idle") && (
            <div className="space-y-2 rounded-2xl bg-[var(--muted)]/30 p-3 ring-1 ring-[var(--border)]">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span
                  className={
                    flashStage === "flashing"
                      ? "text-amber-500"
                      : flashStage === "success"
                      ? "text-emerald-500"
                      : flashStage === "error"
                      ? "text-rose-500"
                      : "text-sky-500"
                  }
                >
                  {flashStage === "flashing" ? "⚡ กำลังส่งคำสั่ง..." : "สถานะการทำงาน"}
                </span>
                <span className="font-mono text-[11px] text-[var(--muted-foreground)]">
                  Target: {deviceIp}
                </span>
              </div>

              {/* Progress Bar Animation */}
              <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--border)]">
                <div
                  className={`h-full transition-all duration-300 ${
                    flashStage === "flashing"
                      ? "bg-amber-500 animate-pulse w-full"
                      : flashStage === "success"
                      ? "bg-emerald-500 w-full"
                      : flashStage === "error"
                      ? "bg-rose-500 w-full"
                      : "bg-sky-500 w-0"
                  }`}
                />
              </div>

              {status && (
                <p
                  className={`mt-2 rounded-lg p-2 text-center text-[11px] font-medium ring-1 ${
                    flashStage === "success"
                      ? "bg-emerald-500/10 text-emerald-500 ring-emerald-500/20"
                      : flashStage === "error"
                      ? "bg-rose-500/10 text-rose-500 ring-rose-500/20"
                      : "bg-amber-500/10 text-amber-500 ring-amber-500/20"
                  }`}
                >
                  {status}
                </p>
              )}
            </div>
          )}

          {/* Modal Footer Actions */}
          <div className="mt-4 flex items-center justify-end gap-2.5 border-t border-[var(--border)] pt-3.5">
            <button
              type="button"
              disabled={isUpdating}
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-xs font-semibold text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isUpdating}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--card)] hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isUpdating ? (
                <>
                  <RefreshCw className="size-3.5 animate-spin" />
                  <span>กำลังส่งคำสั่ง...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="size-3.5" />
                  <span>กดปุ่มอัปเดต (Trigger OTA)</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}