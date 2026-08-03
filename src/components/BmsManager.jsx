import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext.jsx';

export default function BmsManager() {
  // บัญชี Firebase ที่จะเขียนอุปกรณ์ลงไป - ดึงจาก session ล็อกอินจริงแทนการ
  // hardcode ไว้ตายตัว ("." แปลงเป็น "_" เพราะ Firebase RTDB key ห้ามมี "."
  // เหมือนที่ server/emailToHubId.js ทำอยู่แล้วฝั่ง backend - user.hubId จาก
  // /api/auth/me เป็นค่าที่แปลงแบบนี้มาให้แล้ว ใช้ได้ตรงๆ ไม่ต้องแปลงเอง
  // ยกเว้น session admin ที่ไม่มี hubId เป็นของตัวเอง ตรงนั้นค่อย fallback
  // แปลง email ของตัวเองแทน)
  const { user } = useAuth();
  const SAFE_ACCOUNT = user?.hubId || user?.email?.replace(/\./g, "_") || null;

  const [availableEspDevices, setAvailableEspDevices] = useState([]);
  const [selectedEsp, setSelectedEsp] = useState(null);
  const [loadingEspScan, setLoadingEspScan] = useState(false);
  const [detectedBmsMac, setDetectedBmsMac] = useState(null); // เพิ่ม State สำหรับ MAC
 
  const [bmsStatus, setBmsStatus] = useState({
    discoveredDevice: "ยังไม่ได้สแกน...",
    isOnline: false,
    loadingScan: false,
    loadingConnect: false,
    espConnected: false
  });

  const [logs, setLogs] = useState(["กดปุ่มสแกนหา ESP32 ใน LAN เพื่อเริ่มดูสถานะการทำงาน..."]);

  const FIREBASE_HOST = "https://jkbms-32dfe-default-rtdb.asia-southeast1.firebasedatabase.app";
  const FIREBASE_AUTH = "AIzaSyCLbUwX40SfeQMAooCzFYKAXgyvo_Io8B4";
  const axiosConfig = {
      auth: {
        username: 'admin', // แก้ไขให้ตรงกับที่ตั้งใน YAML
        password: 'yourpassword123' // แก้ไขให้ตรงกับที่ตั้งใน YAML
      },
      timeout: 5000
  };

  const registerDeviceToRegistry = async (espMac) => {
   // 1. ถ้ามี mac ให้ใช้ mac ถ้าไม่มีให้ใช้ chipId แล้วทำการ sanitize ทั้งคู่
    const rawId = espMac || selectedEsp.chipId;
    const sanitizedId = sanitizeKey(rawId); 

    // 2. ใช้ sanitizedId แทน
    const url = `${FIREBASE_HOST}/Device_Registry/${sanitizedId}.json?auth=${FIREBASE_AUTH}`;
    
    const payload = {
      owner: SAFE_ACCOUNT,
      registered_at: new Date().toISOString(),
      last_active: new Date().toISOString()
    };

    try {
      await axios.patch(url, payload);
      console.log("✅ Registry updated with key:", sanitizedId);
    } catch (err) {
      console.error("❌ Registry update failed", err);
    }
  };
  const addLog = (msg) => {
    setLogs((prev) => [...prev.slice(-15), `>_ ${new Date().toLocaleTimeString()}: ${msg}`]);
  };

  const sanitizeKey = (key) => {
    if (!key) return "unknown_device";
    // ใช้ Regex ลบทุกอย่างที่ไม่ใช่ a-z, A-Z, หรือ 0-9 ออก
    return key.replace(/[^a-zA-Z0-9]/g, '');
  };

  const callEspApi = async (ip, endpoint) => {
    try {
      const response = await axios.get(`http://${ip}${endpoint}`, { timeout: 3000 });
      return response.data;
    } catch (err) {
      console.error(`Error calling ${endpoint}:`, err);
      return null;
    }
  };
// 🔄 ดึง MAC Address ของ ESP32 โดยตรงจาก Endpoint ของมัน
  const fetchEspMac = async (ip) => {
    try {
      // ESPHome จะส่งข้อมูล info กลับมาทาง / หรือ /device_info (ถ้าเปิด web_server ไว้)
      const res = await axios.get(`http://${ip}/`, { timeout: 2000 });
      // หากพบข้อมูล mac_address ใน response
      if (res.data && res.data.mac_address) {
        return res.data.mac_address.replace(/:/g, ''); // ลบเครื่องหมาย : ออก
      }
      return null;
    } catch (e) {
      return null;
    }
  };

  // 🔄 แก้ไข useEffect: ย้ายมาวางไว้ระดับ Component และทำงานเมื่อเลือก ESP เท่านั้น
    useEffect(() => {
      if (!selectedEsp) return;
      const interval = setInterval(() => {
        checkEspStatus(selectedEsp.ip);
      }, 6000); // ขยายเวลาเป็น 6 วินาที
      return () => clearInterval(interval);
    }, [selectedEsp]);

  // ฟังก์ชัน Sync Firebase (รวม Logic ดึง MAC)
  const updateToFirebase = async (bmsMac) => {
    // 💡 ตรงนี้เราจะใช้ selectedEsp.macAddress แทน chipId
    if (!selectedEsp || !selectedEsp.macAddress) return;
    const espMacClean = selectedEsp.macAddress.replace(/[^a-zA-Z0-9]/g, '');
   
    
    const url = `${FIREBASE_HOST}/JK_BMS_HUB/${SAFE_ACCOUNT}/${espMacClean}/info.json?auth=${FIREBASE_AUTH}`;
    
    const payload = {
      "balancer_status": "unknown",
      "battery_type": "unknown",
      "esp-model": "ESP32C3",
      "esp_firmware_version": "1.0.0",
      "esp_ip_address": selectedEsp.ip,
      "hardware_version": "19A",
      "jk_mac_address": bmsMac,
      "software_version": "1.0.0",
      "uptime_seconds": new Date().getMilliseconds() / 1000
    };

    try {
      await axios.patch(url, payload);
    } catch (err) {
      console.error("Firebase Sync Error:", err);
    }
  };
  const handleSelectEsp = async (device) => {
    addLog(`กำลังเชื่อมต่อกับบอร์ด ${device.ip}...`);
    
    // ดึง MAC จริงของ ESP32 ก่อน
    const mac = await fetchEspMac(device.ip);
    const finalDevice = { 
      ...device, 
      macAddress: mac || device.chipId // ถ้าดึงไม่ได้ ให้ใช้ chipId แทน
    };
   
    setSelectedEsp(finalDevice);
    addLog(`เลือกอุปกรณ์ MAC: ${finalDevice.macAddress}`);

    checkEspStatus(finalDevice.ip);
    
    // 2. [ปรับปรุง] เพิ่มเวลาหน่วงเป็น 2 วินาที เพื่อให้ ESP32 พร้อมรับคำสั่ง scan
    // และเพิ่ม log ให้เห็นว่าเรากำลังจะสั่ง scan
   
    
  };
 
  // ฟังก์ชันหลักตรวจสถานะ
let isAlreadySaved = false;
const checkEspStatus = async (ip, device) => {
    if (!ip) return;
    try {
      const baseUrl = `http://${ip}`;
      const [resDevice, resStatus] = await Promise.all([
       axios.get(`${baseUrl}/text_sensor/ble_scan_status`, { timeout: 3000 }),
       axios.get(`${baseUrl}/binary_sensor/bms_online_status`, { timeout: 3000 })
      ]);

      let scanText = resDevice.data?.state || "";
      const isOnline = resStatus.data?.state === "ON" || resStatus.data?.state === true;

      // เพิ่ม Log เช็คสถานะออนไลน์
      addLog(`Status: ${scanText} (Online: ${isOnline})`); 

      // --- [แก้ไข] Regex ใหม่ ---
      // หา [ แล้วหยิบตัวเลข/จุด ยาวๆ จนกว่าจะเจอช่องว่างหรือ ]
      const match = scanText.match(/\[([0-9A-Fa-f.]{16,})[\s\]]/);
      
      if (match && match[1]) {
        const foundMac = match[1]; // นี่คือ MAC ของคุณ
        console.log("Match Found:", foundMac);
        setDetectedBmsMac(foundMac);
        
        // ตรงนี้ต้องมั่นใจว่า isOnline เป็น true
        if (isOnline){ 
          addLog(`✅ พบ MAC และ Online: กำลังบันทึก...`);
          updateToFirebase(foundMac, device);
          
          registerDeviceToRegistry(device);
          isAlreadySaved =true;
        } else {
          addLog(`⚠️ พบ MAC แต่สถานะยัง Offline (ไม่บันทึก)`);
        }
      } else {
        console.log("No MAC found, Text:", scanText);
        setDetectedBmsMac(null);
      }

      setBmsStatus({ discoveredDevice: scanText, isOnline, espConnected: true });
    } catch (err) {
      addLog(`Error: ไม่สามารถดึงข้อมูลจาก ESP32`);
      setBmsStatus({ espConnected: false, isOnline: false });
      setDetectedBmsMac(null);
    }
  };
  // --- Handlers ---
 const handleScanEsp32 = async () => {
  setLoadingEspScan(true);
  setAvailableEspDevices([]);
  setSelectedEsp(null);

  // กำหนดวง IP ที่ต้องการสแกน (เพิ่มกี่วงก็ได้ตามต้องการ)
  const subnets = ['192.168.0', '192.168.1']; 
  addLog(`กำลังสแกนเครือข่าย: ${subnets.join(', ')} ...`);

  const found = [];
  const scanPromises = [];

  // ใช้ Loop ซ้อน Loop เพื่อสแกนทุกวง
  for (const prefix of subnets) {
    for (let i = 10; i <= 140; i++) {
      const ip = `${prefix}.${i}`;
      
      scanPromises.push(
        axios.get(`http://${ip}/text_sensor/ble_scan_status`, { timeout: 800 })
          .then(() => {
            // ป้องกันการบันทึกซ้ำหากเจอ IP เดิม (เผื่อกรณี Scan สลับวง)
            if (!found.find(item => item.ip === ip)) {
               found.push({ chipId: `ESP32 (${ip})`, ip: ip });
            }
          })
          .catch(() => {}) // ไม่ต้องทำอะไรถ้าเจอ Error (Timeout)
      );
    }
  }

  await Promise.all(scanPromises);
  
  setAvailableEspDevices(found);
  setLoadingEspScan(false);
  addLog(`✅ สแกนสำเร็จ: พบ ${found.length} เครื่อง`);
 };
 
  const handleScanBms = async () => {
    if (!selectedEsp) return;
    try {
      await fetch(`http://${selectedEsp.ip}/button/btn_scan_bms/press`, { method: 'POST', mode: 'no-cors' });
      addLog("ส่งคำสั่ง: สแกนสัญญาณ BLE...");
    } catch (e) { addLog("✅ สั่งการสำเร็จ"); }
  };

  const handleConnectBms = async () => {
    if (!selectedEsp) return;
    try {
      await axios.post(`http://${selectedEsp.ip}/button/btn_connect_bms/press`);
      addLog("ส่งคำสั่ง: เชื่อมต่อ JK BMS...");
    } catch (e) { addLog("❌ เชื่อมต่อล้มเหลว"); }
  };

  const handleDisconnectBms = async () => {
    if (!selectedEsp) return;
    try {
      await axios.post(`http://${selectedEsp.ip}/button/btn_disconnect_bms/press`);
      addLog("ส่งคำสั่ง: ยกเลิกการจับคู่...");
    } catch (e) { addLog("❌ คำสั่ง Unpair ล้มเหลว"); }
  };

  // --- Render ---
  return (
    <div style={{ backgroundColor: '#f8f9fa', minHeight: '100vh', padding: '32px 24px', fontFamily: '"Segoe UI", Tahoma, sans-serif', color: '#2d3748' }}>
      <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
        
        {/* Banner */}
        <div style={{ backgroundColor: '#ffffff', borderRadius: '16px', padding: '24px 32px', marginBottom: '24px', boxShadow: '0 2px 12px rgba(0,0,0,0.03)', display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ backgroundColor: '#f3e8ff', color: '#a855f7', width: '52px', height: '52px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' }}>📥</div>
          <div>
            <h1 style={{ margin: 0, fontSize: '22px', fontWeight: '700', color: '#1a202c' }}>ESPHome JK-BMS Control Center</h1>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#718096' }}>จัดการอุปกรณ์ใน LAN และติดตามสถานะแบบ Real-time</p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: '24px' }}>
          
          {/* Left Controls */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ backgroundColor: '#ffffff', borderRadius: '16px', padding: '20px', boxShadow: '0 2px 12px rgba(0,0,0,0.03)' }}>
              <label style={{ fontSize: '13px', fontWeight: '600', marginBottom: '10px', display: 'block' }}>ค้นหาบอร์ดใน LAN</label>
              <button onClick={handleScanEsp32} disabled={loadingEspScan} style={{ width: '100%', padding: '12px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', cursor: 'pointer' }}>
                {loadingEspScan ? "⏳ กำลังสแกน..." : "🔍 สแกนหา ESP32 ใน LAN"}
              </button>
              {availableEspDevices.map((dev) => (
                <div key={dev.ip} onClick={() => handleSelectEsp(dev)} style={{ marginTop: '10px', padding: '12px', borderRadius: '10px', border: selectedEsp?.ip === dev.ip ? '2px solid #a855f7' : '1px solid #edf2f7', backgroundColor: selectedEsp?.ip === dev.ip ? '#faf5ff' : '#f8fafc', cursor: 'pointer' }}>
                  <div style={{ fontWeight: '600' }}>{dev.chipId}</div>
                </div>
              ))}
            </div>

            <div style={{ backgroundColor: '#ffffff', borderRadius: '16px', padding: '20px', boxShadow: '0 2px 12px rgba(0,0,0,0.03)' }}>
              <button onClick={handleScanBms} disabled={!selectedEsp} style={{ width: '100%', padding: '12px', marginBottom: '10px', backgroundColor: '#a855f7', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer' }}>สแกนหา JK BMS</button>
              <button onClick={handleConnectBms} disabled={!selectedEsp} style={{ width: '100%', padding: '12px', marginBottom: '10px', backgroundColor: '#ffffff', border: '1px solid #a855f7', color: '#a855f7', borderRadius: '10px', cursor: 'pointer' }}>เชื่อมต่อ</button>
              <button onClick={handleDisconnectBms} disabled={!selectedEsp} style={{ width: '100%', padding: '10px', backgroundColor: '#fff5f5', border: '1px solid #feb2b2', color: '#e53e3e', borderRadius: '10px', cursor: 'pointer' }}>ยกเลิกจับคู่</button>
            </div>
          </div>

          {/* Right Column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Status Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
              <div style={{ backgroundColor: '#ffffff', padding: '16px', borderRadius: '14px', boxShadow: '0 2px 12px rgba(0,0,0,0.03)' }}>
                <div style={{ fontSize: '11px', color: '#a0aec0' }}>BMS MAC</div>
                <div style={{ fontWeight: '600', color: detectedBmsMac ? '#a855f7' : '#718096' }}>{detectedBmsMac || "---"}</div>
              </div>
              <div style={{ backgroundColor: '#ffffff', padding: '16px', borderRadius: '14px', boxShadow: '0 2px 12px rgba(0,0,0,0.03)' }}>
                <div style={{ fontSize: '11px', color: '#a0aec0' }}>WI-FI STATUS</div>
                <div style={{ fontWeight: '600', color: bmsStatus.espConnected ? '#38a169' : '#e53e3e' }}>{bmsStatus.espConnected ? 'Connected' : 'Offline'}</div>
              </div>
              <div style={{ backgroundColor: '#ffffff', padding: '16px', borderRadius: '14px', boxShadow: '0 2px 12px rgba(0,0,0,0.03)' }}>
                <div style={{ fontSize: '11px', color: '#a0aec0' }}>BLE STATUS</div>
                <div style={{ fontWeight: '600', color: bmsStatus.isOnline ? '#38a169' : '#4a5568' }}>{bmsStatus.isOnline ? 'Online' : 'Idle'}</div>
              </div>
            </div>

            {/* Terminal */}
            <div style={{ backgroundColor: '#0d1117', borderRadius: '16px', padding: '20px', color: '#48bb78', fontFamily: 'monospace', minHeight: '300px' }}>
              <div style={{ color: '#a0aec0', marginBottom: '16px' }}>&gt;_ Live Log Status</div>
              {logs.map((log, i) => <div key={i}>{log}</div>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}