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

  // lastUpdateAt (used for the Online/Offline check) advances whenever
  // EITHER info.uptime_seconds has increased OR any field in status has
  // changed, per explicit instruction - checked independently, not one as
  // a fallback for the other, so a device proves itself live via whichever
  // signal actually moves. A live device's own seconds-since-boot counter
  // only ever climbs, so that alone is already a direct, unambiguous "this
  // is a fresh reading" signal; the whole-status diff catches everything
  // else (current, voltages, temps, ...) in case a specific device's
  // uptime_seconds reporting is ever flaky while the rest of its telemetry
  // keeps moving. Confirmed live (2026-07-27, BLE physically unplugged)
  // that jkbms-bridge.yaml stops writing to Firebase entirely when the BLE
  // link drops rather than re-pushing a heartbeat, so both signals really
  // do freeze the moment the link dies, and our own 5s backend poll would
  // otherwise keep re-delivering that frozen snapshot and masking the
  // disconnect forever. Log/power-history entries share this same
  // freshness gate (a duplicate row for an unchanged reading isn't useful
  // either).
  const lastUptimeRef = useRef(null);
  useEffect(() => {
    if (!connected) return;
    const uptime = info.uptime_seconds;
    const prevUptime = lastUptimeRef.current;
    const uptimeIncreased = typeof uptime === "number" && (prevUptime == null || uptime > prevUptime);
    if (typeof uptime === "number") lastUptimeRef.current = uptime;

    const statusJson = JSON.stringify(status);
    const statusChanged = lastStatusJsonRef.current !== statusJson;
    lastStatusJsonRef.current = statusJson;

    const isFresh = uptimeIncreased || statusChanged;
    if (!isFresh) return;

    setLastUpdateAt(Date.now());

    const cells = (pick(status, "cellVoltages", "cell_voltages") ?? []).filter((v) => v > 0);
    const current = pick(status, "current", "charge_current") ?? 0;
    // charging_state/discharge are MOSFET enable switches, not live
    // direction - both can read true simultaneously while genuinely
    // charging (confirmed earlier this session), so the real signed
    // current is the only trustworthy source for which way power is
    // actually flowing right now.
    const statusLabel = current > 0 ? "Charging" : current < 0 ? "Discharging" : "Standby";
    const tempVals = [status.battery_t1, status.battery_t2, status.battery_t4, status.battery_t5, status.mos_temp].filter(
      (v) => typeof v === "number"
    );
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
  }, [status, info, connected]);

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
  // status.discharge never actually exists on any real device (confirmed
  // live against Firebase - status only ever has charging_state, no
  // discharge/discharging_state counterpart), so this always read as OFF
  // regardless of the pack's real state. settings.discharge is the real
  // field that carries this (synced from the BMS by the ESP32, same as the
  // Settings panel's Discharge toggle reads/writes).
  const dischargeMOS = !!(status.discharge ?? remoteSettings?.discharge);
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

  // 5-channel set per explicit spec - t1, t2, t4, t5 (t3 deliberately
  // excluded), plus CMOS/MOSFET temp. PowerFlowChart's "N-Ch" label reads
  // channels.length directly, so this list is the single place that count
  // comes from - adding another real sensor field here is enough to grow
  // the label and tile automatically.
  const tempChannels = useMemo(
    () => [
      { key: "t1", label: "T1" },
      { key: "t2", label: "T2" },
      { key: "t4", label: "T4" },
      { key: "t5", label: "T5" },
      { key: "cmosTemp", label: "CMOS" },
    ],
    []
  );
  const temps = useMemo(
    () => ({
      t1: status.battery_t1 ?? 0,
      t2: status.battery_t2 ?? 0,
      t4: status.battery_t4 ?? 0,
      t5: status.battery_t5 ?? 0,
      cmosTemp: status.mos_temp ?? 0,
    }),
    [status.battery_t1, status.battery_t2, status.battery_t4, status.battery_t5, status.mos_temp]
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
    // Real OTA signal node (admin upload -> writePath, ESP32's own
    // ota_updater component polls this same path) - null until an admin has
    // published at least once for this specific device. Distinct from the
    // SQLite-backed firmwareRelease in HubDataContext, which only powers the
    // acknowledge-only web notification and isn't device-scoped.
    firmware: raw?.firmware ?? null,
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
