// Shared status-color tokens + small numeric helpers used across the
// BMS dashboard, the cell-balancing chart, and the detailed log table.

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export const jitter = (v, amount) => v + (Math.random() * 2 - 1) * amount;

export function statusTone(kind) {
  // kind: "good" | "warning" | "critical" | "info" | "brand"
  return {
    good: { fg: "text-[var(--good)]", bg: "bg-[var(--good-10)]", stroke: "var(--good)" },
    warning: { fg: "text-[var(--warning)]", bg: "bg-[var(--warning-10)]", stroke: "var(--warning)" },
    critical: { fg: "text-[var(--critical)]", bg: "bg-[var(--critical-10)]", stroke: "var(--critical)" },
    info: { fg: "text-[var(--info)]", bg: "bg-[var(--info-10)]", stroke: "var(--info)" },
    brand: { fg: "text-[var(--brand)]", bg: "bg-[var(--brand-10)]", stroke: "var(--brand)" },
  }[kind];
}

export function socTone(v) {
  if (v > 50) return "good";
  if (v > 20) return "warning";
  return "critical";
}

export function sohTone(v) {
  if (v > 90) return "good";
  if (v > 75) return "warning";
  return "critical";
}

export function voltDiffTone(mv) {
  return voltDiffToneWithThreshold(mv, 20);
}

// Threshold comes from the "Bal. Delta Volt" setting - crossing it is what
// the Active Balancer itself reacts to, so the warning color reacts to the
// same number the user configured instead of a hardcoded constant.
export function voltDiffToneWithThreshold(mv, thresholdMv) {
  if (mv < thresholdMv) return { tone: "good", label: "Balanced" };
  if (mv < thresholdMv * 2.5) return { tone: "warning", label: "Monitor" };
  return { tone: "critical", label: "Imbalanced" };
}

export function tempTone(c) {
  if (c < 40) return { tone: "info", label: "Normal" };
  if (c < 50) return { tone: "warning", label: "Warm" };
  return { tone: "critical", label: "Hot" };
}
