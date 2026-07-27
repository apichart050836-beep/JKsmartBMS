// Remaining Runtime: how long the pack can keep discharging at its current
// draw before it's empty. Every input is a real per-device field already
// extracted in useBmsPackLive.js (nominal_capacity, capacity_remain,
// percent_remain, battery_voltage, charge_current, battery_power) - nothing
// here is hardcoded per battery model, and each call only ever sees the one
// device's own status, so BMS1/2/3 never share data.
const STANDBY_THRESHOLD_A = 0.5;

function formatDuration(hours) {
  const totalMinutes = Math.round(hours * 60);
  const days = Math.floor(totalMinutes / (24 * 60));
  const afterDays = totalMinutes % (24 * 60);
  const hrs = Math.floor(afterDays / 60);
  const mins = afterDays % 60;

  const parts = [];
  if (days > 0) parts.push(`${days} วัน`);
  if (hrs > 0) parts.push(`${hrs} ชั่วโมง`);
  if (mins > 0 || parts.length === 0) parts.push(`${mins} นาที`);
  return parts.join(" ");
}

/**
 * @param {number} current - signed pack current (A): + charging, - discharging
 * @param {number|null|undefined} power - signed pack power (W), same sign convention as current; null/undefined if the device doesn't report it
 * @param {number|null|undefined} remainingCapacityAh - real remaining capacity (Ah) if the device reports it directly
 * @param {number} ratedCapacityAh - nameplate/rated capacity (Ah), used only when remainingCapacityAh is missing
 * @param {number} soc - state of charge (%), used only when remainingCapacityAh is missing
 * @param {number} voltage - pack voltage (V), used for the Wh-based formula
 * @returns {{ state: "charging" | "standby" | "discharging", label: string, hours: number | null }}
 */
export function computeRemainingRuntime({ current, power, remainingCapacityAh, ratedCapacityAh, soc, voltage }) {
  if (Math.abs(current) < STANDBY_THRESHOLD_A) {
    return { state: "standby", label: "Standby", hours: null };
  }
  if (current > 0) {
    return { state: "charging", label: "Charging...", hours: null };
  }

  const remainingAh =
    typeof remainingCapacityAh === "number" && !Number.isNaN(remainingCapacityAh)
      ? remainingCapacityAh
      : ratedCapacityAh * (soc / 100);

  if (remainingAh <= 0) {
    return { state: "discharging", label: "0 นาที", hours: 0 };
  }

  // Prefer the Wh/W formula when Battery Power is actually reported - more
  // accurate than Ah/A since it already accounts for voltage sag under
  // load instead of assuming a flat discharge curve.
  const loadPower = typeof power === "number" && !Number.isNaN(power) ? Math.abs(power) : null;
  const hours = loadPower && loadPower > 0 ? (remainingAh * voltage) / loadPower : remainingAh / Math.abs(current);

  return { state: "discharging", label: formatDuration(hours), hours };
}
