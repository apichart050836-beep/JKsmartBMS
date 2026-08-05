import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext.jsx';

export default function BmsManager() {
  const [availableEspDevices, setAvailableEspDevices] = useState([]);
  const [selectedEsp, setSelectedEsp] = useState(null);
  const [loadingEspScan, setLoadingEspScan] = useState(false);
  const [detectedBmsMac, setDetectedBmsMac] = useState(null);
  const [deviceId, setDeviceId] = useState(null);
  const [bmsStatus, setBmsStatus] = useState({
    discoveredDevice: "ยังไม่ได้สแกน...",
    isOnline: false,
    espConnected: false
  });

  const [logs, setLogs] = useState(["ระบบพร้อมใช้งาน... กรุณากดปุ่ม สแกนหา ESP32 "]);
  const isAlreadySaved = useRef(false);
  
  // 🎯 Ref สำหรับควบคุมการ Scroll ของกล่อง Logs อัตโนมัติ
  const logsEndRef = useRef(null);
  
  const FIREBASE_HOST = "https://jkbms-32dfe-default-rtdb.asia-southeast1.firebasedatabase.app";
  const FIREBASE_AUTH = "AIzaSyCLbUwX40SfeQMAooCzFYKAXgyvo_Io8B4";
  
  // Account ปัจจุบันของผู้ใช้งาน
  const { user } = useAuth();
  const SAFE_ACCOUNT = user?.hubId || user?.email?.replace(/\./g, "_") || null;

  const [showPopup, setShowPopup] = useState(false);
  const [popupMessage, setPopupMessage] = useState("");

  const addLog = (msg) => {
    setLogs((prev) => [...prev, `>_ ${new Date().toLocaleTimeString()}: ${msg}`]);
  };

  // 🎯 ฟังก์ชันเลื่อน Log ลงมาด้านล่างสุดอัตโนมัติทุกครั้งที่ logs มีการเปลี่ยนแปลง
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const sanitizeKey = (key) => {
    if (!key) return "unknown_device";
    return key.replace(/[^a-zA-Z0-9]/g, '');
  };

  const registerDeviceToRegistry = async (espMac) => {
    const rawId = espMac || (selectedEsp?.chipId !== "ESP32192168118" ? selectedEsp?.chipId : null);
    if (!rawId) return;
    const sanitizedId = sanitizeKey(rawId);
    if (!sanitizedId) return;

    const url = `${FIREBASE_HOST}/Device_Registry/${sanitizedId}.json?auth=${FIREBASE_AUTH}`;
    const payload = {
      owner: SAFE_ACCOUNT,
      registered_at: new Date().toISOString(),
      last_active: new Date().toISOString()
    };

    try {
      await axios.patch(url, payload);
    } catch (err) {
      console.error("❌ Registry update failed", err);
    }
  };

  const fetchEspMac = async (ip) => {
    try {
      const res = await axios.get(`http://${ip}/`, { timeout: 2000 });
      if (res.data && res.data.mac_address) {
        return res.data.mac_address.replace(/:/g, '');
      }
      return null;
    } catch (e) {
      return null;
    }
  };

  useEffect(() => {
    if (!selectedEsp) return;
    const interval = setInterval(() => {
      checkEspStatus(selectedEsp.ip);
    }, 6000);
    return () => clearInterval(interval);
  }, [selectedEsp, deviceId]);

  const updateToFirebase = async (bmsMac, currentDeviceId) => {
    if (!currentDeviceId) return;
    const cleanDeviceId = currentDeviceId.replace(/[^a-zA-Z0-9]/g, '');
    const url = `${FIREBASE_HOST}/JK_BMS_HUB/${SAFE_ACCOUNT}/${cleanDeviceId}/info.json?auth=${FIREBASE_AUTH}`;
    
    const payload = {
      balancer_status: "unknown",
      battery_type: "unknown",
      esp_model: "ESP32C3",
      esp_firmware_version: "1.0.0",
      esp_ip_address: selectedEsp?.ip || "unknown",
      hardware_version: "19A",
      jk_mac_address: bmsMac,
      software_version: "1.0.0",
      uptime_seconds: Math.floor(Date.now() / 1000)
    };

    try {
      await axios.patch(url, payload);
    } catch (err) {
      console.error("Firebase Sync Error:", err);
    }
  };

  let currentId = deviceId;
  const checkEspStatus = async (ip) => {
    if (!ip) return;
    try {
      const baseUrl = `http://${ip}`;
      const [resDevice, resStatus] = await Promise.all([
        axios.get(`${baseUrl}/text_sensor/ble_scan_status`, { timeout: 3000 }),
        axios.get(`${baseUrl}/binary_sensor/bms_online_status`, { timeout: 3000 })
      ]);

      const scanText = resDevice.data?.state || "";
      const isOnline = resStatus.data?.state === "ON" || resStatus.data?.state === true;

      addLog(`Status: ${scanText} (Online: ${isOnline})`);

      if (!currentId) {
        const start = scanText.indexOf('[');
        const end = scanText.indexOf(']');
        if (start !== -1 && end !== -1 && end > start) {
          currentId = scanText.substring(start + 1, end);
          registerDeviceToRegistry(currentId);
          setDeviceId(currentId);
          handleScanBms();
        }
      }

      const match = scanText.match(/\[([0-9A-Fa-f.]{12,})/);
      if (match && match[1]) {
        const foundMac = match[1];
        if (foundMac.length === 23) {
          setDetectedBmsMac(foundMac);
          if (!isAlreadySaved.current) {
            addLog(`✅ พบ MAC Address JK BMS: กำลังบันทึกข้อมูลลงระบบ...`);
            updateToFirebase(foundMac, currentId);
            isAlreadySaved.current = true;
            
            setPopupMessage("เชื่อมต่อ JK BMS สำเร็จเรียบร้อย!");
            setShowPopup(true);
            setTimeout(() => setShowPopup(false), 5000);
          }
        }
      }

      setBmsStatus({ discoveredDevice: scanText, isOnline, espConnected: true });
    } catch (err) {
      addLog(`Status: รอการตอบสนองจาก ESP32...`);
      setBmsStatus({ espConnected: false, isOnline: false, discoveredDevice: "เชื่อมต่อไม่ได้" });
    }
  };

  const handleScanEsp32 = async () => {
    setLoadingEspScan(true);
    setAvailableEspDevices([]);
    setSelectedEsp(null);
    isAlreadySaved.current = false;
    
    const subnets = ['192.168.0', '192.168.1']; 
    addLog(`กำลังสแกนหา ESP32 และเช็คประวัติการบันทึกของ Account: ${SAFE_ACCOUNT} ...`);

    try {
      const accountDevicesRes = await axios.get(`${FIREBASE_HOST}/JK_BMS_HUB/${SAFE_ACCOUNT}.json?auth=${FIREBASE_AUTH}`);
      const userSavedDevices = accountDevicesRes.data || {};
      const savedDeviceIdsInAccount = Object.keys(userSavedDevices);

      const found = [];
      const scanPromises = [];

      for (const prefix of subnets) {
        for (let i = 1; i <= 250; i++) {
          const ip = `${prefix}.${i}`;
          scanPromises.push(
            axios.get(`http://${ip}/text_sensor/ble_scan_status`, { timeout: 800 })
              .then(async (res) => {
                const scanText = res.data?.state || "";
                let chipId = null;

                const start = scanText.indexOf('[');
                const end = scanText.indexOf(']');
                if (start !== -1 && end !== -1 && end > start) {
                  chipId = scanText.substring(start + 1, end);
                }

                if (!chipId) {
                  const mac = await fetchEspMac(ip);
                  if (mac) chipId = mac;
                }

                const rawIdentifier = chipId || ip;
                const sanitizedId = sanitizeKey(rawIdentifier);

                const isSavedInThisAccount = savedDeviceIdsInAccount.includes(sanitizedId);

                if (!isSavedInThisAccount) {
                  if (!found.find(item => item.ip === ip)) {
                    found.push({ chipId: `ESP32 (${rawIdentifier})`, ip: ip });
                  }
                } else {
                  addLog(`ℹ️ ซ่อน ${rawIdentifier} (${ip}) เนื่องจากถูกบันทึกไว้ใน Account นี้แล้ว`);
                }
              })
              .catch(() => {})
          );
        }
      }

      await Promise.all(scanPromises);
      setAvailableEspDevices(found);
      if(found.length > 0){
        addLog(`✅ สแกนเสร็จสิ้น: พบอุปกรณ์ใหม่ ${found.length} เครื่อง กรุณาเลือก ESP ที่ต้องการเชื่อมต่อ JK BMS`);
      } else {
        addLog(`❌ สแกนเสร็จสิ้น: ไม่พบอุปกรณ์ กำลังสแกนเพื่อค้นหา อีกครั้ง...`);
        handleScanEsp32();
      }
    } catch (err) {
      console.error("Scan error:", err);
      addLog(`❌ เกิดข้อผิดพลาดในการดึงข้อมูลจาก Account`);
    } finally {
      setLoadingEspScan(false);
    }
  };

  const handleSelectEsp = async (device) => {
    addLog(`กำลังเชื่อมต่อกับบอร์ด ${device.ip}...`);
    const mac = await fetchEspMac(device.ip);
    const finalDevice = { 
      ...device, 
      macAddress: mac || device.chipId 
    };
    setSelectedEsp(finalDevice);
    addLog(`เลือกใช้งานอุปกรณ์ IP: ${finalDevice.ip}`);
    checkEspStatus(finalDevice.ip);
  };

  const handleScanBms = async () => {
    if (!selectedEsp) return;
    try {
      await fetch(`http://${selectedEsp.ip}/button/btn_scan_bms/press`, { method: 'POST', mode: 'no-cors' });
      addLog("📡 ส่งคำสั่ง: สแกนหาสัญญาณ BLE ของ JK BMS แล้ว");
    } catch (e) { addLog("✅ ส่งคำสั่งสแกนสำเร็จ"); }
  };

  const handleConnectBms = async () => {
    if (!selectedEsp) return;
    try {
      await axios.post(`http://${selectedEsp.ip}/button/btn_connect_bms/press`);
      addLog("🔗 ส่งคำสั่ง: กำลังเชื่อมต่อ JK BMS...");
    } catch (e) { addLog("❌ ส่งคำสั่งเชื่อมต่อไม่สำเร็จ"); }
  };

  const handleDisconnectBms = async () => {
    if (!selectedEsp) return;
    try {
      await axios.post(`http://${selectedEsp.ip}/button/btn_disconnect_bms/press`);
      addLog("🔌 ส่งคำสั่ง: ยกเลิกการจับคู่เรียบร้อย");
    } catch (e) { addLog("❌ คำสั่ง Unpair ขัดข้อง"); }
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', padding: '40px 20px', fontFamily: '"Inter", system-ui, sans-serif', color: '#1e293b' }}>
      <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
        
        {/* Header Banner */}
        <div style={{ background: 'linear-gradient(135deg, oklch(0.6 0.25 299.3) 0%, oklch(0.5 0.2 299.3) 100%)', borderRadius: '20px', padding: '32px', color: 'white', marginBottom: '30px', boxShadow: '0 10px 25px -5px rgba(138, 43, 226, 0.3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '26px', fontWeight: '800', letterSpacing: '-0.5px' }}>JK-BMS Smart Control Center</h1>
            <p style={{ margin: '8px 0 0 0', fontSize: '14px', opacity: 0.9 }}>
              ผู้ใช้งานปัจจุบัน: <strong style={{ textDecoration: 'underline' }}>{SAFE_ACCOUNT}</strong>
            </p>
          </div>
          <div style={{ backgroundColor: 'rgba(255,255,255,0.15)', padding: '10px 18px', borderRadius: '12px', fontSize: '13px', fontWeight: '600', backdropFilter: 'blur(5px)' }}>
            🟢 Secure Cloud Sync
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: '24px' }}>
          
          {/* Left Column: Device Control & Selection */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            {/* Box 1: Find ESP32 */}
            <div style={{ backgroundColor: '#ffffff', borderRadius: '16px', padding: '24px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02), 0 2px 4px -1px rgba(0,0,0,0.02)', border: '1px solid #f1f5f9' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <span style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>1. ค้นหา ESP32 </span>
              </div>
              <button 
                onClick={handleScanEsp32} 
                disabled={loadingEspScan} 
                style={{ width: '100%', padding: '14px', backgroundColor: loadingEspScan ? '#e2e8f0' : 'oklch(0.6 0.25 299.3)', color: loadingEspScan ? '#64748b' : '#ffffff', border: 'none', borderRadius: '12px', fontWeight: '600', cursor: loadingEspScan ? 'not-allowed' : 'pointer', transition: 'all 0.2s', boxShadow: loadingEspScan ? 'none' : '0 4px 12px rgba(138, 43, 226, 0.2)' }}
              >
                {loadingEspScan ? "⏳ กำลังสแกนคัดกรอง..." : "🔍 สแกนหา ESP32 ใหม่"}
              </button>

              {availableEspDevices.length > 0 && (
                <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
                  {availableEspDevices.map((dev) => (
                    <div 
                      key={dev.ip} 
                      onClick={() => handleSelectEsp(dev)} 
                      style={{ padding: '12px 16px', borderRadius: '10px', border: selectedEsp?.ip === dev.ip ? '2px solid oklch(0.6 0.25 299.3)' : '1px solid #e2e8f0', backgroundColor: selectedEsp?.ip === dev.ip ? 'oklch(0.97 0.05 299.3)' : '#f8fafc', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all 0.2s' }}
                    >
                      <div>
                        <div style={{ fontWeight: '600', fontSize: '13px', color: '#1e293b' }}>{dev.chipId}</div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>IP: {dev.ip}</div>
                      </div>
                      {selectedEsp?.ip === dev.ip && <span style={{ color: 'oklch(0.6 0.25 299.3)', fontWeight: 'bold' }}>✓ เลือกแล้ว</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Box 2: BMS Operations */}
            <div style={{ backgroundColor: '#ffffff', borderRadius: '16px', padding: '24px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02), 0 2px 4px -1px rgba(0,0,0,0.02)', border: '1px solid #f1f5f9', opacity: selectedEsp ? 1 : 0.6, pointerEvents: selectedEsp ? 'auto' : 'none', transition: 'opacity 0.2s' }}>
              <div style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', marginBottom: '16px' }}>2. ควบคุมการเชื่อมต่อ BMS</div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <button onClick={handleScanBms} style={{ padding: '12px', backgroundColor: '#f1f5f9', color: '#0f172a', border: '1px solid #cbd5e1', borderRadius: '10px', fontWeight: '600', cursor: 'pointer' }}>
                  📡 สแกนหา JK BMS
                </button>
                <button onClick={handleConnectBms} style={{ padding: '12px', backgroundColor: '#10b981', color: '#ffffff', border: 'none', borderRadius: '10px', fontWeight: '600', cursor: 'pointer', boxShadow: '0 4px 12px rgba(16, 185, 129, 0.2)' }}>
                  🔗 เชื่อมต่ออุปกรณ์
                </button>
                <button onClick={handleDisconnectBms} style={{ padding: '10px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', borderRadius: '10px', fontWeight: '600', cursor: 'pointer' }}>
                  🔌 ตัดการเชื่อมต่อ (Unpair)
                </button>
              </div>
            </div>

          </div>

          {/* Right Column: Status & Live Logs */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            {/* Status Metrics Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
              
              <div style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '16px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)', border: '1px solid #f1f5f9' }}>
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', letterSpacing: '0.5px', marginBottom: '6px' }}>BMS MAC ADDRESS</div>
                <div style={{ fontWeight: '700', fontSize: '13px', color: detectedBmsMac ? 'oklch(0.6 0.25 299.3)' : '#94a3b8', wordBreak: 'break-all' }}>
                  {detectedBmsMac || "ยังไม่พบข้อมูล"}
                </div>
              </div>

              <div style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '16px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)', border: '1px solid #f1f5f9' }}>
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', letterSpacing: '0.5px', marginBottom: '6px' }}>ESP32 STATUS</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '700', fontSize: '14px', color: bmsStatus.espConnected ? '#10b981' : '#ef4444' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: bmsStatus.espConnected ? '#10b981' : '#ef4444' }}></span>
                  {bmsStatus.espConnected ? 'Online' : 'Offline'}
                </div>
              </div>

              <div style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '16px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)', border: '1px solid #f1f5f9' }}>
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', letterSpacing: '0.5px', marginBottom: '6px' }}>BMS CONNECTION</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '700', fontSize: '14px', color: bmsStatus.isOnline ? '#10b981' : '#64748b' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: bmsStatus.isOnline ? '#10b981' : '#cbd5e1' }}></span>
                  {bmsStatus.isOnline ? 'Connected' : 'Standby'}
                </div>
              </div>

            </div>

            {/* Terminal Live Logs with Auto-Scroll */}
            <div style={{ backgroundColor: '#0f172a', borderRadius: '16px', padding: '20px', color: '#38bdf8', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: '12px', minHeight: '320px', maxHeight: '350px', overflowY: 'auto', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.2)', border: '1px solid #1e293b' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#64748b', marginBottom: '14px', borderBottom: '1px solid #1e293b', paddingBottom: '8px' }}>
                <span style={{ fontWeight: 'bold', color: '#94a3b8' }}>🖥️ LIVE SYSTEM LOGS</span>
                <span>Auto-scrolling active</span>
              </div>
              {logs.map((log, i) => (
                <div key={i} style={{ marginBottom: '6px', lineHeight: '1.5', wordBreak: 'break-all' }}>{log}</div>
              ))}
              {/* จุดอ้างอิงสำหรับเลื่อนหน้าจอ Log อัตโนมัติ */}
              <div ref={logsEndRef} />
            </div>

          </div>

        </div>
      </div>

      {/* Modern Pop-up Notification */}
      {showPopup && (
        <div style={{
          position: 'fixed', bottom: '30px', right: '30px',
          backgroundColor: '#10b981', color: 'white', padding: '16px 24px', borderRadius: '14px',
          boxShadow: '0 10px 25px -5px rgba(16, 185, 129, 0.4)', zIndex: 9999, fontWeight: '600', fontSize: '14px',
          display: 'flex', alignItems: 'center', gap: '12px', animation: 'fadeIn 0.3s ease-in-out'
        }}>
          <span style={{ fontSize: '18px' }}>🎉</span> {popupMessage}
        </div>
      )}
    </div>
  );
}