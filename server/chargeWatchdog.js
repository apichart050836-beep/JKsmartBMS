import { db } from "./db.js";
import { readPath, writePath } from "./firebaseRead.js";

// Every 1 minute, per explicit request.
const CHECK_INTERVAL_MS = 60_000;

// A device's real BLE-read shape (see bmsShape.js's frontend twin) - status
// and settings are both real objects. Kept minimal/local here rather than
// importing the frontend's copy - src/ and server/ are separate deploy
// contexts in this project, nothing else crosses that line either.
function isBmsDevice(value) {
  return !!value && typeof value === "object" && value.status && typeof value.status === "object" && value.settings && typeof value.settings === "object";
}

// Live uptime_seconds should only ever climb while a device keeps reporting
// - a value that hasn't moved since the last check means the last Firebase
// write we're looking at is stale (device offline, or BLE/WiFi stalled),
// not a fresh read to act on. Keyed in-memory per process; resets on
// restart, which just means the very first check after a deploy always
// treats every device as "first seen" rather than stale - acceptable,
// matches the same conservative default the intent-seeding step below uses.
const lastUptimeByDevice = new Map();

// The only real, already-configured protection thresholds relevant to
// *charging* specifically - reusing the exact field names/logic already
// confirmed in src/lib/alarms.js's computeAlarms, just against the raw
// Firebase field names instead of the dashboard's translated ones (no
// REMOTE_SETTINGS_MAP available here). Any one of these being breached
// means the BMS turning charging off is a legitimate protection response,
// not an unexplained reset - never auto-corrected.
function chargeSafetyReason(status, settings) {
  const t1 = status.battery_t1;
  const t2 = status.battery_t2;
  const maxTemp = Math.max(typeof t1 === "number" ? t1 : -Infinity, typeof t2 === "number" ? t2 : -Infinity);
  if (typeof settings.charge_otp === "number" && maxTemp > settings.charge_otp) {
    return `Charge Over-Temperature (${maxTemp.toFixed(1)}°C > ${settings.charge_otp}°C)`;
  }

  const mosTemp = status.mos_temp;
  if (typeof settings.cmos_otp === "number" && typeof mosTemp === "number" && mosTemp > settings.cmos_otp) {
    return `MOSFET Over-Temperature (${mosTemp.toFixed(1)}°C > ${settings.cmos_otp}°C)`;
  }

  const cellVoltages = Array.isArray(status.cell_voltages) ? status.cell_voltages.filter((v) => v > 0) : [];
  if (cellVoltages.length && typeof settings.cell_ovp === "number") {
    const maxCell = Math.max(...cellVoltages);
    if (maxCell > settings.cell_ovp) {
      return `Cell Over-Voltage (${maxCell.toFixed(3)}V > ${settings.cell_ovp}V)`;
    }
  }

  return null;
}

async function checkDevice(hubId, bmsKey, data) {
  const label = bmsKey ? `${hubId}/${bmsKey}` : hubId;
  const { status, settings } = data;

  // Admin's kill switch (see routes/admin.js) is someone else's explicit
  // decision too - same reasoning as respecting the user's own OFF below,
  // the watchdog doesn't fight it.
  if (data.admin?.enabled === false) return;

  const uptime = status.uptime_seconds;
  const deviceKey = label;
  const prevUptime = lastUptimeByDevice.get(deviceKey);
  if (typeof uptime === "number") lastUptimeByDevice.set(deviceKey, uptime);
  if (typeof uptime === "number" && typeof prevUptime === "number" && uptime <= prevUptime) {
    console.log(`[ChargeWatchdog] ${label}: offline/stale (uptime_seconds unchanged at ${uptime}s) - skipping this cycle`);
    return;
  }

  if (settings.charge !== false) return; // spec: already on -> nothing to do

  const row = db
    .prepare(`SELECT desired_charge FROM charge_switch_intent WHERE hub_id = ? AND bms_key = ?`)
    .get(hubId, bmsKey ?? "");
  if (!row) {
    // No recorded user command for this device at all yet - critically,
    // this must NOT seed from the device's current state. If it seeded
    // "off" (because it happens to be off right now, e.g. exactly the
    // unexplained-reset case this feature exists to fix), that bug would
    // get permanently entrenched as "the user's own choice" the very first
    // time the watchdog ever looked at it. Safer to do nothing in either
    // direction until routes/hubs.js records a real command from the user
    // toggling the switch themselves - from that point on this device is
    // fully covered.
    return;
  }
  if (row.desired_charge === 0) {
    return; // user's own last command was OFF - respected, never touched
  }

  const safetyReason = chargeSafetyReason(status, settings);
  if (safetyReason) {
    console.log(`[ChargeWatchdog] ${label}: charge is off, explained by ${safetyReason} - not overriding`);
    return;
  }

  console.log(`[ChargeWatchdog] ${label}: charge is off with no user command or protection condition behind it - re-enabling`);
  const path = bmsKey ? `JK_BMS_HUB/${hubId}/${bmsKey}/settings/charge` : `JK_BMS_HUB/${hubId}/settings/charge`;
  await writePath(path, true);
}

async function runCycle() {
  const hubs = await readPath("JK_BMS_HUB");
  if (!hubs) return;

  for (const [hubId, hubData] of Object.entries(hubs)) {
    if (!hubData || typeof hubData !== "object") continue;
    const bmsEntries = Object.entries(hubData).filter(([, v]) => isBmsDevice(v));
    if (bmsEntries.length > 0) {
      for (const [bmsKey, data] of bmsEntries) {
        await checkDevice(hubId, bmsKey, data).catch((err) => console.error(`[ChargeWatchdog] ${hubId}/${bmsKey} failed: ${err.message}`));
      }
    } else if (isBmsDevice(hubData)) {
      await checkDevice(hubId, null, hubData).catch((err) => console.error(`[ChargeWatchdog] ${hubId} failed: ${err.message}`));
    }
  }
}

export function startChargeWatchdog() {
  setInterval(() => {
    runCycle().catch((err) => console.error(`[ChargeWatchdog] cycle failed: ${err.message}`));
  }, CHECK_INTERVAL_MS);
  console.log(`[ChargeWatchdog] started - checking every ${CHECK_INTERVAL_MS / 1000}s`);
}
