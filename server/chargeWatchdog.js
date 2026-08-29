import { db } from "./db.js";
import { writePath } from "./firebaseRead.js";
import { getCachedHubTree } from "./hubTreeCache.js";

// Every 5 seconds, per explicit request (was 1 minute).
const CHECK_INTERVAL_MS = 5_000;

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
// means the BMS turning a switch off is a legitimate protection response,
// not an unexplained reset - never auto-corrected. Reused for the Balancer
// Switch too (2026-08-01) - there's no separate balancer-specific
// protection register anywhere in the Firebase settings shape, but a pack
// that's genuinely over-temp/over-voltage shouldn't get balancing forced
// back on either (it still draws bleed current and generates heat).
function packSafetyReason(status, settings) {
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

// Charge and Balancer switches both follow the exact same rule: already on
// -> do nothing; off because the user themselves last set it off (per the
// matching *_switch_intent table) -> respected, never touched; off with a
// real protection condition behind it -> respected, never touched; off with
// no explanation at all -> re-enable. `settingsKey` is the Firebase
// settings/<key> field, `intentTable`/`intentColumn` are the matching SQLite
// table from schema.sql, `label` is only for the console log.
async function checkSwitch(hubId, bmsKey, data, { settingsKey, intentTable, intentColumn, label }) {
  const { status, settings } = data;
  const deviceLabel = bmsKey ? `${hubId}/${bmsKey}` : hubId;

  if (settings[settingsKey] !== false) return; // spec: already on -> nothing to do

  const row = db
    .prepare(`SELECT ${intentColumn} AS desired FROM ${intentTable} WHERE hub_id = ? AND bms_key = ?`)
    .get(hubId, bmsKey ?? "");
  if (!row) {
    // No recorded user command for this device/switch at all yet -
    // critically, this must NOT seed from the device's current state. If it
    // seeded "off" (because it happens to be off right now, e.g. exactly
    // the unexplained-reset case this feature exists to fix), that bug
    // would get permanently entrenched as "the user's own choice" the very
    // first time the watchdog ever looked at it. Safer to do nothing in
    // either direction until routes/hubs.js records a real command from the
    // user toggling the switch themselves - from that point on this
    // device/switch is fully covered.
    return;
  }
  if (row.desired === 0) {
    return; // user's own last command was OFF - respected, never touched
  }

  const safetyReason = packSafetyReason(status, settings);
  if (safetyReason) {
    console.log(`[ChargeWatchdog] ${deviceLabel}: ${label} is off, explained by ${safetyReason} - not overriding`);
    return;
  }

  console.log(`[ChargeWatchdog] ${deviceLabel}: ${label} is off with no user command or protection condition behind it - re-enabling`);
  const path = bmsKey
    ? `JK_BMS_HUB/${hubId}/${bmsKey}/settings/${settingsKey}`
    : `JK_BMS_HUB/${hubId}/settings/${settingsKey}`;
  await writePath(path, true);
}

// A device's own reported BLE MAC (bare hex-colon form, e.g.
// "A4:C1:38:08:24:C5") - the exact shape the ESP32 firmware bug (2026-08-01)
// falls back to writing into settings/my_custom_name when it doesn't yet
// know the real name (see the fix already made in the ESPHome yaml, not
// deployed to every board yet). Checked generically too (any MAC-shaped
// string), in case info.jk_mac_address itself isn't reported by a given
// board (confirmed earlier this session - not every device reports it).
const MAC_SHAPE = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;

// Temporary web-side workaround (2026-08-01) for the my_custom_name-reverts-
// to-MAC-address firmware bug, for boards not yet re-flashed with the real
// fix. Unlike checkSwitch above, there's no "user's last command" here - a
// name isn't on/off, so instead this just remembers the last name that
// *wasn't* MAC-shaped (custom_name_intent) and writes it back the moment the
// name reverts to one that is. Self-updating: every real name seen refreshes
// the cache, so it always restores the most recent genuine name, not a
// stale one. Safe to delete entirely once every board has the real fix.
async function checkCustomName(hubId, bmsKey, data) {
  const { settings, info } = data;
  const deviceLabel = bmsKey ? `${hubId}/${bmsKey}` : hubId;
  const currentName = settings?.my_custom_name;
  if (typeof currentName !== "string" || currentName === "") return;

  const knownMac = info?.jk_mac_address;
  const looksLikeMac = (typeof knownMac === "string" && currentName === knownMac) || MAC_SHAPE.test(currentName);

  const row = db.prepare(`SELECT name FROM custom_name_intent WHERE hub_id = ? AND bms_key = ?`).get(hubId, bmsKey ?? "");

  if (!looksLikeMac) {
    // A genuine name - cache it as "last known good" if it's new/changed.
    if (!row || row.name !== currentName) {
      db.prepare(
        `INSERT INTO custom_name_intent (hub_id, bms_key, name, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (hub_id, bms_key) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`
      ).run(hubId, bmsKey ?? "", currentName, Date.now());
    }
    return;
  }

  if (!row || !row.name || row.name === currentName) return; // nothing real to restore

  console.log(`[ChargeWatchdog] ${deviceLabel}: my_custom_name reverted to MAC (${currentName}) - restoring "${row.name}"`);
  const path = bmsKey
    ? `JK_BMS_HUB/${hubId}/${bmsKey}/settings/my_custom_name`
    : `JK_BMS_HUB/${hubId}/settings/my_custom_name`;
  await writePath(path, row.name);
}

async function checkDevice(hubId, bmsKey, data) {
  const label = bmsKey ? `${hubId}/${bmsKey}` : hubId;
  const { status } = data;

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

  await checkSwitch(hubId, bmsKey, data, {
    settingsKey: "charge",
    intentTable: "charge_switch_intent",
    intentColumn: "desired_charge",
    label: "Charge",
  });
  await checkSwitch(hubId, bmsKey, data, {
    settingsKey: "balancer",
    intentTable: "balancer_switch_intent",
    intentColumn: "desired_balancer",
    label: "Balancer",
  });
  await checkCustomName(hubId, bmsKey, data);
}

async function runCycle() {
  const hubs = getCachedHubTree();
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
