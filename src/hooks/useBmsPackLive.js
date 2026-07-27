import { useEffect, useState, useMemo, useRef } from "react";
import { voltDiffTone, tempTone } from "../lib/tone.js";
import { pick } from "../lib/pick.js";
import { useHubData } from "../context/HubDataContext.jsx";

const POWER_HISTORY_LEN = 30;
const LOG_LEN = 8;

/**
 * Real JK BMS pack, sourced from HubDataContext's socket-fed hub tree
 * (backend-filtered per session) instead of a direct Firebase subscription -
 * same derived shape as before (cells[], power, temps{}, chargeMOS, ...) so
 * BMSDashboard.jsx and every UI component reading this hook's return value
 * needed zero changes.
 *
 * `config` carries `hubId`/`bmsKey` (bmsKey null for the flat/no-nesting hub
 * shape) instead of one hardcoded Firebase path - see buildBmsSlots in
 * BMSDashboard.jsx.
 */
export function useBmsPackLive(config) {
  const { id, name, hubId, bmsKey, ratedCapacityAh: fallbackCapacityAh } = config;
  const { hubs, socketConnected } = useHubData();

  const [log, setLog] = useState([]);
  const [powerHistory, setPowerHistory] = useState([]);
  const [lastUpdateAt, setLastUpdateAt] = useState(null);
  const lastStatusJsonRef = useRef(null);

  // Pulls this specific device's node out of the hub tree the socket has
  // already delivered - null until that hub has actually arrived (or this
  // slot has no device assigned at all).
  const raw = useMemo(() => {
    if (!hubId) return null;
    const hubData = hubs[hubId];
    if (hubData == null) return null;
    return bmsKey ? hubData[bmsKey] ?? null : hubData;
  }, [hubs, hubId, bmsKey]);

  const status = raw?.status ?? {};
  const info = raw?.info ?? {};
  const remoteSettings = raw?.settings ?? null;
  const adminEnabled = raw?.admin?.enabled ?? true;
  const adminDisabled = !adminEnabled;
  const connected = !!raw && adminEnabled;

  // lastUpdateAt (used for the Online/Offline check) must advance on every
  // push the socket actually delivers for this device, even when the values
  // happen to be identical to the previous push - an idle pack (no current,
  // stable temps) can easily hold the exact same reading across several
  // ESP32 push cycles, and that's not the same thing as the ESP32/BLE link
  // being dead. Log/power-history entries stay deduped on a genuine change
  // below - that's a separate concern (avoid duplicate rows for unchanged
  // readings), not a proxy for liveness.
  useEffect(() => {
    if (!connected) return;
    setLastUpdateAt(Date.now());
  }, [status, connected]);

  useEffect(() => {
    if (!connected) return;
    const statusJson = JSON.stringify(status);
    if (lastStatusJsonRef.current === statusJson) return;
    lastStatusJsonRef.current = statusJson;

    const cells = (pick(status, "cellVoltages", "cell_voltages") ?? []).filter((v) => v > 0);
    const chargeMOS = !!pick(status, "charging_state", "charge");
    const dischargeMOS = !!status.discharge;
    const current = pick(status, "current", "charge_current") ?? 0;
    const statusLabel = chargeMOS ? "Charging" : dischargeMOS ? "Discharging" : "Standby";
    const tempVals = [status.battery_t1, status.battery_t2, status.mos_temp].filter((v) => typeof v === "number");
    const avgTemp = tempVals.length ? tempVals.reduce((a, b) => a + b, 0) / tempVals.length : 0;
    const now = new Date();

    setPowerHistory((prev) => [...prev, { time: now.toLocaleTimeString(), current }].slice(-POWER_HISTORY_LEN));
    setLog((prev) =>
      [
        {
          id: Date.now(),
          time: now.toLocaleTimeString(),
          minV: cells.length ? Math.min(...cells) : 0,
          maxV: cells.length ? Math.max(...cells) : 0,
          temp: avgTemp,
          status: statusLabel,
        },
        ...prev,
      ].slice(0, LOG_LEN)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, connected]);

  const cells = useMemo(
    () => (pick(status, "cellVoltages", "cell_voltages") ?? []).filter((v) => v > 0),
    [status.cellVoltages, status.cell_voltages]
  );
  const wireResistances = useMemo(() => {
    const rawVoltages = pick(status, "cellVoltages", "cell_voltages") ?? [];
    const rawResistances = pick(status, "wireResistances", "wire_resistances") ?? [];
    return rawResistances.filter((_, i) => rawVoltages[i] > 0);
  }, [status.cellVoltages, status.cell_voltages, status.wireResistances, status.wire_resistances]);
  const maxV = useMemo(() => (cells.length ? Math.max(...cells) : 0), [cells]);
  const minV = useMemo(() => (cells.length ? Math.min(...cells) : 0), [cells]);
  const maxIdx = useMemo(() => cells.indexOf(maxV), [cells, maxV]);
  const minIdx = useMemo(() => cells.indexOf(minV), [cells, minV]);
  const voltDiffMv = useMemo(
    () => Math.round((status.delta_cell_voltage ?? maxV - minV) * 1000),
    [status.delta_cell_voltage, maxV, minV]
  );

  const packVoltage = pick(status, "totalVoltage", "battery_voltage") ?? cells.reduce((a, b) => a + b, 0);
  const batteryVoltageRaw = status.battery_voltage;
  const chargeMOS = !!pick(status, "charging_state", "charge");
  const dischargeMOS = !!status.discharge;
  const power = pick(status, "power", "battery_power") ?? 0;
  const current = pick(status, "current", "charge_current") ?? 0;
  const statusLabel = chargeMOS ? "Charging" : dischargeMOS ? "Discharging" : "Standby";

  const ratedCapacityAh = status.nominal_capacity || fallbackCapacityAh;
  const remainingAh = status.capacity_remain ?? 0;
  const cycleAh = status.cycle_capacity ?? 0;
  const cycleCount = status.cycle_count ?? 0;
  const soh = pick(status, "state_of_health", "primaryHealth") ?? 100;
  const dailyChargeAh = status.dailyChargeAh ?? 0;
  const dailyChargeKwh = status.dailyChargeKwh ?? 0;
  const dailyDischargeAh = status.dailyDischargeAh ?? 0;
  const dailyDischargeKwh = status.dailyDischargeKwh ?? 0;

  const tempChannels = useMemo(
    () => [
      { key: "t1", label: "T1" },
      { key: "t2", label: "T2" },
      { key: "cmosTemp", label: "CMOS" },
    ],
    []
  );
  const temps = useMemo(
    () => ({
      t1: status.battery_t1 ?? 0,
      t2: status.battery_t2 ?? 0,
      cmosTemp: status.mos_temp ?? 0,
    }),
    [status.battery_t1, status.battery_t2, status.mos_temp]
  );
  const tempValues = useMemo(() => Object.values(temps), [temps]);
  const avgTemp = useMemo(
    () => (tempValues.length ? tempValues.reduce((a, b) => a + b, 0) / tempValues.length : 0),
    [tempValues]
  );
  const maxTemp = useMemo(() => (tempValues.length ? Math.max(...tempValues) : 0), [tempValues]);

  const balancerOn = !!status.balance;
  const balancerCurrent = pick(status, "balancing_current", "balance_curr") ?? 0;

  const vd = voltDiffTone(voltDiffMv);
  const tt = tempTone(maxTemp);

  return {
    id,
    name,
    isLive: true,
    connected,
    firebaseConnected: socketConnected,
    adminDisabled,
    lastUpdateAt,
    error: null,
    info,
    remoteSettings,
    ratedCapacityAh,
    soc: pick(status, "soc", "percent_remain") ?? 0,
    soh,
    dailyChargeAh,
    dailyChargeKwh,
    dailyDischargeAh,
    dailyDischargeKwh,
    cells,
    wireResistances,
    power,
    current,
    temps,
    tempChannels,
    chargeMOS,
    dischargeMOS,
    balancerOn,
    balancerCurrent,
    log,
    cycleAh,
    cycleCount,
    powerHistory,
    packVoltage,
    batteryVoltageRaw,
    maxV,
    minV,
    maxIdx,
    minIdx,
    voltDiffMv,
    remainingAh,
    avgTemp,
    maxTemp,
    status: statusLabel,
    vd,
    tt,
  };
}
