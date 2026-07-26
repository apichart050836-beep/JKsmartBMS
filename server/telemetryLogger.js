import { readPath, canReadFirebase } from "./firebaseRead.js";
import { db } from "./db.js";
import { flattenHubs } from "../src/lib/flattenHubs.js";

// Firebase only ever holds the current-moment status node, never history -
// this is the one place that turns "now" into "over time" by writing a row
// per real BMS device into telemetry_log on a fixed interval. Runs
// independently of any connected client/socket (fleet-wide, not per
// session), so history keeps accumulating even with the dashboard closed.
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes, steady-state
// The Daily chart needs 4+ real snapshots before it drops the mock-data
// fallback (see ChargeDischargeChart.jsx) - at a flat 5-minute cadence
// that's ~20 minutes after every server restart. Snapshotting faster for
// the first few reads gets it there in ~2 minutes instead, without
// changing the steady-state cadence (or telemetry_log's row shape) at all.
const WARMUP_INTERVAL_MS = 30 * 1000; // 30 seconds
const WARMUP_SNAPSHOTS = 5;

// Prepared lazily (not at module load) - this module is imported (and
// startTelemetryLogger scheduled) before migrate() has necessarily run.
function insertSnapshot(hubId, bmsKey, ts, packVoltage, chargeCurrent, capacityRemain, percentRemain) {
  db.prepare(
    `INSERT INTO telemetry_log (hub_id, bms_key, ts, pack_voltage, charge_current, capacity_remain, percent_remain)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(hubId, bmsKey, ts, packVoltage, chargeCurrent, capacityRemain, percentRemain);
}

async function snapshotOnce() {
  if (!canReadFirebase) return;
  let hubs;
  try {
    hubs = await readPath("JK_BMS_HUB");
  } catch (err) {
    console.error("telemetryLogger: failed to read JK_BMS_HUB", err);
    return;
  }
  if (!hubs) return;

  const ts = Date.now();
  for (const { hubId, bmsKey, data } of flattenHubs(hubs)) {
    const status = data?.status;
    // Skip the placeholder/simplified shape (status is just an "online"/
    // "offline" string) - it has no numeric telemetry to log.
    if (!status || typeof status !== "object") continue;
    insertSnapshot(
      hubId,
      bmsKey ?? "",
      ts,
      status.battery_voltage ?? null,
      status.charge_current ?? null,
      status.capacity_remain ?? null,
      status.percent_remain ?? null
    );
  }
}

export function startTelemetryLogger() {
  let warmupCount = 0;

  async function tick() {
    await snapshotOnce();
    warmupCount++;
    const nextDelay = warmupCount < WARMUP_SNAPSHOTS ? WARMUP_INTERVAL_MS : SNAPSHOT_INTERVAL_MS;
    setTimeout(tick, nextDelay);
  }

  setTimeout(tick, 10_000);
}
