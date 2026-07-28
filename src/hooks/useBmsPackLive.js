import { useEffect, useState, useMemo, useRef } from "react";
import { voltDiffTone, tempTone } from "../lib/tone.js";
import { pick } from "../lib/pick.js";
import { computeRemainingRuntime, computeTimeToFullCharge } from "../lib/remainingRuntime.js";
import { computeSoh } from "../lib/soh.js";
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

  // lastUpdateAt (used for the Online/Offline check) only advances on a
  // genuine change to the status JSON - confirmed live (2026-07-27, BLE
  // physically unplugged) that jkbms-bridge.yaml stops writing to Firebase
  // entirely when the BLE link drops, rather than re-pushing the last known
  // values on a heartbeat - so the value really does freeze byte-for-byte
  // the moment the link dies, and our own 5s backend poll would otherwise
  // keep re-delivering that frozen snapshot and masking the disconnect
  // forever. Log/power-history entries share this same dedup (a duplicate
  // row for an unchanged reading isn't useful either).
  useEffect(() => {
    if (!connected) return;
    const statusJson = JSON.stringify(status);
    if (lastStatusJsonRef.current === statusJson) return;
    lastStatusJsonRef.current = statusJson;

    setLastUpdateAt(Date.now());

    const cells = (pick(status, "cellVoltages", "cell_voltages") ?? []).filter((v) => v > 0);
    const current = pick(status, "current", "charge_current") ?? 0;
    // charging_state/discharge are MOSFET enable switches, not live
    // direction - both can read true simultaneously while genuinely
    // charging (confirmed earlier this session), so the real signed
    // current is the only trustworthy source for which way power is
    // actually flowing right now.
    const statusLabel = current > 0 ? "Charging" : current < 0 ? "Discharging" : "Standby";
    const tempVals = [status.battery_t1, status.battery_t2, status.mos_temp].filter((v) => typeof v === "number");
    const avgTemp = tempVals.length ? tempVals.reduce((a, b) => a + b, 0) / tempVals.length : 0;
    const now = new Date();

    setPowerHistory((prev) =>
      [...prev, { time: now.toLocaleTimeString(), hour: now.getHours() + now.getMinutes() / 60, current }].slice(
        -POWER_HISTORY_LEN
      )
    );
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
  const power = pick(status, "power", "battery_power") ?? 0;
  const current = pick(status, "current", "charge_current") ?? 0;
  // Same real-current-sign basis as the log entries above - not the
  // charging_state/discharge MOSFET enable switches.
  const statusLabel = current > 0 ? "Charging" : current < 0 ? "Discharging" : "Standby";
  // Dashboard's Charge ON/OFF badge - per explicit instruction, back to
  // reading charging_state directly (was briefly switched to a current-sign
  // basis after a live mismatch was found, but the current-sign approach
  // introduced its own confusing case during genuine discharge - reverted
  // by request). chargeStatus (Bulk/Absorption/Float) still rides along as
  // supplementary info alongside ON/OFF.
  const chargeMOS = !!pick(status, "charging_state", "charge");
  const dischargeMOS = !!status.discharge;
  const chargeStatus = status.charge_status ?? null;

  const ratedCapacityAh = status.nominal_capacity || fallbackCapacityAh;
  const remainingAh = status.capacity_remain ?? 0;
  const soc = pick(status, "soc", "percent_remain") ?? 0;
  const cycleAh = status.cycle_capacity ?? 0;
  const cycleCount = status.cycle_count ?? 0;
  // Self-calculated (see soh.js) - replaces the BMS's own reported
  // state_of_health per explicit request, rather than just displaying it.
  const sohResult = useMemo(
    () =>
      computeSoh({
        capacityRemainAh: status.capacity_remain,
        socPercent: pick(status, "soc", "percent_remain"),
        designCapacityAh: ratedCapacityAh,
        cycleCount: status.cycle_count,
      }),
    [status, ratedCapacityAh]
  );
  const soh = sohResult.soh ?? 100;
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

  // Raw (non-defaulted) reads for computeRemainingRuntime - it needs to
  // distinguish "field genuinely missing" (fall back to the SOC-derived Ah
  // or the Ah/A formula) from "field present and 0", which the `?? 0`
  // fallbacks already applied to remainingAh/power above would erase.
  const remainingRuntime = useMemo(
    () =>
      computeRemainingRuntime({
        current,
        power: pick(status, "power", "battery_power"),
        remainingCapacityAh: status.capacity_remain,
        ratedCapacityAh,
        soc,
        voltage: packVoltage,
      }),
    [current, status, ratedCapacityAh, soc, packVoltage]
  );
  const timeToFullCharge = useMemo(
    () =>
      computeTimeToFullCharge({
        current,
        power: pick(status, "power", "battery_power"),
        remainingCapacityAh: status.capacity_remain,
        ratedCapacityAh,
        soc,
        voltage: packVoltage,
      }),
    [current, status, ratedCapacityAh, soc, packVoltage]
  );

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
    soc,
    soh,
    sohBreakdown: sohResult,
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
    chargeStatus,
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
    remainingRuntime,
    timeToFullCharge,
    avgTemp,
    maxTemp,
    status: statusLabel,
    vd,
    tt,
  };
}
