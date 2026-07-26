import React from "react";
import "./LiquidBattery.css";

export function LiquidBattery({ socPercent = 0, isCharging = false }) {
  const soc = Math.min(Math.max(Number(socPercent) || 0, 0), 100);  // จำกัดค่า % ให้อยู่ในช่วง 0 - 100


  // เปลี่ยนสีของเหลวตามระดับ SOC
  let statusClass = "good"; // > 40% (สีเขียว)
  if (soc <= 20) {
    statusClass = "critical"; // <= 20% (สีแดง)
  } else if (soc <= 40) {
    statusClass = "warning"; // 21-40% (สีส้ม/เหลือง)
  }

  return (
    <div className={`liquid-battery-wrapper ${statusClass}`}>
      <div className="battery-outer">
        {/* ขั้วแบตเตอรี่ด้านบน (Cap) */}
        <div className="battery-cap" />

        {/* ตัวบอดี้แบตเตอรี่ทรงแก้ว (Glass Body) */}
        <div className="battery-body">
          {/* แสงสะท้อนกระจกเงา (Glass Glare) */}
          <div className="glass-glare" />

          {/* ระดับน้ำ/ของเหลวภายใน (Liquid Fill) */}
          <div className="liquid-fill" style={{ height: `${soc}%` }}>
            {/* คลื่นน้ำลูกที่ 1 */}
            <div className="wave wave-1">
              <svg viewBox="0 0 1200 120" preserveAspectRatio="none">
                <path d="M0,0 C150,90 350,-40 500,40 C650,120 900,10 1200,40 L1200,120 L0,120 Z" />
              </svg>
            </div>

            {/* คลื่นน้ำลูกที่ 2 (ซ้อนกันให้มีมิติ 3D) */}
            <div className="wave wave-2">
              <svg viewBox="0 0 1200 120" preserveAspectRatio="none">
                <path d="M0,0 C200,60 400,-20 600,50 C800,110 1000,20 1200,60 L1200,120 L0,120 Z" />
              </svg>
            </div>

            {/* ฟองอากาศผุดลอยขึ้น (Bubbles Animation) */}
            <div className="bubbles-container">
              <span className="bubble b1" />
              <span className="bubble b2" />
              <span className="bubble b3" />
              <span className="bubble b4" />
              <span className="bubble b5" />
            </div>
          </div>

          {/* ตัวเลขเปอร์เซ็นต์ตรงกลาง */}
          <div className="battery-percentage">
            {Math.round(soc)}
            <span className="unit">%</span>
            {isCharging && <span className="charging-icon">⚡</span>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiquidBattery;