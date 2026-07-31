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
  const [flashStage, setFlashStage] = useState('idle'); // 'idle' | 'uploading' | 'success' | 'error'
  const [isUploading, setIsUploading] = useState(false);

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
    // ESPHome Native OTA Web Endpoint รับ Field ชื่อ 'file' (หรือ 'MD5' ถ้ามี)
    formData.append('file', file);
    if (otaPassword) {
      formData.append('password', otaPassword);
    }

    setIsUploading(true);
    setFlashStage('uploading');
    setStatus(`[1/2] กำลังส่งไฟล์ Firmware ตรงไปยัง ESP32 (${deviceIp})... ห้ามปิดหน้านี้`);
    setProgress(0);

    const xhr = new XMLHttpRequest();
    
    // 🎯 แก้จุดนี้: ยิงตรงไปหา IP ของ ESP32 Web Server ในบ้าน
    // ESPHome Native Web Server จะรับไฟล์ที่ Path /update
    const directUrl = `http://${deviceIp}/update`;
    console.log("🚀กำลังส่งไฟล์ Direct OTA ไปที่ URL:", directUrl);

    // ติดตาม Progress การอัปโหลดจากคอมพิวเตอร์ไปยัง ESP32 โดยตรง
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percentCompleted = Math.min(100, Math.round((event.loaded * 100) / event.total));
        setProgress(percentCompleted);
        setStatus(`[1/2] กำลังอัปโหลด Firmware เข้า ESP32 (${percentCompleted}%)`);
      }
    };

    xhr.onload = () => {
      setIsUploading(false);
      if (xhr.status === 200 || xhr.status === 302) {
        setFlashStage('success');
        setProgress(100);
        setStatus(`[2/2] ✅ อัปเดต Firmware ลง ESP32 (${deviceIp}) สำเร็จแล้ว! อุปกรณ์กำลัง Reboot...`);
      } else {
        setFlashStage('error');
        setStatus(`❌ เกิดข้อผิดพลาดจาก ESP32 (Status: ${xhr.status} - ${xhr.statusText})`);
      }
    };

    xhr.onerror = () => {
      setIsUploading(false);
      setFlashStage('error');
      setStatus('❌ ไม่สามารถเชื่อมต่อกับ ESP32 ได้ กรุณาเช็กว่าอยู่ WiFi เดียวกัน หรือเปิด CORS ใน ESPHome แล้วหรือยัง');
    };

    xhr.open('POST', directUrl, true);
    xhr.send(formData);
  };

  const getProgressBarColor = () => {
    switch (flashStage) {
      case 'success': return '#4caf50'; // สีเขียว
      case 'error': return '#f44336';   // สีแดง
      default: return '#2196f3';        // สีฟ้า
    }
  };

  return (
    <div style={styles.card}>
      <h2 style={styles.title}>ESPHome Direct OTA Updater</h2>
      <p style={styles.subtitle}>เลือกบอร์ด ESPHome ที่ต้องการอัปเดต (ส่งไฟล์ตรงในวง LAN)</p>

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
            placeholder="เช่น 192.168.1.4"
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
          {isUploading ? '⬆️ กำลังส่งไฟล์ตรงไปยัง ESP32...' : 'เริ่มอัปเดต Firmware (Direct)'}
        </button>
      </form>

      {(isUploading || flashStage !== 'idle') && (
        <div style={styles.progressSection}>
          <div style={styles.percentHeader}>
            <span style={{ ...styles.percentText, color: getProgressBarColor() }}>
              {progress}%
            </span>
            <span style={styles.bytesText}>Target: http://{deviceIp}/update</span>
          </div>

          <div style={styles.progressTrack}>
            <div
              style={{
                ...styles.progressBar,
                width: `${progress}%`,
                backgroundColor: getProgressBarColor(),
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
                : '#e3f2fd',
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