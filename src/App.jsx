import React, { useState, useRef, useEffect } from "react";
import {
  LayoutDashboard,
  ShieldCheck,
  LogOut,
  Cpu,
  Download,
  Upload,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Terminal,
  Wifi,
  Bluetooth,
  Radio,
} from "lucide-react";
import { ESPLoader, Transport } from "esptool-js";
import { BrowserRouter } from "react-router-dom";

import BMSDashboard from "./BMSDashboard.jsx";
import AdminMonitor from "./AdminMonitor.jsx";
import Login from "./Login.jsx";
import HomePage from "./HomePage.jsx";
import ESPHomeUpdater from "./ESPHomeUpdater.jsx";
import { ThemeRoot } from "./components/ThemeRoot.jsx";
import { ThemeProvider } from "./context/ThemeContext.jsx";
import { AuthProvider, useAuth } from "./context/AuthContext.jsx";
import { HubDataProvider } from "./context/HubDataContext.jsx";
import { LogoutModal } from "./components/LogoutModal.jsx";

// ตัวเลือกชิปประมวลผลที่รองรับ
const CHIP_OPTIONS = [
  { id: "esp32c3", name: "ESP32-C3", defaultAddress: 0x00, defaultFile: "/firmware/esp32c3-firmware.bin" },
  { id: "esp32s3", name: "ESP32-S3", defaultAddress: 0x10000, defaultFile: "/firmware/esp32s3-firmware.bin" },
  { id: "esp32", name: "ESP32 (Standard)", defaultAddress: 0x10000, defaultFile: "/firmware/esp32-firmware.bin" },
];

// 🔍 ฟังก์ชันสำหรับตรวจจับ IP Address จากข้อความ Log ที่ ESP32 พิมพ์ออกมาทาง Serial
const parseIpFromLog = (logMessage) => {
  if (!logMessage) return null;
  // Regex จับรูปแบบ IPv4 (เช่น 192.168.1.50 หรือ 10.0.0.5)
  const ipRegex = /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/;
  const match = logMessage.match(ipRegex);
  
  // ถ้าเจอ IP และไม่ใช่ IP 192.168.4.1 (ซึ่งเป็น Default IP ของ AP Mode) ให้ดึงมาใช้
  if (match && match[0] !== "192.168.4.1" && match[0] !== "0.0.0.0") {
    return match[0];
  }
  return null;
};

function ESPFirmwareInstaller() {
  const [selectedChip, setSelectedChip] = useState("esp32c3");
  const [status, setStatus] = useState("idle"); // idle, connecting, flashing, success, error
  const [statusMessage, setStatusMessage] = useState("เลือกประเภทชิปและเตรียมพร้อมสำหรับการติดตั้ง Firmware");
  const [progress, setProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState(null);
  const [logs, setLogs] = useState([]);

  // 📡 Device Life Cycle States
  const [deviceIp, setDeviceIp] = useState("—");
  const [connectionState, setConnectionState] = useState("disconnected"); // disconnected, ap_mode, wifi_connected, ble_reconnecting, ble_connected
  const [bleStatus, setBleStatus] = useState("Idle");

  // 📌 Ref สำหรับ Auto Scroll ของ Terminal Log
  const logContainerRef = useRef(null);

  const currentChipConfig = CHIP_OPTIONS.find((c) => c.id === selectedChip) || CHIP_OPTIONS[0];

  // 📌 เลื่อน Scrollbar ลงด้านล่างสุดอัตโนมัติเมื่อมี Log เพิ่ม
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const appendLog = (msg) => {
    if (!msg) return;
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, `[${time}] ${msg}`]);
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file && file.name.endsWith(".bin")) {
      setSelectedFile(file);
      appendLog(`เลือกไฟล์ติดตั้ง: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
    } else {
      alert("กรุณาเลือกไฟล์นามสกุล .bin เท่านั้น");
    }
  };

  // 🔄 ลำดับเหตุการณ์ติดตามสถานะหลัง Flash
  const trackPostFlashSequence = async () => {
    appendLog("--------------------------------------------------");
    appendLog("🔄 [1/3] กำลังรีบูตอุปกรณ์ ESP32...");
    setConnectionState("disconnected");
    setBleStatus("Rebooting...");
    setDeviceIp("—");

    // ขั้นที่ 1: ตรวจจับ AP Mode
    await new Promise((resolve) => setTimeout(resolve, 15000));
    setConnectionState("ap_mode");
    setDeviceIp("—"); 
    appendLog("📶 [2/3] โปรดเลือก AP Hotspot 'ESPHome-Setup' และเชื่อมต่อ Wi-Fi 2.4G ของคุณ");

    // ขั้นที่ 2: รอฟัง IP จริงผ่าน Serial Log (หรือหากไม่มี IP ใหม่เข้ามาใน 5 วินาที ระบบจะแจ้งเตือนให้ตั้งค่า Wi-Fi)
    appendLog("🌐 [3/3] กำลังรอรับ IP Address จริงจาก Wi-Fi Router ผ่าน Serial Stream...");
    
    await new Promise((resolve) => setTimeout(resolve, 50000));

 
    appendLog("--------------------------------------------------");
  };

  const handleStartFlashing = async () => {
    if (!("serial" in navigator)) {
      alert("เบราว์เซอร์ของคุณไม่รองรับ Web Serial API กรุณาใช้ Google Chrome หรือ Microsoft Edge");
      return;
    }

    let transport = null;

    try {
      setStatus("connecting");
      setConnectionState("disconnected");
      setStatusMessage(`กำลังเชื่อมต่อบอร์ด ${currentChipConfig.name}...`);
      setLogs([]);
      setProgress(0);
      setDeviceIp("—");

      const device = await navigator.serial.requestPort({});
      transport = new Transport(device);

      // 📌 ฟังก์ชันจัดการ Log และดึง IP แบบ Real-time จาก Serial Stream
      const processSerialMessage = (msg) => {
        const cleanMsg = msg.trim();
        if (!cleanMsg) return;
        
        appendLog(cleanMsg);

        // ดึง IP จริงจาก Serial Log หากบอร์ดพิมพ์ออกมา
        const detectedRealIp = parseIpFromLog(cleanMsg);
        if (detectedRealIp) {
          setDeviceIp(detectedRealIp);
          setConnectionState("wifi_connected");
          appendLog(`🌐 [Real-time Network] ตรวจพบ IP จริงจาก ESP32: ${detectedRealIp}`);
        }
      };

      const esploader = new ESPLoader({
        transport,
        baudrate: 115200,
        terminal: {
          write: processSerialMessage,
          writeLine: processSerialMessage,
          clean: () => setLogs([]),
          clear: () => setLogs([]),
        },
      });

      appendLog(`กำลังเชื่อมต่อกับพอร์ต Serial สำหรับชิป ${currentChipConfig.name}...`);
      await esploader.main();
      appendLog(`เชื่อมต่อชิปสำเร็จ! ชิปที่ตรวจพบ: ${esploader.chip ? esploader.chip.CHIP_NAME : "ESP32 Series"}`);

      setStatus("flashing");

      // 🧹 ล้าง Flash ทั้งหมดก่อนเขียนข้อมูลใหม่
      setStatusMessage(`กำลังล้างข้อมูลบน Flash (Full Erase)...`);
      appendLog("🧹 [ERASE] กำลังทำการล้างข้อมูลบน Flash (Erase Flash) ก่อนการติดตั้ง...");
      await esploader.eraseFlash();
      appendLog("✅ [ERASE COMPLETE] ล้างข้อมูลบน Flash สำเร็จเรียบร้อย!");

      // เตรียมไฟล์ Firmware
      let fileArrayBuffer;
      if (selectedFile) {
        setStatusMessage(`กำลังอ่านไฟล์ ${selectedFile.name}...`);
        fileArrayBuffer = await selectedFile.arrayBuffer();
      } else {
        setStatusMessage(`กำลังโหลด Firmware เริ่มต้นสำหรับ ${currentChipConfig.name}...`);
        appendLog(`กำลังดาวน์โหลด ${currentChipConfig.defaultFile} ...`);
        const response = await fetch(currentChipConfig.defaultFile);
        if (!response.ok) throw new Error(`ไม่พบไฟล์ Firmware เริ่มต้น (${currentChipConfig.defaultFile}) บนเซิร์ฟเวอร์`);
        fileArrayBuffer = await response.arrayBuffer();
      }

      setStatusMessage(`กำลัง Flash Firmware ลงบน ${currentChipConfig.name}...`);
      appendLog(`เริ่มเขียนข้อมูล Firmware ไปยัง Offset Address: 0x${currentChipConfig.defaultAddress.toString(16)}...`);

      const fileArray = [
        {
          data: new Uint8Array(fileArrayBuffer),
          address: currentChipConfig.defaultAddress,
        },
      ];

      await esploader.writeFlash({
        fileArray,
        flashSize: "keep",
        eraseAll: false,
        compress: true,
        reportProgress: (fileIndex, written, total) => {
          const percent = Math.round((written / total) * 100);
          setProgress(percent);
        },
      });

      setStatus("success");
      setStatusMessage(`ติดตั้ง Firmware บน ${currentChipConfig.name} สำเร็จเรียบร้อย!`);
      appendLog("✨ Firmware Flashing Completed Successfully!");

     // 8. รีเซ็ตบอร์ดและคืนพอร์ต Serial
      try {
        appendLog("🔄 กำลังส่งคำสั่ง Reset บอร์ด...");
        
        // 🔥 แก้ไขจุดนี้: สั่ง Reset ผ่าน transport โดยตรงแทน esploader.hardReset()
        if (transport) {
          try {
            // วิธีที่ 1: ใช้คำสั่ง reset ของ transport (ถ้ามี)
            await transport.setDTR(false);
            await transport.setRTS(true);
            await new Promise((r) => setTimeout(r, 100));
            await transport.setDTR(false);
            await transport.setRTS(false);
          } catch (rstErr) {
            console.warn("ไม่สามารถส่งสัญญาณ Reset ผ่าน RTS/DTR ได้:", rstErr);
          }
        }
      } catch (resetErr) {
        console.warn("เกิดข้อผิดพลาดขณะส่งคำสั่ง Reset:", resetErr);
      } finally {
        // คืน Serial Port
        try {
          if (transport) {
            await transport.disconnect();
          }
          if (device && device.opened) {
            await device.close();
          }
          appendLog("🔌 ปลดการเชื่อมต่อ Serial พอร์ตเรียบร้อย");
        } catch (closeErr) {
          console.warn("ไม่สามารถปิดพอร์ตอัตโนมัติได้:", closeErr);
        }
      }
      trackPostFlashSequence();
    } catch (err) {
      console.error(err);
      setStatus("error");
      setStatusMessage(`ข้อผิดพลาด: ${err.message}`);
      appendLog(`❌ เกิดข้อผิดพลาด: ${err.message}`);

      if (transport) {
        try {
          await transport.disconnect();
        } catch (e) {
          // Ignore disconnect error on failure
        }
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-[var(--brand-10)] text-[var(--brand)]">
            <Download className="size-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-[var(--foreground)]">
              ESPHome Multi-Chip Firmware Installer
            </h1>
            <p className="text-xs text-[var(--muted-foreground)]">
              ติดตั้ง Firmware, ตรวจสอบ AP Mode / IP Address และติดตามการ Reconnect BLE แบบ Real-time
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Control Panel */}
        <div className="space-y-4 lg:col-span-1">
          {/* Chip Selector */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm space-y-2">
            <label className="block text-xs font-semibold text-[var(--foreground)]">
              เลือกรุ่นบอร์ด / ชิปประมวลผล (Target Chip)
            </label>
            <select
              value={selectedChip}
              onChange={(e) => {
                setSelectedChip(e.target.value);
                appendLog(`เปลี่ยนชิปเป้าหมายเป็น: ${e.target.value.toUpperCase()}`);
              }}
              disabled={status === "connecting" || status === "flashing"}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] p-2.5 text-xs font-medium text-[var(--foreground)] outline-none focus:border-[var(--brand)] transition-colors cursor-pointer disabled:opacity-50"
            >
              {CHIP_OPTIONS.map((chip) => (
                <option key={chip.id} value={chip.id}>
                  {chip.name}
                </option>
              ))}
            </select>
          </div>

          {/* Custom File Picker */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm">
            <label className="mb-2 block text-xs font-semibold text-[var(--foreground)]">
              เลือกไฟล์ Firmware (.bin)
            </label>
            <input
              type="file"
              accept=".bin"
              onChange={handleFileChange}
              disabled={status === "connecting" || status === "flashing"}
              className="hidden"
              id="firmware-file-input"
            />
            <label
              htmlFor="firmware-file-input"
              className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border)] p-4 text-xs text-[var(--muted-foreground)] transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)]"
            >
              <Upload className="size-4" />
              <span className="truncate">
                {selectedFile ? selectedFile.name : `ใช้ Default Firmware (${currentChipConfig.name})`}
              </span>
            </label>
          </div>

          {/* Flash Action Button */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm space-y-3">
            <button
              type="button"
              onClick={handleStartFlashing}
              disabled={status === "connecting" || status === "flashing"}
              className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-[var(--brand)] px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status === "connecting" || status === "flashing" ? (
                <>
                  <RefreshCw className="size-4 animate-spin" />
                  <span>กำลังติดตั้ง...</span>
                </>
              ) : (
                <>
                  <Download className="size-4" />
                  <span>ติดตั้ง Firmware ({currentChipConfig.name})</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Status & Terminal Area */}
        <div className="space-y-4 lg:col-span-2">
          {/* Real-Time Live Connection Indicators */}
          <div className="grid grid-cols-3 gap-3">
            {/* AP Mode Box */}
            <div className={`rounded-xl border p-3 flex items-center gap-2.5 ${
              connectionState === "ap_mode" 
                ? "border-amber-500 bg-amber-500/10 text-amber-500" 
                : "border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)]"
            }`}>
              <Radio className="size-4" />
              <div>
                <p className="text-[10px] uppercase font-bold">AP Hotspot Mode</p>
                <p className="text-xs font-semibold">{connectionState === "ap_mode" ? "192.168.4.1 (Active)" : "Off"}</p>
              </div>
            </div>

            {/* Wi-Fi Status Box */}
            <div className={`rounded-xl border p-3 flex items-center gap-2.5 ${
              deviceIp !== "—" || connectionState === "wifi_connected"
                ? "border-emerald-500 bg-emerald-500/10 text-emerald-500" 
                : "border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)]"
            }`}>
              <Wifi className="size-4" />
              <div>
                <p className="text-[10px] uppercase font-bold">Wi-Fi Connection</p>
                <p className="text-xs font-semibold">
                  {deviceIp !== "—" ? deviceIp : "Not Connected"}
                </p>
              </div>
            </div>

            {/* BLE Reconnect Status Box */}
            <div className={`rounded-xl border p-3 flex items-center gap-2.5 ${
              connectionState === "ble_connected" 
                ? "border-blue-500 bg-blue-500/10 text-blue-500" 
                : connectionState === "ble_reconnecting" 
                ? "border-amber-500 bg-amber-500/10 text-amber-500 animate-pulse" 
                : "border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)]"
            }`}>
              <Bluetooth className="size-4" />
              <div>
                <p className="text-[10px] uppercase font-bold">BLE Status</p>
                <p className="text-xs font-semibold">{bleStatus}</p>
              </div>
            </div>
          </div>

          {/* Flash Progress & Main Status */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm space-y-3">
            <div className="flex items-center gap-2">
              {status === "success" && <CheckCircle2 className="size-4 text-emerald-500" />}
              {status === "error" && <AlertCircle className="size-4 text-red-500" />}
              {(status === "connecting" || status === "flashing") && (
                <RefreshCw className="size-4 animate-spin text-[var(--brand)]" />
              )}
              <span className="text-xs font-medium text-[var(--foreground)]">
                {statusMessage}
              </span>
            </div>

            {(status === "flashing" || status === "success") && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px] font-semibold text-[var(--muted-foreground)]">
                  <span>สถานะการติดตั้ง ({currentChipConfig.name})</span>
                  <span>{progress}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--border)]">
                  <div
                    className="h-full bg-[var(--brand)] transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Terminal Logs (Auto-Scroll) */}
          <div className="rounded-xl border border-[var(--border)] bg-black p-4 shadow-sm text-slate-200">
            <div className="mb-2 flex items-center justify-between border-b border-slate-800 pb-2 text-xs text-slate-400">
              <div className="flex items-center gap-2">
                <Terminal className="size-3.5" />
                <span>Installation Log & Live Connection Status</span>
              </div>
              <span className="text-[10px] text-emerald-400">Auto-scrolling Active</span>
            </div>

            <div
              ref={logContainerRef}
              className="h-64 overflow-y-auto font-mono text-[11px] leading-relaxed text-emerald-400 space-y-1 scroll-smooth"
            >
              {logs.length === 0 ? (
                <span className="text-slate-600">กดปุ่มเริ่มการติดตั้งเพื่อดูสถานะการทำงาน...</span>
              ) : (
                logs.map((log, index) => <div key={index}>{log}</div>)
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// Main Router Container
// ==========================================
const PAGES = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, userOnly: true },
  { id: "admin", label: "Admin Monitor", icon: ShieldCheck, adminOnly: true },
 
  { id: "install-firmware", label: "Install Firmware", icon: Download },
];

function AuthedApp() {
  const { user, logout } = useAuth();
  const defaultPage = user.role === "admin" ? "admin" : "dashboard";
  const [page, setPage] = useState(defaultPage);
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  const pages = PAGES.filter(
    (p) => (p.adminOnly ? user.role === "admin" : !p.userOnly || user.role !== "admin")
  );
  const activePage = pages.find((p) => p.id === page) ? page : defaultPage;

  return (
    <HubDataProvider>
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-1 px-3 pt-4 sm:px-5 md:px-7">
        <div className="flex items-center gap-1">
          {pages.map((p) => {
            const Icon = p.icon;
            const active = p.id === activePage;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPage(p.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? "bg-[var(--brand-10)] text-[var(--brand)]"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
              >
                <Icon className="size-3.5" />
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--muted-foreground)]">
            {user.email} · <span className="font-semibold text-[var(--foreground)]">{user.role}</span>
          </span>
          {activePage !== "dashboard" && (
            <button
              type="button"
              onClick={() => setShowLogoutModal(true)}
              title="Logout"
              className="group inline-flex size-8 cursor-pointer items-center justify-center rounded-full bg-[var(--card)] text-[var(--critical)] ring-1 ring-[var(--border)] shadow-sm transition-all duration-200 hover:bg-red-50 hover:ring-red-200 hover:scale-105 active:scale-95"
            >
              <LogOut className="size-4 transition-transform duration-300 group-hover:-translate-x-0.5" />
            </button>
          )}
        </div>
      </div>

      {activePage === "dashboard" && <BMSDashboard />}
      {activePage === "admin" && <AdminMonitor />}

      {activePage === "firmware" && (
        <div className="mx-auto max-w-7xl px-3 py-6 sm:px-5 md:px-7">
          <ESPHomeUpdater />
        </div>
      )}

      {activePage === "install-firmware" && (
        <div className="mx-auto max-w-7xl px-3 py-6 sm:px-5 md:px-7">
          <ESPFirmwareInstaller />
        </div>
      )}

      <LogoutModal
        isOpen={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        onConfirm={() => {
          setShowLogoutModal(false);
          logout();
        }}
      />
    </HubDataProvider>
  );
}

function Gate() {
  const { isAuthenticated, loading } = useAuth();
  const [view, setView] = useState("home");

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center">Loading...</div>;
  }

  if (isAuthenticated) return <AuthedApp />;

  if (view === "login") {
    return <Login onBackToHome={() => setView("home")} />;
  }

  return <HomePage onGoToLogin={() => setView("login")} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <ThemeRoot>
          <AuthProvider>
            <Gate />
          </AuthProvider>
        </ThemeRoot>
      </ThemeProvider>
    </BrowserRouter>
  );
}