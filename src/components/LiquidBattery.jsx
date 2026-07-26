import React from "react";
import "./LiquidBattery.css";

// SOC visual for the "Power & Energy Status" card - glass battery with an
// animated liquid fill (waves + rising bubbles). Color band: >60% green,
// 30-60% orange, <30% red.
export function LiquidBattery({ socPercent = 0, isCharging = false }) {
  const soc = Math.min(Math.max(Number(socPercent) || 0, 0), 100);

  let statusClass = "good";
  if (soc < 30) {
    statusClass = "critical";
  } else if (soc <= 60) {
    statusClass = "warning";
  }

  return (
    <div className={`liquid-battery-wrapper ${statusClass}`}>
      <div className="battery-outer">
        <div className="battery-cap" />
        <div className="battery-body">
          <div className="glass-glare" />
          <div className="liquid-fill" style={{ height: `${soc}%` }}>
            <div className="wave wave-1">
              <svg viewBox="0 0 1200 120" preserveAspectRatio="none">
                <path d="M0,0 C150,90 350,-40 500,40 C650,120 900,10 1200,40 L1200,120 L0,120 Z" />
              </svg>
            </div>
            <div className="wave wave-2">
              <svg viewBox="0 0 1200 120" preserveAspectRatio="none">
                <path d="M0,0 C200,60 400,-20 600,50 C800,110 1000,20 1200,60 L1200,120 L0,120 Z" />
              </svg>
            </div>
            <div className="bubbles-container">
              <span className="bubble b1" />
              <span className="bubble b2" />
              <span className="bubble b3" />
              <span className="bubble b4" />
              <span className="bubble b5" />
            </div>
          </div>
          <div className="battery-percentage">
            {Math.round(soc)}
            <span className="unit">%</span>
            {isCharging && <span className="charging-icon">⚡</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default LiquidBattery;
