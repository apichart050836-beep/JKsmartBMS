// Battery Health Score: a single 0-100 composite built from real signals
// already on the device - state_of_health, cell voltage imbalance
// (delta_cell_voltage), max pack temperature, and wire resistance spread
// across cell taps. A plain weighted formula, not a model call - SOH
// carries the most weight since it's the one field the BMS itself already
// reports as a health verdict; the rest are secondary signals that can
// catch problems (a swelling cell, a loose connection, running hot) before
// they show up in SOH.
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

const WEIGHTS = { soh: 0.5, balance: 0.25, temp: 0.15, resistance: 0.1 };

/**
 * @param {number} soh - state_of_health (%)
 * @param {number} voltDiffMv - cell voltage imbalance (delta_cell_voltage, mV)
 * @param {number} maxTemp - highest reported temperature (°C)
 * @param {number} otpThreshold - over-temp protection threshold (°C), the scale's "0 points" ceiling
 * @param {number[]} wireResistances - per-cell wiring/busbar resistance (mΩ)
 * @returns {{ score: number, breakdown: { soh: number, balance: number, temp: number, resistance: number } }}
 */
export function computeBatteryHealthScore({ soh, voltDiffMv, maxTemp, otpThreshold = 70, wireResistances = [] }) {
  const sohScore = clamp(soh, 0, 100);
  // 0mV imbalance -> 100, 100mV+ -> 0
  const balanceScore = clamp(100 - (voltDiffMv / 100) * 100, 0, 100);
  // 0°C -> 100, at/above the OTP threshold -> 0
  const tempScore = clamp(100 - (maxTemp / otpThreshold) * 100, 0, 100);
  // Spread (max - min) across cell taps - a wide spread suggests one bad
  // connection rather than uniform wear. 0mOhm spread -> 100, 50mOhm+ -> 0.
  const validResistances = wireResistances.filter((r) => typeof r === "number" && r > 0);
  const resistanceSpread = validResistances.length ? Math.max(...validResistances) - Math.min(...validResistances) : 0;
  const resistanceScore = clamp(100 - (resistanceSpread / 50) * 100, 0, 100);

  const score = Math.round(
    sohScore * WEIGHTS.soh + balanceScore * WEIGHTS.balance + tempScore * WEIGHTS.temp + resistanceScore * WEIGHTS.resistance
  );

  return {
    score: clamp(score, 0, 100),
    breakdown: { soh: sohScore, balance: balanceScore, temp: tempScore, resistance: resistanceScore },
  };
}
