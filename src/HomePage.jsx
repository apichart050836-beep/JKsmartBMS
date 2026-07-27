import React from "react";
import {
  Zap,
  ShieldCheck,
  Smartphone,
  Cpu,
  BatteryCharging,
  ChevronRight,
  Thermometer,
  Gauge,
  Globe,
  History,
  BellRing,
  Users,
  WifiOff,
  LayoutDashboard,
} from "lucide-react";
import { ThemeToggle } from "./components/ThemeToggle.jsx";

// --- Live-metric preview card (hero's right column) ---
function BMSGaugeCard({ icon: Icon, label, value, unit, tone, max }) {
  const percentage = Math.min((value / max) * 100, 100);
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[var(--muted-foreground)]">
          <Icon className="size-5" style={{ color: tone }} />
          <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
        </div>
        <span className="text-xl font-bold" style={{ color: tone }}>
          {value} <span className="text-sm font-normal text-[var(--muted-foreground)]">{unit}</span>
        </span>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-[var(--muted)]">
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${percentage}%`, backgroundColor: tone }} />
      </div>
      <div className="flex justify-between font-mono text-[10px] text-[var(--muted-foreground)]">
        <span>0 {unit}</span>
        <span>Max: {max} {unit}</span>
      </div>
    </div>
  );
}

// --- Node used by the architecture diagram ---
function Node({ icon, title, desc, active }) {
  return (
    <div className={`z-10 flex flex-col items-center ${active ? "scale-110" : ""}`}>
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-lg">{icon}</div>
      <div className="mt-4 text-center">
        <div className="text-xs font-mono font-bold tracking-widest text-[var(--foreground)]">{title}</div>
        <div className="text-[10px] uppercase text-[var(--muted-foreground)]">{desc}</div>
      </div>
    </div>
  );
}

// --- ESP32 <-> BMS <-> Cloud data-flow diagram ---
function ArchitectureVisualizer() {
  return (
    <div className="relative mx-auto my-16 w-full max-w-4xl overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--card)] p-8 shadow-[0_20px_50px_rgba(0,0,0,0.08)] sm:p-12">
      <style>{`
        @keyframes flow-r { 0% { left: 0%; opacity: 0; } 15% { opacity: 1; } 85% { opacity: 1; } 100% { left: 100%; opacity: 0; } }
        @keyframes flow-l { 0% { right: 0%; opacity: 0; } 15% { opacity: 1; } 85% { opacity: 1; } 100% { right: 100%; opacity: 0; } }
        .packet-r { animation: flow-r 2s infinite linear; }
        .packet-l { animation: flow-l 2s infinite linear; }
      `}</style>

      <div className="relative flex items-center justify-between">
        <Node icon={<Globe className="size-8" style={{ color: "var(--info)" }} />} title="WEB_CLOUD" desc="Remote Server" />

        <div className="mx-2 flex h-8 flex-1 flex-col justify-between sm:mx-4">
          <div className="relative h-px w-full bg-[var(--border)]">
            <div className="packet-r absolute top-[-3px] size-2 rounded-full" style={{ backgroundColor: "var(--info)" }} />
          </div>
          <div className="relative h-px w-full bg-[var(--border)]">
            <div className="packet-l absolute top-[-3px] size-2 rounded-full delay-1000" style={{ backgroundColor: "var(--info)" }} />
          </div>
        </div>

        <div className="relative">
          <div className="absolute inset-0 animate-pulse rounded-full opacity-30 blur-xl" style={{ backgroundColor: "var(--good)" }} />
          <Node icon={<Cpu className="size-10" style={{ color: "var(--good)" }} />} title="ESP32_HUB" desc="IoT Gateway" active />
        </div>

        <div className="mx-2 flex h-8 flex-1 flex-col justify-between sm:mx-4">
          <div className="relative h-px w-full bg-[var(--border)]">
            <div className="packet-r absolute top-[-3px] size-2 rounded-full delay-500" style={{ backgroundColor: "var(--good)" }} />
          </div>
          <div className="relative h-px w-full bg-[var(--border)]">
            <div className="packet-l absolute top-[-3px] size-2 rounded-full delay-1500" style={{ backgroundColor: "var(--brand)" }} />
          </div>
        </div>

        <Node icon={<BatteryCharging className="size-8" style={{ color: "var(--brand)" }} />} title="JK_BMS" desc="Power System" />
      </div>

      <div className="absolute bottom-6 left-0 right-0 flex flex-wrap justify-center gap-x-8 gap-y-2 px-4 font-mono text-[10px] text-[var(--muted-foreground)]">
        <span>● FULL_DUPLEX_COMMUNICATION</span>
        <span>● LIVE_TELEMETRY_SYNC</span>
      </div>
    </div>
  );
}

// --- Feature card ---
function Feature({ icon, title, desc }) {
  return (
    <div className="group rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 transition-all duration-300 hover:-translate-y-1 hover:border-[var(--brand)] hover:shadow-xl">
      <div className="mb-4 inline-block rounded-xl bg-[var(--brand-10)] p-3 text-[var(--brand)] transition-colors group-hover:bg-[var(--brand)] group-hover:text-white">
        {icon}
      </div>
      <h3 className="mb-2 text-sm font-mono font-bold tracking-tight text-[var(--foreground)]">{title}</h3>
      <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">{desc}</p>
    </div>
  );
}

const FEATURES = [
  {
    icon: <LayoutDashboard className="size-5" />,
    title: "REAL-TIME DASHBOARD",
    desc: "แรงดัน กระแส อุณหภูมิ และแรงดันแต่ละเซลล์ อัปเดตสดจาก Firebase ทุก 5 วินาที",
  },
  {
    icon: <History className="size-5" />,
    title: "CHARGE/DISCHARGE HISTORY",
    desc: "สรุปพลังงานชาร์จ/ดิสชาร์จ รายวัน รายเดือน รายปี คำนวณจากแรงดัน×กระแสจริง ไม่ใช่ค่าประมาณ",
  },
  {
    icon: <BellRing className="size-5" />,
    title: "SMART ALARM",
    desc: "แจ้งเตือนทันทีเมื่อค่าผิดปกติ เช่น แรงดันเซลล์เกิน อุณหภูมิสูง หรือเซลล์ไม่สมดุล",
  },
  {
    icon: <WifiOff className="size-5" />,
    title: "CONNECTION WATCHDOG",
    desc: "ตรวจจับการหลุดของสัญญาณ BLE/ESP32 อัตโนมัติ พร้อมแจ้งเตือนก่อนข้อมูลจะหายไปนาน",
  },
  {
    icon: <Users className="size-5" />,
    title: "MULTI-DEVICE ACCESS",
    desc: "รองรับหลายอุปกรณ์ หลายบัญชีผู้ใช้ แต่ละบัญชีเห็นเฉพาะอุปกรณ์ของตัวเอง",
  },
  {
    icon: <ShieldCheck className="size-5" />,
    title: "ADMIN CONTROL CENTER",
    desc: "แผงควบคุมสำหรับแอดมิน ดูภาพรวมทุกอุปกรณ์พร้อมกัน และส่งประกาศแจ้งเตือนถึงผู้ใช้ทุกคนได้ทันที",
  },
];

export default function HomePage({ onGoToLogin }) {
  return (
    <div className="relative min-h-screen bg-[var(--background)] font-sans text-[var(--foreground)]">
      <div className="absolute inset-0 bg-[radial-gradient(var(--border)_1px,transparent_1px)] [background-size:24px_24px] opacity-40" />

      {/* Top bar */}
      <div className="relative mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-[var(--brand-10)]">
            <BatteryCharging className="size-4.5 text-[var(--brand)]" />
          </div>
          <span className="text-sm font-bold tracking-tight">JK BMS Dashboard</span>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <button
            type="button"
            onClick={onGoToLogin}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--brand)] px-4 py-2 text-xs font-semibold text-white shadow-sm transition-transform hover:scale-105 active:scale-95"
          >
            เข้าสู่ระบบ <ChevronRight className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="relative mx-auto max-w-7xl px-6 pb-16 pt-4">
        <div className="flex flex-col items-center gap-16 lg:flex-row">
          {/* Left: marketing copy */}
          <div className="flex-1 text-center lg:text-left">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--good-10)] px-4 py-1.5">
              <span className="size-2 animate-pulse rounded-full" style={{ backgroundColor: "var(--good)" }} />
              <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--good)" }}>
                System Status: Live Telemetry
              </span>
            </div>

            <h1 className="mb-6 text-5xl font-bold leading-tight md:text-6xl">
              อัปเกรด <span className="text-[var(--brand)]">JK BMS</span>
              <br />
              ด้วยขุมพลัง ESP32
            </h1>
            <p className="mx-auto mb-8 max-w-xl text-lg leading-relaxed text-[var(--muted-foreground)] lg:mx-0">
              เปลี่ยนระบบจัดการแบตเตอรี่ของคุณให้เป็นระบบอัจฉริยะ แสดงผลข้อมูล Real-time
              ด้วยเกจวัดความแม่นยำสูง พร้อมแจ้งเตือนด่วนและตรวจสอบได้จากทุกที่
            </p>

            <div className="mx-auto flex flex-col items-center justify-center gap-4 sm:flex-row lg:mx-0 lg:justify-start">
              <button
                type="button"
                onClick={onGoToLogin}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--brand)] px-8 py-4 font-bold text-white shadow-lg transition-transform hover:scale-[1.02] active:scale-95 sm:w-auto"
              >
                เริ่มต้นใช้งาน <ChevronRight className="size-5" />
              </button>
            </div>
          </div>

          {/* Right: live-looking metric preview */}
          <div className="grid w-full max-w-2xl flex-1 grid-cols-1 gap-6 md:grid-cols-2">
            <div className="mb-2 flex items-center gap-3 text-[var(--muted-foreground)] md:col-span-2">
              <Gauge className="size-6 text-[var(--brand)]" />
              <h2 className="text-sm font-semibold uppercase tracking-widest">Live System Metrics</h2>
            </div>

            <BMSGaugeCard icon={BatteryCharging} label="System Voltage" value={51.2} unit="V" tone="var(--good)" max={60} />
            <BMSGaugeCard icon={Zap} label="Load Current" value={15.8} unit="A" tone="var(--info)" max={100} />
            <BMSGaugeCard icon={Thermometer} label="BMS Temp" value={34.5} unit="°C" tone="var(--warning)" max={80} />

            <div className="flex flex-col justify-between rounded-2xl border border-[var(--border)] bg-slate-900 p-5 font-mono text-[11px] text-emerald-400 shadow-xl">
              <div className="mb-3 flex gap-2 opacity-50">
                <div className="size-2.5 rounded-full bg-red-500" />
                <div className="size-2.5 rounded-full bg-yellow-500" />
                <div className="size-2.5 rounded-full bg-emerald-500" />
              </div>
              <div className="space-y-1.5">
                <p>{"> telemetry_bus_active"}</p>
                <p>{"> node_id: esp32_bms_bridge"}</p>
                <p className="animate-pulse">{"> status: data_stream_synced"}</p>
              </div>
              <div className="mt-2 text-right text-emerald-700">v1.0.2</div>
            </div>
          </div>
        </div>

        <ArchitectureVisualizer />

        {/* Features */}
        <section>
          <div className="mb-10 text-center">
            <h2 className="text-3xl font-bold">ความสามารถของระบบ</h2>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">ทุกฟีเจอร์ทำงานจริงบนอุปกรณ์ที่เชื่อมต่ออยู่ ไม่ใช่ข้อมูลจำลอง</p>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <Feature key={f.title} {...f} />
            ))}
          </div>
        </section>

        {/* Footer */}
        <footer className="mt-20 flex flex-col items-center gap-2 border-t border-[var(--border)] pt-8 text-center text-xs text-[var(--muted-foreground)]">
          <div className="flex items-center gap-2">
            <Smartphone className="size-3.5" />
            <span>ใช้งานได้ทั้งบนมือถือและคอมพิวเตอร์</span>
          </div>
          <span>สอบถามเพิ่มเติม ทัก Line: Poote3105</span>
        </footer>
      </div>
    </div>
  );
}
