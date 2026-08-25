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

// Explicit timeZone is required here - without it, toLocaleTimeString uses
// th-TH only for number/format conventions but the SERVER PROCESS's own
// clock for the actual time, which on Render is UTC (not Bangkok/UTC+7) -
// every notification was showing a time 7 hours behind real Thai time
// until this was pinned down. Bangkok never observes DST, so this is
// always correct with no seasonal adjustment needed (same reasoning
// history.js's bangkokMs already documents).
function nowTimeLabel() {
  return new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Bangkok" });
}

// Same freshness SIGNAL useBmsPackLive.js's frontend Online/Offline badge
// uses (confirmed live, BLE physically unplugged, 2026-07-27) - NOT
// chargeWatchdog.js's own copy, which reads status.uptime_seconds and was
// found to never actually fire here: the real field is info.uptime_seconds
// (a sibling of status, not inside it). "Fresh this poll" means EITHER
// info.uptime_seconds increased OR any field in status changed at all.
//
// But unlike an earlier version of this function, "fresh this poll" is NOT
// by itself "online" - real Firebase writes are confirmed to be up to ~20s
// apart even on a perfectly healthy device (same reasoning BMSDashboard.jsx's
// own STALE_AFTER_MS is tuned around), while this watchdog polls every
// CHECK_INTERVAL_MS=15s. Comparing only against the immediately-previous
// poll made a single quiet 15s window look identical to a real disconnect,
// firing an offline alert immediately followed by a reconnect alert the
// next cycle it changed - exactly the repeated ~15s-apart flapping reported
// 2026-08-25. Fixed by tracking elapsed time since the last real change
// (lastChangedAt) and only calling it stale once that exceeds
// STALE_AFTER_MS, mirroring BMSDashboard.jsx's own now-lastUpdateAt check
// instead of a bare single-cycle diff. In-memory, resets on restart - the
// very first poll after a deploy has no prior value to compare against, so
// it can never itself report "just went offline" (or "just came back").
const STALE_AFTER_MS = 30_000;
const lastSeenByDevice = new Map();
function isDeviceStale(hubId, bmsKey, data) {
  const key = bmsKey ? `${hubId}/${bmsKey}` : hubId;
  const uptime = data.info?.uptime_seconds;
  const statusJson = JSON.stringify(data.status);
  const now = Date.now();
  const prev = lastSeenByDevice.get(key);

  const uptimeIncreased = typeof uptime === "number" && (!prev || prev.uptime == null || uptime > prev.uptime);
  const statusChanged = !prev || prev.statusJson !== statusJson;
  const isFresh = uptimeIncreased || statusChanged;
  const lastChangedAt = isFresh || !prev ? now : prev.lastChangedAt;

  lastSeenByDevice.set(key, { uptime, statusJson, lastChangedAt });

  if (!prev) return false;
  return now - lastChangedAt > STALE_AFTER_MS;
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

const OFFLINE_CONDITION_ID = "device_offline";
const BALANCER_CONDITION_ID = "balancer_active";
// Same raw-field precedence useBmsPackLive.js's frontend "Bal Current"
// reading already uses (pick(status, "balancing_current", "balance_curr")).
const BALANCER_EPSILON_A = 0.01; // ignores float noise sitting right at 0, not a real "is it balancing" threshold

async function checkDevice(hubId, bmsKey, data, lineUserId) {
  const { status, settings } = data;
  const bmsKeyNorm = bmsKey ?? "";
  const label = deviceLabel(hubId, bmsKey, settings);

  // Offline/reconnect, per explicit request (with the time included) -
  // checked and edge-triggered the same way as every other condition
  // below, just driven by the uptime-staleness check instead of a
  // threshold. While a device is offline its last-known status/settings
  // are frozen, not live, so the other conditions are skipped entirely for
  // this cycle rather than potentially re-alerting on stale numbers.
  const stale = isDeviceStale(hubId, bmsKey, data);
  const offlineRow = getAlertState(hubId, bmsKeyNorm, OFFLINE_CONDITION_ID);
  const wasOffline = offlineRow ? !!offlineRow.active : false;
  if (stale && !wasOffline) {
    try {
      await pushLineMessage(lineUserId, `📡 ${label}\nอุปกรณ์ขาดการเชื่อมต่อ (${nowTimeLabel()})`);
    } catch (err) {
      console.error(`[LineAlertWatchdog] push failed for ${label}/${OFFLINE_CONDITION_ID}: ${err.message}`);
    }
    setAlertState(hubId, bmsKeyNorm, OFFLINE_CONDITION_ID, 1);
    return;
  }
  if (!stale && wasOffline) {
    try {
      await pushLineMessage(lineUserId, `📡 ${label}\nอุปกรณ์เชื่อมต่อกลับมาแล้ว (${nowTimeLabel()})`);
    } catch (err) {
      console.error(`[LineAlertWatchdog] push failed for ${label}/reconnect: ${err.message}`);
    }
    setAlertState(hubId, bmsKeyNorm, OFFLINE_CONDITION_ID, 0);
  } else if (stale) {
    return; // still offline, already notified - skip the rest while data is frozen
  }

  // Balancer start/stop, per explicit request - both directions notify
  // (unlike the threshold CONDITIONS below, which only alert on breach and
  // silently reset on recovery), same dual-message shape as offline/
  // reconnect above.
  const balancerCurrent = status.balancing_current ?? status.balance_curr ?? 0;
  const isBalancing = balancerCurrent > BALANCER_EPSILON_A;
  const balRow = getAlertState(hubId, bmsKeyNorm, BALANCER_CONDITION_ID);
  const wasBalancing = balRow ? !!balRow.active : false;
  if (isBalancing && !wasBalancing) {
    try {
      await pushLineMessage(lineUserId, `🔄 ${label}\nBalancer เริ่มทำงาน (${balancerCurrent.toFixed(2)}A) (${nowTimeLabel()})`);
    } catch (err) {
      console.error(`[LineAlertWatchdog] push failed for ${label}/${BALANCER_CONDITION_ID}: ${err.message}`);
    }
    setAlertState(hubId, bmsKeyNorm, BALANCER_CONDITION_ID, 1);
  } else if (!isBalancing && wasBalancing) {
    try {
      await pushLineMessage(lineUserId, `🔄 ${label}\nBalancer หยุดทำงาน (${nowTimeLabel()})`);
    } catch (err) {
      console.error(`[LineAlertWatchdog] push failed for ${label}/balancer-stop: ${err.message}`);
    }
    setAlertState(hubId, bmsKeyNorm, BALANCER_CONDITION_ID, 0);
  }

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

// Fleet-wide (every BMS device under one hub, not per-device) average
// battery alert, per explicit request - same aggregation formula as
// BMSDashboard.jsx's "Battery" box: sum of each device's capacity_remain
// (Ah), sum of each device's own nominal_capacity (Ah), SOC% = remaining/
// total*100. Notifies once per crossed 10%-decile in EITHER direction
// (e.g. 41%->39% fires once for the 40->30 decile change; 39%->31% does
// not fire again since it's still the same decile) - a plain in-memory
// "last notified decile" per hub, not tied to line_alert_state's boolean
// active/inactive shape since a decile is a number, not a threshold
// breach. Resets on restart - the first cycle after a deploy only seeds
// the baseline, never itself fires (nothing to compare against yet).
const lastNotifiedDecileByHub = new Map();
async function checkFleetAverage(hubId, devices, lineUserId) {
  let remainingAh = 0;
  let capacityAh = 0;
  let current = 0;
  for (const { status } of devices) {
    remainingAh += status.capacity_remain || 0;
    capacityAh += status.nominal_capacity || 0;
    current += status.charge_current || 0;
  }
  if (capacityAh <= 0) return; // nothing real to compute a % from yet

  const soc = Math.max(0, Math.min(100, (remainingAh / capacityAh) * 100));
  const decile = Math.floor(soc / 10);
  const prevDecile = lastNotifiedDecileByHub.get(hubId);
  lastNotifiedDecileByHub.set(hubId, decile);

  if (prevDecile === undefined || decile === prevDecile) return;

  const rising = decile > prevDecile;
  // Per explicit request: "เป็น" reads naturally for an increase ("...
  // เพิ่มขึ้น เป็น 50%"), "เหลือ" for a decrease ("...ลดลง เหลือ 50%") - a
  // single fixed word for both directions read awkwardly in Thai.
  const direction = rising ? "เพิ่มขึ้น" : "ลดลง";
  const verb = rising ? "เป็น" : "เหลือ";
  const currentLabel = current > 0 ? `+${current.toFixed(1)}` : current.toFixed(1);
  const message = `🔋 แบตเฉลี่ยทั้งระบบ${direction} ${verb} ${soc.toFixed(0)}% (${remainingAh.toFixed(1)}/${capacityAh.toFixed(1)}Ah) ${currentLabel} A (${nowTimeLabel()})`;
  try {
    await pushLineMessage(lineUserId, message);
  } catch (err) {
    console.error(`[LineAlertWatchdog] fleet average push failed for ${hubId}: ${err.message}`);
  }
}

async function runCycle() {
  if (!isLineMessagingConfigured) return;

  // The link itself lives in Firebase now (JK_BMS_HUB/{hubId}/line_link,
  // not a SQLite table - see routes/line.js's own comment on why), so this
  // reads the whole tree once and picks out whichever hubs have one - same
  // cost class as chargeWatchdog.js's own whole-tree-per-cycle read, and
  // actually fewer round-trips than the old per-hub SQLite-driven reads.
  let allHubs;
  try {
    allHubs = await readPath("JK_BMS_HUB");
  } catch (err) {
    console.error(`[LineAlertWatchdog] whole-tree read failed: ${err.message}`);
    return;
  }
  if (!allHubs || typeof allHubs !== "object") return;

  for (const [hubId, hubData] of Object.entries(allHubs)) {
    if (!hubData || typeof hubData !== "object") continue;
    const lineUserId = hubData.line_link?.lineUserId;
    if (!lineUserId) continue;

    const bmsEntries = Object.entries(hubData).filter(([, v]) => isBmsDevice(v));
    let devices = [];
    if (bmsEntries.length > 0) {
      devices = bmsEntries.map(([, data]) => data);
      for (const [bmsKey, data] of bmsEntries) {
        await checkDevice(hubId, bmsKey, data, lineUserId).catch((err) =>
          console.error(`[LineAlertWatchdog] ${hubId}/${bmsKey} failed: ${err.message}`)
        );
      }
    } else if (isBmsDevice(hubData)) {
      devices = [hubData];
      await checkDevice(hubId, null, hubData, lineUserId).catch((err) => console.error(`[LineAlertWatchdog] ${hubId} failed: ${err.message}`));
    }

    if (devices.length > 0) {
      await checkFleetAverage(hubId, devices, lineUserId).catch((err) =>
        console.error(`[LineAlertWatchdog] fleet average for ${hubId} failed: ${err.message}`)
      );
    }
  }
}

export function startLineAlertWatchdog() {
  setInterval(() => {
    runCycle().catch((err) => console.error(`[LineAlertWatchdog] cycle failed: ${err.message}`));
  }, CHECK_INTERVAL_MS);
  console.log(`[LineAlertWatchdog] started - checking every ${CHECK_INTERVAL_MS / 1000}s`);
}
