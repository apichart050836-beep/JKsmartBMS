import React from "react";
import { Settings, Sun, Moon } from "lucide-react";
import { useTheme } from "../context/ThemeContext.jsx";
import { WeatherButton } from "./WeatherButton.jsx";
import { LineIcon } from "./icons/LineIcon.jsx";

/**
 * BmsTabs: Segmented tab bar with smooth active animation & hover feedback -
 * active tab gets a brand gradient, glow, and a live-pulse dot (every
 * rendered tab is by construction a real assigned device, see
 * buildBmsSlots' `live` filter in BMSDashboard.jsx).
 */
function BmsTabs({ tabs, activeId, onSelect }) {
    return (
        // Scrolls horizontally within itself once there are more tabs than
        // fit (4+ devices on a phone-width screen) instead of blowing out
        // the whole page's width - max-w-full bounds it to whatever the
        // parent flex row actually allocates. overscroll-x-contain
        // suppresses the browser's native overscroll "glow"/bounce
        // indicator at the edges (showed as curved bracket-like lines on
        // mobile once this became scrollable) - purely a rendering
        // artifact of the scroll container itself, not a real border.
        <div className="min-w-0 max-w-full overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
    onOpenWeather,
    onOpenConfig,
    onOpenLineNotify,
    configDisabled = false,
}) {
    const { theme, toggleTheme } = useTheme();
    const isDark = theme === "dark";
    return (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            {/* Left: BMS Navigation Tabs */}
            <BmsTabs tabs={tabs} activeId={activeBmsId} onSelect={onSelectBms} />

            {/* Right: Action Buttons */}
            <div className="flex items-center gap-2">
                {/* Weather Button - moved here from the outer App.jsx header,
                    replacing the old System Log slot (Log moved into
                    Configuration instead, see SettingsPanel.jsx). */}
                <WeatherButton onClick={onOpenWeather} />

                {/* LINE Notifications Button - the icon is already a
                    self-contained green circular badge, so this button is
                    just a transparent hit-target/hover-scale wrapper, not
                    another colored circle around it. */}
                <button
                    type="button"
                    onClick={onOpenLineNotify}
                    title="แจ้งเตือนผ่าน LINE"
                    className="group inline-flex size-10 cursor-pointer items-center justify-center rounded-full shadow-sm ring-1 ring-[var(--border)] transition-all duration-200 hover:scale-105 active:scale-95"
                >
                    <LineIcon className="size-7" />
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
                    <span>Config</span>
                </button>

                {/* Dark Mode Toggle (Circular Style) */}
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
            </div>
        </div>
    );
}