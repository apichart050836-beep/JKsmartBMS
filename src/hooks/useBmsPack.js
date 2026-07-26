import { useState, useEffect, useMemo } from "react";
import { clamp, jitter, voltDiffTone, tempTone } from "../lib/tone.js";

const CELL_COUNT = 16;
const POWER_HISTORY_LEN = 30; // 30 ticks @ 2s = 60s trend window

// 6-channel temperature sensor set: pack (battery) temp + 4 board/wire probes
// + the BMS's own CMOS chip temp. Named t1/t2/t4/t5 (no t3) to match the
// reference JK BMS sensor layout.
export const TEMP_CHANNELS = [
  { key: "batTemp", label: "Bat.Temp" },
  { key: "t1", label: "T1" },
  { key: "t2", label: "T2" },
  { key: "t4", label: "T4" },
  { key: "t5", label: "T5" },
  { key: "cmosTemp", label: "CMOS" },
];

function makeInitialCells(nominalCellV) {
  return Array.from({ length: CELL_COUNT }, () =>
    Number(clamp(jitter(nominalCellV, 0.035), nominalCellV - 0.23, nominalCellV + 0.17).toFixed(3))
  );
}

/**
 * One independent, self-ticking 16S LiFePO4 pack simulation. Called once per
 * physical BMS (see BMS_FLEET in BMSDashboard.jsx) so all packs stay "live"
 * even while a different tab is being viewed - matches the hot-swap tabs
 * requirement (switching tabs shows already-live data, no reload/refetch).
 *
 * `liveSettings` ({ balancerEnabled, balDeltaVolt, maxBalCurrent }) comes from
 * the Configuration modal's per-pack settings and can change every render -
 * it drives the simulated Bal. Current so that toggling the Balancer or
 * editing its parameters is reflected in the *next* tick, not just a static
 * readout of the configured max.
 */
export function useBmsPack(config, liveSettings) {
  const { id, name, nominalCellV, ratedCapacityAh, initialPower, initialSoc, initialSoh, initialCycleAh } = config;

  const [soc, setSoc] = useState(initialSoc);
  const [soh, setSoh] = useState(initialSoh);
  const [cells, setCells] = useState(() => makeInitialCells(nominalCellV));
  const [power, setPower] = useState(initialPower);
  const [temps, setTemps] = useState({ batTemp: 31.2, t1: 32.0, t2: 30.6, t4: 31.8, t5: 29.9, cmosTemp: 34.5 });
  const [log, setLog] = useState([]);
  const [cycleAh, setCycleAh] = useState(initialCycleAh);
  const [balancerCurrent, setBalancerCurrent] = useState(0);
  const [powerHistory, setPowerHistory] = useState(() => [
    { time: new Date().toLocaleTimeString(), current: initialPower / (nominalCellV * CELL_COUNT) },
  ]);

  useEffect(() => {
    const id = setTimeout(() => {
      const drift = power > 0 ? 0.0009 : power < 0 ? -0.0012 : 0;
      const newCells = cells.map((v) => Number(clamp(jitter(v + drift, 0.004), 3.0, 3.5).toFixed(3)));
      const newTemps = Object.fromEntries(
        Object.entries(temps).map(([k, t]) => [k, Number(clamp(jitter(t, 0.3), 22, 58).toFixed(1))])
      );
      const newPower = clamp(jitter(power, 90), -3500, 3500);
      const newSoc = clamp(soc + (power > 0 ? 0.03 : power < 0 ? -0.025 : 0) + jitter(0, 0.01), 1, 100);
      const newSoh = clamp(soh + jitter(0, 0.01), 60, 100);
      const status = power > 30 ? "Charging" : power < -30 ? "Discharging" : "Standby";
      const newPackVoltage = newCells.reduce((a, b) => a + b, 0);
      const newCurrent = newPackVoltage > 0 ? newPower / newPackVoltage : 0;

      const newMaxV = Math.max(...newCells);
      const newMinV = Math.min(...newCells);
      const newVoltDiffMv = Math.round((newMaxV - newMinV) * 1000);
      const shouldBalance = liveSettings.balancerEnabled && newVoltDiffMv > liveSettings.balDeltaVolt;
      const newBalancerCurrent = shouldBalance
        ? clamp(jitter(liveSettings.maxBalCurrent, liveSettings.maxBalCurrent * 0.12), 0.05, liveSettings.maxBalCurrent)
        : clamp(balancerCurrent * 0.5 + jitter(0, 0.01), 0, liveSettings.maxBalCurrent);

      setCells(newCells);
      setTemps(newTemps);
      setPower(newPower);
      setSoc(newSoc);
      setSoh(newSoh);
      setBalancerCurrent(Number(Math.max(0, newBalancerCurrent).toFixed(2)));
      setCycleAh((c) => c + Math.abs(newCurrent) * (2 / 3600));
      setPowerHistory((prev) =>
        [...prev, { time: new Date().toLocaleTimeString(), current: newCurrent }].slice(-POWER_HISTORY_LEN)
      );
      setLog((prev) =>
        [
          {
            id: Date.now(),
            time: new Date().toLocaleTimeString(),
            minV: Math.min(...newCells),
            maxV: Math.max(...newCells),
            temp: Object.values(newTemps).reduce((a, b) => a + b, 0) / Object.values(newTemps).length,
            status,
          },
          ...prev,
        ].slice(0, 8)
      );
    }, 2000);
    return () => clearTimeout(id);
  }, [power, cells, temps, soc, soh, balancerCurrent, liveSettings.balancerEnabled, liveSettings.balDeltaVolt, liveSettings.maxBalCurrent]);

  const packVoltage = useMemo(() => cells.reduce((a, b) => a + b, 0), [cells]);
  const maxV = useMemo(() => Math.max(...cells), [cells]);
  const minV = useMemo(() => Math.min(...cells), [cells]);
  const maxIdx = useMemo(() => cells.indexOf(maxV), [cells, maxV]);
  const minIdx = useMemo(() => cells.indexOf(minV), [cells, minV]);
  const voltDiffMv = useMemo(() => Math.round((maxV - minV) * 1000), [maxV, minV]);
  const current = useMemo(() => (packVoltage > 0 ? power / packVoltage : 0), [power, packVoltage]);
  const remainingAh = useMemo(() => (ratedCapacityAh * soc) / 100, [soc, ratedCapacityAh]);
  const tempValues = useMemo(() => Object.values(temps), [temps]);
  const avgTemp = useMemo(() => tempValues.reduce((a, b) => a + b, 0) / tempValues.length, [tempValues]);
  const maxTemp = useMemo(() => Math.max(...tempValues), [tempValues]);
  const cycleCount = useMemo(() => cycleAh / ratedCapacityAh, [cycleAh, ratedCapacityAh]);

  const status = power > 30 ? "Charging" : power < -30 ? "Discharging" : "Standby";
  const vd = voltDiffTone(voltDiffMv);
  const tt = tempTone(maxTemp);

  return {
    id,
    name,
    isLive: false,
    ratedCapacityAh,
    soc,
    soh,
    cells,
    power,
    temps,
    tempChannels: TEMP_CHANNELS,
    log,
    cycleAh,
    cycleCount,
    balancerCurrent,
    powerHistory,
    packVoltage,
    maxV,
    minV,
    maxIdx,
    minIdx,
    voltDiffMv,
    current,
    remainingAh,
    avgTemp,
    maxTemp,
    status,
    vd,
    tt,
  };
}
