// Battery State of Health (SOH), self-calculated - replaces the BMS's own
// reported state_of_health field per explicit request. Two real, currently-
// available signals, blended:
//
// 1. Capacity SOH: (estimated full-charge capacity / design capacity) x 100.
//    "Estimated full-charge capacity" is derived via coulomb counting from
//    what the BMS already reports right now - capacity_remain (Ah currently
//    held) and percent_remain (SOC%) - rather than requiring a dedicated
//    0->100% calibration cycle the app has no way to run:
//      fullCapacityAh = capacityRemainAh / (socPercent / 100)
//    Design capacity is nominal_capacity (or the user's configured
//    Capacity setting) - the same "design/rated capacity" reference the
//    rest of the app (Remaining Runtime, Time to Full Charge) already uses.
//
// 2. Cycle Aging SOH: an expected-retention curve from cycle_count, using
//    a commonly-cited LFP benchmark (~80% capacity retention around 3000
//    cycles) - an industry-typical figure, NOT this specific battery
//    model's datasheet curve (the app has no per-model aging data to draw
//    from). Swap DESIGN_CYCLE_LIFE/CYCLE_LIFE_RETENTION for real
//    manufacturer numbers if/when available.
//
// Blended 70/30 (capacity-measured leads, cycle-count is a secondary
// sanity signal) rather than multiplied, since cycle aging's physical
// effect is largely already reflected in a genuine capacity-fade
// measurement - multiplying the two would double-count the same aging.
//
// Deliberately does NOT apply a temperature penalty: the app only has the
// device's current instantaneous temperature, not a historical
// operating-temperature log, and thermal aging is a function of
// accumulated exposure, not a single reading - faking that term would be
// exactly the kind of unfounded number this project has explicitly ruled
// out. Temperature stays visible elsewhere on the Dashboard as context.

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

const DESIGN_CYCLE_LIFE = 3000;
const CYCLE_LIFE_RETENTION = 0.8;

function estimatedFullCapacityAh(capacityRemainAh, socPercent) {
  if (typeof capacityRemainAh !== "number" || typeof socPercent !== "number" || socPercent <= 0) return null;
  return capacityRemainAh / (socPercent / 100);
}

function capacitySoh(fullCapacityAh, designCapacityAh) {
  if (!fullCapacityAh || !designCapacityAh) return null;
  return clamp((fullCapacityAh / designCapacityAh) * 100, 0, 100);
}

function cycleAgingSoh(cycleCount) {
  if (typeof cycleCount !== "number" || Number.isNaN(cycleCount)) return null;
  const maxLossPct = (1 - CYCLE_LIFE_RETENTION) * 100;
  const loss = clamp((cycleCount / DESIGN_CYCLE_LIFE) * maxLossPct, 0, maxLossPct);
  return 100 - loss;
}

/**
 * @param {number} capacityRemainAh - real capacity currently held (Ah), e.g. status.capacity_remain
 * @param {number} socPercent - state of charge (%), e.g. status.percent_remain
 * @param {number} designCapacityAh - design/rated capacity (Ah), e.g. status.nominal_capacity
 * @param {number} cycleCount - real cycle_count
 * @returns {{ soh: number|null, capacitySoh: number|null, cycleSoh: number|null, fullCapacityAh: number|null }}
 */
export function computeSoh({ capacityRemainAh, socPercent, designCapacityAh, cycleCount }) {
  const fullCapacityAh = estimatedFullCapacityAh(capacityRemainAh, socPercent);
  const capSoh = capacitySoh(fullCapacityAh, designCapacityAh);
  const cycleSoh = cycleAgingSoh(cycleCount);

  if (capSoh == null && cycleSoh == null) {
    return { soh: null, capacitySoh: null, cycleSoh: null, fullCapacityAh };
  }
  if (capSoh == null) {
    return { soh: Math.round(cycleSoh), capacitySoh: null, cycleSoh: Math.round(cycleSoh), fullCapacityAh };
  }
  if (cycleSoh == null) {
    return { soh: Math.round(capSoh), capacitySoh: Math.round(capSoh), cycleSoh: null, fullCapacityAh };
  }

  const blended = capSoh * 0.7 + cycleSoh * 0.3;
  return {
    soh: Math.round(clamp(blended, 0, 100)),
    capacitySoh: Math.round(capSoh),
    cycleSoh: Math.round(cycleSoh),
    fullCapacityAh,
  };
}
