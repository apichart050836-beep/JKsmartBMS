import React from "react";
import { Zap } from "lucide-react";
import "./ElectricGauge.css";

// Same battery silhouette + smooth liquid-style wave as the reference image,
// just themed electric instead of water: the fill flickers gently like live
// current, sparks glow brighter than plain bubbles, and there's a soft
// pulsing outer glow that rises/falls with charge state.
export function ElectricGauge({ socPercent = 0, isCharging = false }) {
  const soc = Math.min(Math.max(Number(socPercent) || 0, 0), 100);
  const tone = soc < 30 ? "critical" : soc <= 60 ? "warning" : "good";

  return (
    <div className={`electric-battery-wrapper ${tone}`}>
      <div className="electric-battery-outer">
        <div className="electric-battery-cap" />
        <div className="electric-battery-body">
          <div className="electric-glass-glare" />

          <div className="electric-fill" style={{ height: `${soc}%` }}>
            <div className="e-wave e-wave-1">
              <svg viewBox="0 0 1200 120" preserveAspectRatio="none">
                <path d="M0,0 C150,90 350,-40 500,40 C650,120 900,10 1200,40 L1200,120 L0,120 Z" />
              </svg>
            </div>
            <div className="e-wave e-wave-2">
              <svg viewBox="0 0 1200 120" preserveAspectRatio="none">
                <path d="M0,0 C200,60 400,-20 600,50 C800,110 1000,20 1200,60 L1200,120 L0,120 Z" />
              </svg>
            </div>

            <div className="electric-sparks">
              <span className="e-spark s1" />
              <span className="e-spark s2" />
              <span className="e-spark s3" />
              <span className="e-spark s4" />
              <span className="e-spark s5" />
            </div>
          </div>

          <div className="electric-battery-percentage">
            {isCharging && <Zap className="electric-battery-bolt-icon" />}
            {Math.round(soc)}
            <span className="electric-battery-unit">%</span>
          </div>
        </div>
      </div>
      <div className="electric-battery-glow" />
    </div>
  );
}

export default ElectricGauge;
