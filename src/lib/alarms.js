// Live threshold-breach computation - there is no alarm/event field anywhere
// in Firebase (confirmed via curl against JK_BMS_HUB/.../status), so "alarms"
// here means: compare the live status values useBmsPackLive already exposes
// against the protection thresholds already configured in Settings
// (REMOTE_SETTINGS_MAP in BMSDashboard.jsx). This is a live snapshot, not a
// historical log - it reflects what's breached right now.
export function computeAlarms(active, settings) {
  if (!active || !settings) return [];
  const alarms = [];

  const liveCells = (active.cells ?? []).filter((v) => v > 0);
  if (liveCells.length) {
    const maxCell = Math.max(...liveCells);
    const minCell = Math.min(...liveCells);
    if (maxCell > settings.cellOvp) {
      alarms.push({
        id: "cellOvp",
        label: "Cell Over-Voltage",
        value: `${maxCell.toFixed(3)} V`,
        limit: `> ${settings.cellOvp.toFixed(3)} V`,
        severity: "critical",
      });
    }
    if (minCell < settings.cellUvp) {
      alarms.push({
        id: "cellUvp",
        label: "Cell Under-Voltage",
        value: `${minCell.toFixed(3)} V`,
        limit: `< ${settings.cellUvp.toFixed(3)} V`,
        severity: "critical",
      });
    }
  }

  if (typeof active.voltDiffMv === "number" && active.voltDiffMv > settings.balDeltaVolt) {
    alarms.push({
      id: "cellImbalance",
      label: "Cell Imbalance",
      value: `${active.voltDiffMv} mV`,
      limit: `> ${settings.balDeltaVolt} mV`,
      severity: "warning",
    });
  }

  const t1 = active.temps?.t1 ?? 0;
  const t2 = active.temps?.t2 ?? 0;
  const cmos = active.temps?.cmosTemp ?? 0;

  if (active.chargeMOS && Math.max(t1, t2) > settings.chgOtp) {
    alarms.push({
      id: "chgOtp",
      label: "Charge Over-Temperature",
      value: `${Math.max(t1, t2).toFixed(1)}°C`,
      limit: `> ${settings.chgOtp}°C`,
      severity: "critical",
    });
  }
  if (active.dischargeMOS && Math.max(t1, t2) > settings.dsgOtp) {
    alarms.push({
      id: "dsgOtp",
      label: "Discharge Over-Temperature",
      value: `${Math.max(t1, t2).toFixed(1)}°C`,
      limit: `> ${settings.dsgOtp}°C`,
      severity: "critical",
    });
  }
  if (active.dischargeMOS && Math.min(t1, t2) < settings.dsgUtp) {
    alarms.push({
      id: "dsgUtp",
      label: "Discharge Under-Temperature",
      value: `${Math.min(t1, t2).toFixed(1)}°C`,
      limit: `< ${settings.dsgUtp}°C`,
      severity: "warning",
    });
  }
  if (cmos > settings.cmosOtp) {
    alarms.push({
      id: "cmosOtp",
      label: "MOSFET Over-Temperature",
      value: `${cmos.toFixed(1)}°C`,
      limit: `> ${settings.cmosOtp}°C`,
      severity: "critical",
    });
  }

  if (active.chargeMOS && active.current > settings.contChgCurr) {
    alarms.push({
      id: "chgOcp",
      label: "Charge Over-Current",
      value: `${active.current.toFixed(1)} A`,
      limit: `> ${settings.contChgCurr} A`,
      severity: "critical",
    });
  }

  return alarms;
}
