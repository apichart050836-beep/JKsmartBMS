import React from "react";
import { ClipboardList, Settings, LogOut, BatteryFull, Sun, Moon, Cpu } from "lucide-react"; // เพิ่ม LogOut เข้าไป
import { useTheme } from "../context/ThemeContext.jsx";

/**
 * BmsTabs: Segmented tab bar with smooth active animation & hover feedback -
 * active tab gets a brand gradient, glow, a live-pulse dot (every rendered
 * tab is by construction a real assigned device, see buildBmsSlots' `live`
 * filter in BMSDashboard.jsx), and a battery glyph.
 */
function BmsTabs({ tabs, activeId, onSelect }) {
    return (
        <div className="inline-flex items-center gap-1 rounded-2xl bg-[var(--muted)]/70 p-1.5 ring-1 ring-[var(--border)]/50 backdrop-blur-xs">
            {tabs.map((tab) => {
                const isActive = tab.id === activeId;
                return (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => onSelect(tab.id)}
                        title={tab.mac}
                        className={`group relative inline-flex cursor-pointer items-center gap-1.5 overflow-hidden rounded-xl px-4 py-1.5 text-xs font-semibold transition-all duration-200 active:scale-95 ${isActive
                            ? "bg-gradient-to-br from-[var(--brand)] to-[var(--info)] text-white shadow-md shadow-[var(--brand)]/30 scale-[1.03]"
                            : "text-[var(--muted-foreground)] hover:bg-[var(--card)]/50 hover:text-[var(--foreground)]"
                            }`}
                    >
                        {isActive && (
                            <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent group-hover:animate-[shimmer_1s_ease]" />
                        )}
                        <BatteryFull className={`size-3.5 ${isActive ? "text-white" : "text-[var(--muted-foreground)]"}`} />
                        <span className="relative">{tab.name}</span>
                        <span className="relative flex size-1.5">
                            <span
                                className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${isActive ? "bg-white" : "bg-emerald-400"}`}
                            />
                            <span className={`relative inline-flex size-1.5 rounded-full ${isActive ? "bg-white" : "bg-emerald-400"}`} />
                        </span>
                    </button>
                );
            })}
            <style>{`
                @keyframes shimmer {
                    100% { transform: translateX(100%); }
                }
            `}</style>
        </div>
    );
}

/**
 * Top Bar Component
 */

export function TopBar({
    tabs,
    activeBmsId,
    onSelectBms,
    onOpenLog,
    onOpenConfig,
    onLogout, // รับฟังก์ชัน onLogout เข้ามา
    configDisabled = false,
    softwareVersion,
    hardwareVersion,
}) {
    const { theme, toggleTheme } = useTheme();
    const isDark = theme === "dark";
    return (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            {/* Left: BMS Navigation Tabs */}
            <BmsTabs tabs={tabs} activeId={activeBmsId} onSelect={onSelectBms} />

            {/* Right: Action Buttons */}
            <div className="flex items-center gap-2">
                {/* ESP32 firmware version - real info.software_version field for
                    whichever device is active, not an app version number. */}
                {softwareVersion && (
                    <span
                        title={hardwareVersion ? `Hardware: ${hardwareVersion}` : undefined}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--card)] px-3 py-2 text-xs font-semibold text-[var(--muted-foreground)] ring-1 ring-[var(--border)] shadow-xs"
                    >
                        <Cpu className="size-3.5" />
                        <span>v{softwareVersion}</span>
                    </span>
                )}

                {/* System Log Button */}
                <button
                    type="button"
                    onClick={onOpenLog}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[var(--card)] px-3.5 py-2 text-xs font-semibold text-[var(--foreground)] ring-1 ring-[var(--border)] shadow-xs transition-all duration-150 hover:bg-[var(--muted)] active:scale-95"
                >
                    <ClipboardList className="size-3.5 text-[var(--muted-foreground)]" />
                    <span>System Log</span>
                </button>

                {/* Configuration Button */}
                <button
                    type="button"
                    onClick={onOpenConfig}
                    disabled={configDisabled}
                    className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold shadow-xs transition-all duration-150 ${configDisabled
                        ? "cursor-not-allowed bg-[var(--muted)] text-[var(--muted-foreground)] opacity-60 ring-1 ring-[var(--border)]"
                        : "cursor-pointer bg-[var(--brand)] text-white hover:opacity-90 hover:shadow-md active:scale-95"
                        }`}
                >
                    <Settings className="size-3.5" />
                    <span>Configuration</span>
                </button>

                {/* Dark Mode Toggle (Circular Style, matches Logout) */}
                <button
                    type="button"
                    onClick={toggleTheme}
                    title={isDark ? "Switch to light mode" : "Switch to dark mode"}
                    className="group inline-flex size-10 cursor-pointer items-center justify-center rounded-full bg-[var(--card)] text-[var(--muted-foreground)] ring-1 ring-[var(--border)] shadow-sm transition-all duration-200 hover:bg-[var(--muted)] hover:text-[var(--foreground)] hover:scale-105 active:scale-95"
                >
                    {isDark ? (
                        <Sun className="size-5 transition-transform duration-300 group-hover:rotate-45" />
                    ) : (
                        <Moon className="size-5 transition-transform duration-300 group-hover:-rotate-12" />
                    )}
                </button>

                {/* Logout Button (Circular Style) */}
                <button
                    type="button"
                    onClick={onLogout}
                    title="Logout"
                    className="group inline-flex size-10 cursor-pointer items-center justify-center rounded-full bg-[var(--card)] text-[var(--critical)] ring-1 ring-[var(--border)] shadow-sm transition-all duration-200 hover:bg-red-50 hover:ring-red-200 hover:scale-105 active:scale-95"
                >
                    <LogOut className="size-[18px] transition-transform duration-300 group-hover:-translate-x-0.5" />
                </button>
            </div>
        </div>
    );
}