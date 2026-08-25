import { db } from "./db.js";
import { readPath } from "./firebaseRead.js";
import { pushLineMessage, isLineMessagingConfigured } from "./lineNotify.js";

// Every 15s - prompt enough to catch a real battery event quickly without
// hammering Firebase/LINE for something that isn't sub-second-sensitive
// the way live dashboard telemetry is (see realtime.js's 1s poll).
const CHECK_INTERVAL_MS = 15_000;

// "Near" a recommended charge/discharge current limit means within 10% of
// it (>=90% of the limit but not over it yet) - a judgment call, not a
// value the user specified; documented here so it's easy to retune later.
const NEAR_LIMIT_FRACTION = 0.9;

// Same real BLE-read shape check chargeWatchdog.js uses.
function isBmsDevice(value) {
  return !!value && typeof value === "object" && value.status && typeof value.status === "object" && value.settings && typeof value.settings === "object";
}

function deviceLabel(hubId, bmsKey, settings) {
  return settings?.my_custom_name || (bmsKey ? `${hubId}/${bmsKey}` : hubId);
}

// Each condition: `id` (for line_alert_state's PK + dedup), `check(status,
// settings)` returning true/false for "currently breached", and
// `message(status, settings, label)` building the Thai push text only
// called the moment it transitions from not-breached to breached (see
// runCycle below) - never re-evaluated while already active, so its
// wording doesn't need to handle a "still happening" phrasing.
const CONDITIONS = [
  {
    id: "cell_imbalance_50mv",
    check(status) {
      const cells = (Array.isArray(status.cell_voltages) ? status.cell_voltages : []).filter((v) => v > 0);
      const deltaV = typeof status.delta_cell_voltage === "number" ? status.delta_cell_voltage : cells.length ? Math.max(...cells) - Math.min(...cells) : 0;
      return deltaV * 1000 > 50;
    },
    message(status, settings, label) {
      const cells = (Array.isArray(status.cell_voltages) ? status.cell_voltages : []).filter((v) => v > 0);
      const deltaV = typeof status.delta_cell_voltage === "number" ? status.delta_cell_voltage : cells.length ? Math.max(...cells) - Math.min(...cells) : 0;
      return `⚠️ ${label}\nเซลล์มีแรงดันต่างกันเกิน 50mV (ปัจจุบัน ${(deltaV * 1000).toFixed(0)}mV)`;
    },
  },
  {
    id: "soc_near_full_90",
    check(status) {
      const soc = status.percent_remain ?? 0;
      return soc >= 90 && soc < 100;
    },
    message(status, settings, label) {
      return `🔋 ${label}\nแบตใกล้เต็มแล้ว (${(status.percent_remain ?? 0).toFixed(0)}%)`;
    },
  },
  {
    id: "soc_full_100",
    check(status) {
      return (status.percent_remain ?? 0) >= 100;
    },
    message(status, settings, label) {
      return `🔋 ${label}\nแบตชาร์จเต็ม 100% แล้ว`;
    },
  },
  {
    id: "soc_near_empty_25",
    check(status) {
      const soc = status.percent_remain ?? 100;
      return soc <= 25 && soc > 10;
    },
    message(status, settings, label) {
      return `🪫 ${label}\nแบตใกล้หมดแล้ว (${(status.percent_remain ?? 0).toFixed(0)}%)`;
    },
  },
  {
    id: "soc_low_10",
    check(status) {
      return (status.percent_remain ?? 100) <= 10;
    },
    message(status, settings, label) {
      return `🪫 ${label}\nแบตเหลือน้อยมาก (${(status.percent_remain ?? 0).toFixed(0)}%) กรุณาชาร์จโดยเร็ว`;
    },
  },
  {
    id: "charge_over_recommended",
    check(status, settings) {
      const current = status.charge_current ?? 0;
      const recommended = (settings.capacity ?? 0) * 0.25;
      return current > 0 && recommended > 0 && current > recommended;
    },
    message(status, settings, label) {
      const recommended = (settings.capacity ?? 0) * 0.25;
      return `⚡ ${label}\nกระแสชาร์จเกินค่าที่แนะนำ (${status.charge_current.toFixed(1)}A > ${recommended.toFixed(1)}A)`;
    },
  },
  {
    id: "charge_near_recommended",
    check(status, settings) {
      const current = status.charge_current ?? 0;
      const recommended = (settings.capacity ?? 0) * 0.25;
      return current > 0 && recommended > 0 && current >= recommended * NEAR_LIMIT_FRACTION && current <= recommended;
    },
    message(status, settings, label) {
      const recommended = (settings.capacity ?? 0) * 0.25;
      return `⚡ ${label}\nกระแสชาร์จใกล้ถึงค่าที่แนะนำแล้ว (${status.charge_current.toFixed(1)}A ใกล้ ${recommended.toFixed(1)}A)`;
    },
  },
  {
    id: "discharge_over_recommended",
    check(status, settings) {
      const current = status.charge_current ?? 0;
      const recommended = (settings.capacity ?? 0) * 0.5;
      return current < 0 && recommended > 0 && -current > recommended;
    },
    message(status, settings, label) {
      const recommended = (settings.capacity ?? 0) * 0.5;
      return `⚡ ${label}\nใช้ไฟเกินค่าที่แนะนำ (${(-status.charge_current).toFixed(1)}A > ${recommended.toFixed(1)}A)`;
    },
  },
  {
    id: "discharge_near_recommended",
    check(status, settings) {
      const current = status.charge_current ?? 0;
      const recommended = (settings.capacity ?? 0) * 0.5;
      return current < 0 && recommended > 0 && -current >= recommended * NEAR_LIMIT_FRACTION && -current <= recommended;
    },
    message(status, settings, label) {
      const recommended = (settings.capacity ?? 0) * 0.5;
      return `⚡ ${label}\nใช้ไฟใกล้ถึงค่าที่แนะนำแล้ว (${(-status.charge_current).toFixed(1)}A ใกล้ ${recommended.toFixed(1)}A)`;
    },
  },
];

// Prepared inline (not at module load time, like chargeWatchdog.js's own
// queries) - this module is imported before db.js's migrate() has
// necessarily run, and line_alert_state wouldn't exist yet.
function getAlertState(hubId, bmsKey, conditionId) {
  return db.prepare(`SELECT active FROM line_alert_state WHERE hub_id = ? AND bms_key = ? AND condition_id = ?`).get(hubId, bmsKey, conditionId);
}
function setAlertState(hubId, bmsKey, conditionId, active) {
  db.prepare(
    `INSERT INTO line_alert_state (hub_id, bms_key, condition_id, active, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (hub_id, bms_key, condition_id) DO UPDATE SET active = excluded.active, updated_at = excluded.updated_at`
  ).run(hubId, bmsKey, conditionId, active, Date.now());
}

async function checkDevice(hubId, bmsKey, data, lineUserId) {
  const { status, settings } = data;
  const bmsKeyNorm = bmsKey ?? "";
  const label = deviceLabel(hubId, bmsKey, settings);

  for (const condition of CONDITIONS) {
    let isBreached;
    try {
      isBreached = condition.check(status, settings);
    } catch {
      continue; // a device missing some field just never triggers that one condition
    }
    const row = getAlertState(hubId, bmsKeyNorm, condition.id);
    const wasActive = row ? !!row.active : false;

    if (isBreached && !wasActive) {
      // Edge trigger: was fine, just crossed into breach - notify once.
      try {
        await pushLineMessage(lineUserId, condition.message(status, settings, label));
      } catch (err) {
        console.error(`[LineAlertWatchdog] push failed for ${label}/${condition.id}: ${err.message}`);
      }
      setAlertState(hubId, bmsKeyNorm, condition.id, 1);
    } else if (!isBreached && wasActive) {
      // Recovered - reset so the next real breach can notify again.
      setAlertState(hubId, bmsKeyNorm, condition.id, 0);
    }
  }
}

async function runCycle() {
  if (!isLineMessagingConfigured) return;

  const links = db.prepare(`SELECT hub_id, line_user_id FROM line_links`).all();
  if (links.length === 0) return;

  for (const { hub_id: hubId, line_user_id: lineUserId } of links) {
    let hubData;
    try {
      hubData = await readPath(`JK_BMS_HUB/${hubId}`);
    } catch (err) {
      console.error(`[LineAlertWatchdog] read failed for ${hubId}: ${err.message}`);
      continue;
    }
    if (!hubData || typeof hubData !== "object") continue;

    const bmsEntries = Object.entries(hubData).filter(([, v]) => isBmsDevice(v));
    if (bmsEntries.length > 0) {
      for (const [bmsKey, data] of bmsEntries) {
        await checkDevice(hubId, bmsKey, data, lineUserId).catch((err) =>
          console.error(`[LineAlertWatchdog] ${hubId}/${bmsKey} failed: ${err.message}`)
        );
      }
    } else if (isBmsDevice(hubData)) {
      await checkDevice(hubId, null, hubData, lineUserId).catch((err) => console.error(`[LineAlertWatchdog] ${hubId} failed: ${err.message}`));
    }
  }
}

export function startLineAlertWatchdog() {
  setInterval(() => {
    runCycle().catch((err) => console.error(`[LineAlertWatchdog] cycle failed: ${err.message}`));
  }, CHECK_INTERVAL_MS);
  console.log(`[LineAlertWatchdog] started - checking every ${CHECK_INTERVAL_MS / 1000}s`);
}
