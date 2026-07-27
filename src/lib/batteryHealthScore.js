// Battery Health Score (0-100): a 5-factor weighted score computed entirely
// from real fields already live on each device (SOC/percent_remain, cell
// voltage spread, temperatures, the same threshold-breach alarms
// alarms.js already derives, and the BMS's own configured current limits
// - contChgCurr/contDsgCurr in REMOTE_SETTINGS_MAP). Nothing here is
// hardcoded per device; every call only ever sees the one pack's own
// values, so BMS1/2/3 are always scored independently.
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

// 1. SOC Range - 40 points. 20-90% is "appropriate use" and gets full
// marks; below 20% costs 2 points per 1% under, above 90% costs 1 point
// per 1% over (asymmetric - overcharging every cycle wears a LiFePO4 pack
// faster than a deep-ish discharge does).
function scoreSoc(soc) {
  if (typeof soc !== "number" || Number.isNaN(soc)) return null;
  if (soc >= 20 && soc <= 90) return 40;
  if (soc < 20) return clamp(40 - (20 - soc) * 2, 0, 40);
  return clamp(40 - (soc - 90) * 1, 0, 40);
}

// 2. Cell Balance - 20 points, stepped on delta_cell_voltage (mV).
function scoreBalance(voltDiffMv) {
  if (typeof voltDiffMv !== "number" || Number.isNaN(voltDiffMv)) return null;
  if (voltDiffMv <= 10) return 20;
  if (voltDiffMv <= 20) return 18;
  if (voltDiffMv <= 30) return 16;
  if (voltDiffMv <= 50) return 12;
  return 8;
}

// 3. Temperature - 20 points, stepped on the hottest reported channel.
// Below 20°C is treated the same as the 20-40°C band (this app has no
// cold-charge alarm concept to score against) - only heat is penalized.
function scoreTemperature(maxTemp) {
  if (typeof maxTemp !== "number" || Number.isNaN(maxTemp)) return null;
  if (maxTemp <= 40) return 20;
  if (maxTemp <= 45) return 18;
  if (maxTemp <= 50) return 15;
  if (maxTemp <= 55) return 10;
  return 0;
}

// 4. Alarm/Fault - 10 points, from the same live threshold-breach alarms
// already shown in the Alarms panel (alarms.js) - "critical" severity is a
// Fault, "warning" severity is a Warning, none is clean.
function scoreAlarm(alarms) {
  if (!Array.isArray(alarms)) return null;
  if (alarms.some((a) => a.severity === "critical")) return 0;
  if (alarms.some((a) => a.severity === "warning")) return 5;
  return 10;
}

// 5. Charge/Discharge Current - 10 points, against the BMS's own
// configured continuous current limits (settings.contChgCurr while
// charging, settings.contDsgCurr while discharging) - not an app-invented
// threshold. Deducts proportionally to how far over the limit the reading
// is; idle (no current either way) has nothing to violate, full marks.
function scoreCurrent(current, contChgCurr, contDsgCurr) {
  if (typeof current !== "number" || Number.isNaN(current)) return null;
  if (current === 0) return 10;
  const limit = current > 0 ? contChgCurr : contDsgCurr;
  if (typeof limit !== "number" || limit <= 0) return null;
  const absCurrent = Math.abs(current);
  if (absCurrent <= limit) return 10;
  const excessRatio = (absCurrent - limit) / limit;
  return clamp(10 - 10 * excessRatio, 0, 10);
}

const RATINGS = [
  { min: 95, label: "Excellent", tone: "excellent" },
  { min: 85, label: "Very Good", tone: "very-good" },
  { min: 70, label: "Good", tone: "good" },
  { min: 50, label: "Fair", tone: "fair" },
  { min: 0, label: "Poor", tone: "poor" },
];

function rate(score) {
  return RATINGS.find((r) => score >= r.min) ?? RATINGS[RATINGS.length - 1];
}

/**
 * @param {number} soc - state of charge (%)
 * @param {number} voltDiffMv - cell voltage imbalance (delta_cell_voltage, mV)
 * @param {number} maxTemp - highest reported temperature (°C)
 * @param {Array<{severity: string}>} alarms - live alarms from computeAlarms()
 * @param {number} current - signed pack current (A)
 * @param {number} contChgCurr - BMS-configured continuous charge current limit (A)
 * @param {number} contDsgCurr - BMS-configured continuous discharge current limit (A)
 * @returns {{ score: number|null, rating: string, tone: string, breakdown: { soc: number|null, balance: number|null, temperature: number|null, alarm: number|null, current: number|null } }}
 */
export function computeBatteryHealthScore({ soc, voltDiffMv, maxTemp, alarms, current, contChgCurr, contDsgCurr }) {
  const breakdown = {
    soc: scoreSoc(soc),
    balance: scoreBalance(voltDiffMv),
    temperature: scoreTemperature(maxTemp),
    alarm: scoreAlarm(alarms),
    current: scoreCurrent(current, contChgCurr, contDsgCurr),
  };

  const available = Object.values(breakdown).filter((v) => v != null);
  if (available.length === 0) {
    return { score: null, rating: "N/A", tone: "unknown", breakdown };
  }

  const score = Math.round(available.reduce((sum, v) => sum + v, 0));
  const { label, tone } = rate(score);
  return { score: clamp(score, 0, 100), rating: label, tone, breakdown };
}
