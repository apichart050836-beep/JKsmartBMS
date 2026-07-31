import React, { useState, useRef } from 'react';

const PRESET_DEVICES = [
  { name: 'ESP32 - Living Room', ip: '192.168.1.4' },
];

export default function ESPHomeUpdater() {
  const [deviceIp, setDeviceIp] = useState('192.168.1.4');
  const [otaPassword, setOtaPassword] = useState('');
  const [file, setFile] = useState(null);

  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [flashStage, setFlashStage] = useState('idle'); // 'idle' | 'uploading' | 'flashing' | 'success' | 'error'
  const [isUploading, setIsUploading] = useState(false);

  const startTimeRef = useRef(null);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setProgress(0);
      setStatus('');
      setFlashStage('idle');
    }
  };

  const handleUpdate = (e) => {
    e.preventDefault();

    if (!file) {
      alert('กรุณาเลือกไฟล์ .bin ก่อนทำการอัปเดต');
      return;
    }
    if (!deviceIp) {
      alert('กรุณาระบุ IP Address ของ ESPHome');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('deviceIp', deviceIp);
    if (otaPassword) {
      formData.append('password', otaPassword);
    }

    setIsUploading(true);
    setFlashStage('uploading');
    setStatus(`[1/3] กำลังส่งไฟล์ Firmware ไปยัง Server...`);
    setProgress(0);
    startTimeRef.current = Date.now();

    const xhr = new XMLHttpRequest();
    const backendBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';
    const backendUrl = `${backendBase}/api/esphome/update`;

    // ติดตามการส่งไฟล์จาก เบราว์เซอร์ -> Node.js
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percentCompleted = Math.min(100, Math.round((event.loaded * 100) / event.total));
        setProgress(percentCompleted);

        if (percentCompleted < 100) {
          setStatus(`[1/3] กำลังอัปโหลดไฟล์ไปยัง Server (${percentCompleted}%)`);
        } else {
          // เมื่ออัปโหลดครบ 100% เปลี่ยนสถานะเป็น Flashing
          setFlashStage('flashing');
          setStatus(`[2/3] Server กำลังเขียน Firmware ลง Flash Memory ของ ESP32 (${deviceIp})... ห้ามปิดหน้านี้`);
        }
      }
    };

    // เมื่อ Server ทำการ Flash เสร็จสิ้นแล้วส่ง Response กลับมา
    xhr.onload = () => {
      setIsUploading(false);
      if (xhr.status === 200) {
        setFlashStage('success');
        setProgress(100);
        setStatus(`[3/3] ✅ อัปเดต Firmware ลง ESP32 (${deviceIp}) สำเร็จแล้ว! อุปกรณ์กำลัง Reboot...`);
      } else {
        setFlashStage('error');
        try {
          const res = JSON.parse(xhr.responseText);
          setStatus(`❌ เกิดข้อผิดพลาด: ${res.error || res.details || xhr.statusText}`);
        } catch {
          setStatus(`❌ เกิดข้อผิดพลาดจาก Server (Status: ${xhr.status})`);
        }
      }
    };

    xhr.onerror = () => {
      setIsUploading(false);
      setFlashStage('error');
      setStatus('❌ ไม่สามารถเชื่อมต่อกับ Backend Server ได้');
    };

    xhr.open('POST', backendUrl, true);
    xhr.send(formData);
  };

  // กำหนดสีของ Progress Bar ตาม Stage
  const getProgressBarColor = () => {
    switch (flashStage) {
      case 'flashing': return '#ff9800'; // สีส้ม: กำลังเขียน Flash
      case 'success': return '#4caf50';  // สีเขียว: สำเร็จ
      case 'error': return '#f44336';    // สีแดง: เกิดข้อผิดพลาด
      default: return '#2196f3';         // สีฟ้า: กำลังอัปโหลด
    }
  };

  return (
    <div style={styles.card}>
      <h2 style={styles.title}>ESPHome Firmware Updater</h2>
      <p style={styles.subtitle}>เลือกบอร์ด ESPHome ที่ต้องการอัปเดต Firmware</p>

      <form onSubmit={handleUpdate} style={styles.form}>
        <div style={styles.field}>
          <label style={styles.label}>เลือกอุปกรณ์ ESPHome Target:</label>
          <select
            value={deviceIp}
            onChange={(e) => setDeviceIp(e.target.value)}
            disabled={isUploading}
            style={styles.input}
          >
            {PRESET_DEVICES.map((device) => (
              <option key={device.ip} value={device.ip}>
                {device.name} ({device.ip})
              </option>
            ))}
          </select>
        </div>

        <div style={styles.field}>
          <label style={styles.label}>หรือระบุ IP Address เอง:</label>
          <input
            type="text"
            value={deviceIp}
            onChange={(e) => setDeviceIp(e.target.value)}
            placeholder="เช่น 192.168.1.150"
            disabled={isUploading}
            style={styles.input}
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label}>OTA Password (ถ้ามี):</label>
          <input
            type="password"
            value={otaPassword}
            onChange={(e) => setOtaPassword(e.target.value)}
            placeholder="ใส่รหัสผ่าน OTA"
            disabled={isUploading}
            style={styles.input}
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label}>เลือกไฟล์ Firmware (.bin):</label>
          <input
            type="file"
            accept=".bin"
            onChange={handleFileChange}
            disabled={isUploading}
            style={styles.input}
          />
        </div>

        <button
          type="submit"
          disabled={isUploading || !file}
          style={isUploading || !file ? styles.buttonDisabled : styles.button}
        >
          {isUploading
            ? flashStage === 'flashing'
              ? `⚡ กำลัง Flash ลง ESP32...`
              : `⬆️ กำลังอัปโหลดไฟล์...`
            : 'เริ่มอัปเดต Firmware'}
        </button>
      </form>

      {/* Progress & Stage Indicator */}
      {(isUploading || flashStage !== 'idle') && (
        <div style={styles.progressSection}>
          <div style={styles.percentHeader}>
            <span style={{ ...styles.percentText, color: getProgressBarColor() }}>
              {flashStage === 'flashing' ? '⚡ Flashing...' : `${progress}%`}
            </span>
            <span style={styles.bytesText}>Target: {deviceIp}</span>
          </div>

          <div style={styles.progressTrack}>
            <div
              style={{
                ...styles.progressBar,
                width: flashStage === 'flashing' ? '100%' : `${progress}%`,
                backgroundColor: getProgressBarColor(),
                // เมื่ออยู่ขั้นตอน Flashing ให้หลอดวิ่งแบบ Animation
                animation: flashStage === 'flashing' ? 'pulse 1.5s infinite' : 'none',
              }}
            />
          </div>
        </div>
      )}

      {status && (
        <div
          style={{
            ...styles.statusBox,
            backgroundColor:
              flashStage === 'success'
                ? '#e8f5e9'
                : flashStage === 'error'
                ? '#ffebee'
                : flashStage === 'flashing'
                ? '#fff3e0'
                : '#f0f0f0',
            borderColor: getProgressBarColor(),
          }}
        >
          {status}
        </div>
      )}
    </div>
  );
}

const styles = {
  card: { maxWidth: '500px', margin: '20px auto', padding: '24px', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', backgroundColor: '#fff' },
  title: { margin: '0 0 6px 0', fontSize: '20px' },
  subtitle: { margin: '0 0 20px 0', color: '#666', fontSize: '14px' },
  form: { display: 'flex', flexDirection: 'column', gap: '14px' },
  field: { display: 'flex', flexDirection: 'column', gap: '6px' },
  label: { fontSize: '13px', fontWeight: '600' },
  input: { padding: '8px 12px', borderRadius: '6px', border: '1px solid #ccc' },
  button: { padding: '10px', backgroundColor: '#03a9f4', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' },
  buttonDisabled: { padding: '10px', backgroundColor: '#e0e0e0', color: '#999', border: 'none', borderRadius: '6px', cursor: 'not-allowed' },
  progressSection: { marginTop: '20px', padding: '12px', backgroundColor: '#f9f9f9', borderRadius: '8px' },
  percentHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' },
  percentText: { fontSize: '20px', fontWeight: 'bold' },
  bytesText: { fontSize: '12px', color: '#666' },
  progressTrack: { height: '10px', backgroundColor: '#e0e0e0', borderRadius: '5px', overflow: 'hidden' },
  progressBar: { height: '100%', transition: 'width 0.3s ease, background-color 0.3s ease' },
  statusBox: { marginTop: '16px', padding: '12px', borderRadius: '6px', textAlign: 'center', fontSize: '13px', borderLeft: '4px solid #ccc', fontWeight: '500' },
};