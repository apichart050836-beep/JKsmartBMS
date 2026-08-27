import { db } from "./db.js";
import { readPath } from "./firebaseRead.js";
import { pushLineMessage, isLineMessagingConfigured } from "./lineNotify.js";
import { isWeatherConfigured, fetchWeather } from "./weatherService.js";

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

// Looser than isBmsDevice() - the fleet-average sum below only ever reads
// status fields (capacity_remain, nominal_capacity, charge_current,
// battery_voltage), never settings, so it shouldn't require settings to be
// present too. Confirmed live (2026-08-25) that requiring both was the real
// cause of the fleet-average spamming false 10%-decile crossings: a
// device's settings node came back briefly missing from a Firebase read
// (its own separate write racing this one) while status kept updating
// normally, so isBmsDevice() dropped that whole device out of the sum for
// that single poll - total nominal_capacity was seen flipping between two
// values (e.g. 600Ah/900Ah) 15-30s apart, exactly matching one ~300Ah
// device disappearing and reappearing, swinging the average SOC by several
// percent purely from the device count changing, not any real battery
// movement.
function isFleetCountable(value) {
  return !!value && typeof value === "object" && value.status && typeof value.status === "object" && typeof value.status.nominal_capacity === "number";
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
//
// 30s (2x CHECK_INTERVAL_MS) still wasn't enough margin - confirmed by a
// real 2026-08-26 flap: offline fired, reconnect fired exactly one 15s poll
// later. That means the real quiet gap that triggered it was somewhere in
// (30s, 45s] - right on top of the old threshold. Raised to 60s (4x
// CHECK_INTERVAL_MS) for solid margin above that observed range - a real
// disconnect still gets caught within about a minute, which is plenty fast
// for a notification (not a safety-critical control loop).
const STALE_AFTER_MS = 60_000;
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
    id: "soc_near_full_95",
    check(status) {
      const soc = status.percent_remain ?? 0;
      return soc >= 95 && soc < 100;
    },
    message(status, settings, label) {
      return `🔋 ${label}\nแบตใกล้เต็มแล้ว (${(status.percent_remain ?? 0).toFixed(0)}%, ${(status.battery_voltage ?? 0).toFixed(2)}V)`;
    },
  },
  {
    id: "soc_full_100",
    check(status) {
      return (status.percent_remain ?? 0) >= 100;
    },
    message(status, settings, label) {
      return `🔋 ${label}\nแบตชาร์จเต็ม 100% แล้ว (${(status.battery_voltage ?? 0).toFixed(2)}V)`;
    },
  },
  {
    id: "soc_near_empty_15",
    check(status) {
      const soc = status.percent_remain ?? 100;
      return soc <= 15 && soc > 10;
    },
    message(status, settings, label) {
      return `🪫 ${label}\nแบตใกล้หมดแล้ว (${(status.percent_remain ?? 0).toFixed(0)}%, ${(status.battery_voltage ?? 0).toFixed(2)}V)`;
    },
  },
  {
    id: "soc_low_10",
    check(status) {
      return (status.percent_remain ?? 100) <= 10;
    },
    message(status, settings, label) {
      return `🪫 ${label}\nแบตเหลือน้อยมาก (${(status.percent_remain ?? 0).toFixed(0)}%, ${(status.battery_voltage ?? 0).toFixed(2)}V) กรุณาชาร์จโดยเร็ว`;
    },
    // Per explicit request: unlike the other CONDITIONS (notify once on
    // breach, silent until recovery), a critically-low battery that just
    // sits there un-charged should keep reminding - once, then again every
    // repeatMs while still breached, not just on the initial edge.
    repeatMs: 60 * 60 * 1000,
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
  return db
    .prepare(`SELECT active, updated_at FROM line_alert_state WHERE hub_id = ? AND bms_key = ? AND condition_id = ?`)
    .get(hubId, bmsKey, conditionId);
}
function setAlertState(hubId, bmsKey, conditionId, active) {
  db.prepare(
    `INSERT INTO line_alert_state (hub_id, bms_key, condition_id, active, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (hub_id, bms_key, condition_id) DO UPDATE SET active = excluded.active, updated_at = excluded.updated_at`
  ).run(hubId, bmsKey, conditionId, active, Date.now());
}

const OFFLINE_CONDITION_ID = "device_offline";

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
    } else if (isBreached && wasActive && condition.repeatMs) {
      // Still breached, and this condition wants periodic reminders (per
      // explicit request for soc_low_10 - a critically-low battery left
      // un-charged for hours shouldn't go silent after the first notice).
      // updated_at doubles as "last notified at" here since setAlertState
      // is the only writer and always stamps it fresh.
      const lastNotifiedAt = row.updated_at ?? 0;
      if (Date.now() - lastNotifiedAt >= condition.repeatMs) {
        try {
          await pushLineMessage(lineUserId, condition.message(status, settings, label));
        } catch (err) {
          console.error(`[LineAlertWatchdog] repeat push failed for ${label}/${condition.id}: ${err.message}`);
        }
        setAlertState(hubId, bmsKeyNorm, condition.id, 1);
      }
    } else if (!isBreached && wasActive) {
      // Recovered - reset so the next real breach can notify again.
      setAlertState(hubId, bmsKeyNorm, condition.id, 0);
    }
  }
}

// Per-hub notification preferences, per explicit request (2026-08-25) for a
// checklist on the LINE settings page: "เลือกทั้งหมด" (select all), remind
// every 2h/3h (was 1h/2h until 2026-08-26's follow-up request), weather
// (rain/sun only), fleet-average step 10%/20% - a flat multi-select, not
// mutually-exclusive radios, so both step boxes (or both reminder boxes)
// CAN be checked at once. Rather than run two independent trackers in that
// case, this just takes the finer/shorter of whichever are enabled (step:
// 20 is already a subset of every 10%-crossing point, so enabling both is
// equivalent to just 10; reminder: the shorter interval would always win
// the race anyway) - checking more boxes only ever increases notification
// frequency, never decreases it, matching what a user checking more boxes
// would expect. Stored at JK_BMS_HUB/{hubId}/line_prefs (see routes/line.js)
// - same durable Firebase placement as line_link, for the same
// ephemeral-Render-disk reason. Defaults: remind2h (now the shorter of the
// two available options) + step20 + weather on by default.
// wattLimit/chargeAmpLimit have no meaningful default (0/unset means that
// alert is simply off until a hub owner sets their own number - no
// one-size number makes sense across different installations).
const DEFAULT_PREFS = {
  remind2h: true,
  remind3h: false,
  step10: false,
  step20: true,
  weatherEnabled: true,
  wattLimit: 0,
  chargeAmpLimit: 0,
};
function normalizePrefs(raw) {
  const p = { ...DEFAULT_PREFS, ...(raw && typeof raw === "object" ? raw : {}) };
  const steps = [p.step10 && 10, p.step20 && 20].filter(Boolean);
  const reminderHours = [p.remind2h && 2, p.remind3h && 3].filter(Boolean);
  return {
    step: steps.length ? Math.min(...steps) : null,
    reminderMs: reminderHours.length ? Math.min(...reminderHours) * 60 * 60 * 1000 : null,
    weatherEnabled: !!p.weatherEnabled,
    wattLimit: typeof p.wattLimit === "number" && p.wattLimit > 0 ? p.wattLimit : null,
    chargeAmpLimit: typeof p.chargeAmpLimit === "number" && p.chargeAmpLimit > 0 ? p.chargeAmpLimit : null,
  };
}

// Weather condition alert, per explicit request - only rain or clear/sun,
// everything else (clouds, mist, ...) is deliberately not "interesting"
// enough to notify about and just resets nothing. Reuses the exact same
// per-hub installation location already saved for the dashboard's own
// weather button (JK_BMS_HUB/{hubId}/location - see useWeatherLocation.js),
// and the same OpenWeatherMap `condition` values the frontend's
// WEATHER_ICONS map already keys off of. Rate-limited to one real API call
// per hub every WEATHER_CHECK_INTERVAL_MS regardless of the 15s watchdog
// cycle - weather doesn't change on a 15s cadence, and there's no reason to
// burn OpenWeatherMap's rate limit checking it that often.
const WEATHER_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const RAIN_CONDITIONS = new Set(["Rain", "Drizzle", "Thunderstorm"]);
const SUN_CONDITIONS = new Set(["Clear"]);
function weatherCategory(condition) {
  if (RAIN_CONDITIONS.has(condition)) return "rain";
  if (SUN_CONDITIONS.has(condition)) return "sun";
  return "other";
}
const lastWeatherCheckAtByHub = new Map();
const lastWeatherCategoryByHub = new Map();
async function checkWeather(hubId, location, lineUserId) {
  if (!isWeatherConfigured()) return;
  if (!location || typeof location.lat !== "number" || typeof location.lng !== "number") return;

  const lastCheckedAt = lastWeatherCheckAtByHub.get(hubId);
  if (lastCheckedAt !== undefined && Date.now() - lastCheckedAt < WEATHER_CHECK_INTERVAL_MS) return;
  lastWeatherCheckAtByHub.set(hubId, Date.now());

  let weather;
  try {
    weather = await fetchWeather(location.lat, location.lng);
  } catch (err) {
    console.error(`[LineAlertWatchdog] weather fetch failed for ${hubId}: ${err.message}`);
    return;
  }

  const category = weatherCategory(weather.condition);
  const prevCategory = lastWeatherCategoryByHub.get(hubId);
  lastWeatherCategoryByHub.set(hubId, category);

  // Edge-triggered like everything else in this file: only notify the
  // moment it TURNS into rain/sun from something else, not on every check
  // while it stays that way, and never on the very first observation.
  if (prevCategory === undefined || category === prevCategory || category === "other") return;

  const icon = category === "rain" ? "🌧️" : "☀️";
  const label = category === "rain" ? "ฝนตก" : "แดดออก";
  const tempLabel = typeof weather.temperature === "number" ? ` ${weather.temperature.toFixed(0)}°C` : "";
  const message = `${icon} สภาพอากาศ${location.name ? ` (${location.name})` : ""}: ${label}${tempLabel} (${nowTimeLabel()})`;
  try {
    await pushLineMessage(lineUserId, message);
  } catch (err) {
    console.error(`[LineAlertWatchdog] weather push failed for ${hubId}: ${err.message}`);
  }
}

// Fleet-wide (every BMS device under one hub, not per-device) average
// battery alert, per explicit request - same aggregation formula as
// BMSDashboard.jsx's "Battery" box: sum of each device's capacity_remain
// (Ah), sum of each device's own nominal_capacity (Ah), SOC% = remaining/
// total*100. Notifies once per crossed step% (10 or 20, see `prefs.step`
// below) in EITHER direction - a plain in-memory "last notified bin" per
// hub, keyed by hubId+step so switching step size doesn't reuse a bin
// number from the other size. Resets on restart - the first cycle after a
// deploy only seeds the baseline, never itself fires (nothing to compare
// against yet).
//
// Per explicit follow-up (2026-08-25): the Ah/current detail was dropped
// from the message entirely - shows % (and V) only now. Not just cosmetic:
// even after isFleetCountable's fix, the request was to stop depending on
// the Ah figure being trustworthy in the notification text at all, so a
// future glitch of the same shape can't produce a confusing-looking message
// again even if it ever again affects the underlying sum.
// Dead-band applied on top of each step boundary (see checkFleetAverage's
// own comment on the specific flapping this fixes).
const BIN_HYSTERESIS_PERCENT = 1;
const lastNotifiedBinByHub = new Map();
// If SOC sits still inside the same bin for a long time (e.g. parked at
// 60% for hours), send one "still at X%" reminder every
// `prefs.reminderMs` rather than staying silent forever - tracked
// separately from the bin-cross timing so a real cross always resets the
// reminder clock too (no double-notify right after a cross).
const lastFleetNotifyAtByHub = new Map();
async function checkFleetAverage(hubId, devices, lineUserId, prefs) {
  let remainingAh = 0;
  let capacityAh = 0;
  let current = 0;
  for (const { status } of devices) {
    remainingAh += status.capacity_remain || 0;
    capacityAh += status.nominal_capacity || 0;
    current += status.charge_current || 0;
  }
  if (capacityAh <= 0) return; // nothing real to compute a % from yet
  if (!prefs.step) return; // both step10/step20 disabled - feature off

  const soc = Math.max(0, Math.min(100, (remainingAh / capacityAh) * 100));
  const binKey = `${hubId}:${prefs.step}`;
  const prevBin = lastNotifiedBinByHub.get(binKey);
  const rawBin = Math.floor(soc / prefs.step);

  // Same convention BMSDashboard.jsx's "System Vol" tile already uses - the
  // packs are wired in parallel, so they share (near enough) one real
  // voltage rather than summing, and the first live device's own reading is
  // the representative value (see its own comment on this exact tradeoff).
  const voltage = devices.find((d) => d.status?.battery_voltage > 0)?.status?.battery_voltage ?? 0;
  const detail = `${voltage.toFixed(2)}V (${nowTimeLabel()})`;

  if (prevBin === undefined) {
    // First observation ever (or since restart, or since this step size was
    // just enabled) - just seed both baselines, never fire on it.
    lastNotifiedBinByHub.set(binKey, rawBin);
    lastFleetNotifyAtByHub.set(hubId, Date.now());
    return;
  }

  // Hysteresis, per explicit report (2026-08-26): a plain floor(soc/step)
  // committed every cycle flapped repeatedly when soc sat right on a step
  // line (e.g. bouncing 79.6%/80.3%/79.8% around the 80% boundary for
  // step20) - each tiny wobble crossed the exact integer line and fired a
  // "increased"/"decreased" pair a minute apart, both rounding to the same
  // displayed "80%". Moving OFF the currently-committed bin now requires
  // soc to clear that bin's edge by BIN_HYSTERESIS_PERCENT, not just touch
  // it - the bin (and lastNotifiedBinByHub) only updates when that margin is
  // actually cleared, so small noise right at a boundary no longer commits
  // a new bin at all, let alone notifies.
  let bin = prevBin;
  if (rawBin > prevBin && soc >= (prevBin + 1) * prefs.step + BIN_HYSTERESIS_PERCENT) {
    bin = rawBin;
  } else if (rawBin < prevBin && soc < prevBin * prefs.step - BIN_HYSTERESIS_PERCENT) {
    bin = rawBin;
  }
  if (bin !== prevBin) lastNotifiedBinByHub.set(binKey, bin);

  if (bin !== prevBin) {
    const rising = bin > prevBin;
    // Per explicit request: "เป็น" reads naturally for an increase ("...
    // เพิ่มขึ้น เป็น 50%"), "เหลือ" for a decrease ("...ลดลง เหลือ 50%") - a
    // single fixed word for both directions read awkwardly in Thai.
    const direction = rising ? "เพิ่มขึ้น" : "ลดลง";
    const verb = rising ? "เป็น" : "เหลือ";
    const message = `🔋 แบตเฉลี่ยทั้งระบบ${direction} ${verb} ${soc.toFixed(0)}% ${detail}`;
    try {
      await pushLineMessage(lineUserId, message);
    } catch (err) {
      console.error(`[LineAlertWatchdog] fleet average push failed for ${hubId}: ${err.message}`);
    }
    lastFleetNotifyAtByHub.set(hubId, Date.now());
    return;
  }

  if (!prefs.reminderMs) return; // both remind1h/remind2h disabled - no repeat reminder

  // Same bin as last time - only remind once prefs.reminderMs has passed
  // since the last notification (cross or reminder alike).
  const lastNotifyAt = lastFleetNotifyAtByHub.get(hubId);
  if (lastNotifyAt !== undefined && Date.now() - lastNotifyAt < prefs.reminderMs) return;

  const message = `🔋 แบตเฉลี่ยทั้งระบบยังคงอยู่ที่ ${soc.toFixed(0)}% ${detail}`;
  try {
    await pushLineMessage(lineUserId, message);
  } catch (err) {
    console.error(`[LineAlertWatchdog] fleet average reminder push failed for ${hubId}: ${err.message}`);
  }
  lastFleetNotifyAtByHub.set(hubId, Date.now());
}

// User-configurable Watt-usage alert, per explicit request (2026-08-26) -
// "การใช้งาน" (usage/load draw) means net DISCHARGE power, matching this
// codebase's established sign convention (negative current/power =
// discharging - see BMSDashboard.jsx/useBmsPackLive.js). Fleet-wide total,
// summed the same way remainingAh/capacityAh/current are above. Edge-
// triggered through the same line_alert_state table the per-device
// CONDITIONS use (hub-scoped, bmsKey="", a fixed condition id) rather than
// a separate in-memory Map, since it's the same simple breach/recover
// boolean shape as those.
const WATT_ALERT_CONDITION_ID = "fleet_watt_over";
async function checkFleetPower(hubId, devices, lineUserId, prefs) {
  if (!prefs.wattLimit) return; // 0/unset - user hasn't turned this on

  let totalPower = 0;
  for (const { status } of devices) {
    totalPower += status.power ?? status.battery_power ?? 0;
  }
  const usageWatt = totalPower < 0 ? -totalPower : 0;
  const isBreached = usageWatt > prefs.wattLimit;
  const row = getAlertState(hubId, "", WATT_ALERT_CONDITION_ID);
  const wasActive = row ? !!row.active : false;

  if (isBreached && !wasActive) {
    const message = `⚡ แบตเฉลี่ยทั้งระบบใช้พลังงานเกินที่ตั้งไว้ (${usageWatt.toFixed(0)}W > ${prefs.wattLimit}W) (${nowTimeLabel()})`;
    try {
      await pushLineMessage(lineUserId, message);
    } catch (err) {
      console.error(`[LineAlertWatchdog] fleet watt push failed for ${hubId}: ${err.message}`);
    }
    setAlertState(hubId, "", WATT_ALERT_CONDITION_ID, 1);
  } else if (!isBreached && wasActive) {
    // Recovered - reset silently so the next real breach can notify again,
    // same as the per-device CONDITIONS above.
    setAlertState(hubId, "", WATT_ALERT_CONDITION_ID, 0);
  }
}

// Same shape as checkFleetPower above, but the CHARGE side in Amps rather
// than the discharge/usage side in Watts, per explicit request (2026-08-26)
// - a separate user-set number, not derived from wattLimit, since Amps and
// Watts aren't the same axis a user necessarily wants the same limit on.
const CHARGE_AMP_ALERT_CONDITION_ID = "fleet_charge_amp_over";
async function checkFleetChargeCurrent(hubId, devices, lineUserId, prefs) {
  if (!prefs.chargeAmpLimit) return; // 0/unset - user hasn't turned this on

  let totalCurrent = 0;
  for (const { status } of devices) {
    totalCurrent += status.charge_current || 0;
  }
  const chargeAmps = totalCurrent > 0 ? totalCurrent : 0;
  const isBreached = chargeAmps > prefs.chargeAmpLimit;
  const row = getAlertState(hubId, "", CHARGE_AMP_ALERT_CONDITION_ID);
  const wasActive = row ? !!row.active : false;

  if (isBreached && !wasActive) {
    const message = `⚡ แบตเฉลี่ยทั้งระบบชาร์จเกินที่ตั้งไว้ (${chargeAmps.toFixed(1)}A > ${prefs.chargeAmpLimit}A) (${nowTimeLabel()})`;
    try {
      await pushLineMessage(lineUserId, message);
    } catch (err) {
      console.error(`[LineAlertWatchdog] fleet charge-amp push failed for ${hubId}: ${err.message}`);
    }
    setAlertState(hubId, "", CHARGE_AMP_ALERT_CONDITION_ID, 1);
  } else if (!isBreached && wasActive) {
    setAlertState(hubId, "", CHARGE_AMP_ALERT_CONDITION_ID, 0);
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
    if (bmsEntries.length > 0) {
      for (const [bmsKey, data] of bmsEntries) {
        await checkDevice(hubId, bmsKey, data, lineUserId).catch((err) =>
          console.error(`[LineAlertWatchdog] ${hubId}/${bmsKey} failed: ${err.message}`)
        );
      }
    } else if (isBmsDevice(hubData)) {
      await checkDevice(hubId, null, hubData, lineUserId).catch((err) => console.error(`[LineAlertWatchdog] ${hubId} failed: ${err.message}`));
    }

    // Deliberately a SEPARATE pass with its own looser filter (see
    // isFleetCountable's comment) rather than reusing bmsEntries above - a
    // device missing from that stricter list for one poll must not also
    // drop out of the fleet-average sum.
    const fleetEntries = Object.entries(hubData).filter(([, v]) => isFleetCountable(v));
    let fleetDevices = [];
    if (fleetEntries.length > 0) {
      fleetDevices = fleetEntries.map(([, data]) => data);
    } else if (isFleetCountable(hubData)) {
      fleetDevices = [hubData];
    }

    const prefs = normalizePrefs(hubData.line_prefs);

    if (fleetDevices.length > 0) {
      await checkFleetAverage(hubId, fleetDevices, lineUserId, prefs).catch((err) =>
        console.error(`[LineAlertWatchdog] fleet average for ${hubId} failed: ${err.message}`)
      );
      await checkFleetPower(hubId, fleetDevices, lineUserId, prefs).catch((err) =>
        console.error(`[LineAlertWatchdog] fleet watt for ${hubId} failed: ${err.message}`)
      );
      await checkFleetChargeCurrent(hubId, fleetDevices, lineUserId, prefs).catch((err) =>
        console.error(`[LineAlertWatchdog] fleet charge-amp for ${hubId} failed: ${err.message}`)
      );
    }

    if (prefs.weatherEnabled) {
      await checkWeather(hubId, hubData.location, lineUserId).catch((err) =>
        console.error(`[LineAlertWatchdog] weather for ${hubId} failed: ${err.message}`)
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
