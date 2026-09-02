import { writePath } from "./firebaseRead.js";
import { pushLineMessage, isLineMessagingConfigured } from "./lineNotify.js";
import { isWeatherConfigured, fetchWeather } from "./weatherService.js";
import { pick } from "../src/lib/pick.js";
import { getCachedHubTree } from "./hubTreeCache.js";

// Every 15s - prompt enough to catch a real battery event quickly without
// hammering Firebase/LINE for something that isn't sub-second-sensitive
// the way live dashboard telemetry is (see realtime.js's 1s poll).
const CHECK_INTERVAL_MS = 15_000;

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
export function isFleetCountable(value) {
  return !!value && typeof value === "object" && value.status && typeof value.status === "object" && typeof value.status.nominal_capacity === "number";
}

export function deviceLabel(hubId, bmsKey, settings) {
  return settings?.my_custom_name || (bmsKey ? `${hubId}/${bmsKey}` : hubId);
}

// Explicit timeZone is required here - without it, toLocaleTimeString uses
// th-TH only for number/format conventions but the SERVER PROCESS's own
// clock for the actual time, which on Render is UTC (not Bangkok/UTC+7) -
// every notification was showing a time 7 hours behind real Thai time
// until this was pinned down. Bangkok never observes DST, so this is
// always correct with no seasonal adjustment needed (same reasoning
// history.js's bangkokMs already documents).
export function nowTimeLabel() {
  return new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Bangkok" });
}

// Each condition: `id` (for line_alert_state's PK + dedup), `check(status,
// settings)` returning true/false for "currently breached", and
// `message(status, settings, label)` building the Thai push text only
// called the moment it transitions from not-breached to breached (see
// runCycle below) - never re-evaluated while already active, so its
// wording doesn't need to handle a "still happening" phrasing.
// Every status field read below goes through pick() rather than a bare
// status.field access - confirmed real bug (2026-08-26): a device on newer
// bridge firmware reports "soc" (camelCase) instead of "percent_remain"
// (the older snake_case name), so a bare status.percent_remain silently
// read as undefined -> defaulted to 0/100 in each check below -> a real 95%
// battery could sit there full with zero LINE alerts firing, while the
// Dashboard itself still showed 95% correctly because useBmsPackLive.js
// already reads through the same pick(status, "soc", "percent_remain")
// fallback this file now matches exactly (field order matters - "soc" is
// checked first, matching the frontend's own precedence).
export function currentOf(status) {
  return pick(status, "current", "charge_current") ?? 0;
}

// Per explicit request (2026-08-29): cut down from the original 9 to 4 -
// cell imbalance, full 100%, near-empty-15/low-10 (merged into one flat
// "battery remaining 15%"), and the "near" charge/discharge variants
// (charge_near_recommended/discharge_near_recommended) were all removed;
// near-full 95% and the "over" charge/discharge variants were explicitly
// asked to stay. Then per further follow-up (2026-09-01): soc_near_full_95
// and soc_low_15 were dropped again - once the fleet-average low-15%/
// near-full-95% alerts existed too (see checkFleetThresholds), having both
// the per-device AND fleet-average version of the same threshold fired
// redundantly for the same real event (multiple devices independently
// crossing 95% within an hour of each other = 3 separate LINE messages for
// what's really one "system charging up" event) - confirmed real,
// explicitly asked to keep only the fleet-average version.
const CONDITIONS = [
  {
    id: "charge_over_recommended",
    check(status, settings) {
      const current = currentOf(status);
      const recommended = (settings.capacity ?? 0) * 0.25;
      return current > 0 && recommended > 0 && current > recommended;
    },
    message(status, settings, label) {
      const recommended = (settings.capacity ?? 0) * 0.25;
      return `⚡ ${label}\nกระแสชาร์จเกินค่าที่แนะนำ (${currentOf(status).toFixed(1)}A > ${recommended.toFixed(1)}A)`;
    },
  },
  {
    id: "discharge_over_recommended",
    check(status, settings) {
      const current = currentOf(status);
      const recommended = (settings.capacity ?? 0) * 0.5;
      return current < 0 && recommended > 0 && -current > recommended;
    },
    message(status, settings, label) {
      const recommended = (settings.capacity ?? 0) * 0.5;
      return `⚡ ${label}\nใช้ไฟเกินค่าที่แนะนำ (${(-currentOf(status)).toFixed(1)}A > ${recommended.toFixed(1)}A)`;
    },
  },
];

// Edge-trigger dedup state, in Firebase now - NOT SQLite (confirmed real
// bug, 2026-09-01): a fleet-average near-full-95% alert sitting active for
// hours fired 9 times in ~4 hours instead of once, and the back half of
// those repeats landed almost exactly 15 minutes apart. That matches
// Render's free-tier "spin down after 15 min with no HTTP traffic, cold
// start on the next request" behavior - same ephemeral-disk root cause
// line_link and line_prefs were already moved to Firebase for earlier this
// session, just not yet applied here because the original reasoning
// (losing this table only on a rare deploy is harmless/self-healing) didn't
// account for a restart cadence this frequent for a LONG-lived breach.
//
// Reading costs nothing extra: line_alert_state is stored as just another
// sibling key under each hub (JK_BMS_HUB/{hubId}/line_alert_state/...),
// same placement pattern as line_link/line_prefs/location, so it's already
// sitting in the SAME whole-tree object hubTreeCache polls once a second
// for every other purpose in this file - getAlertState below is a plain
// synchronous object lookup against that cache, not a new Firebase read.
// Only setAlertState (an actual breach/recover transition, not every
// cycle) needs a real write.
function alertStateSlot(bmsKey) {
  return bmsKey || "_hub"; // Firebase path segments can't safely be "" - bmsKey="" means a hub-level/fleet-wide condition
}
function alertStatePath(hubId, bmsKey, conditionId) {
  return `JK_BMS_HUB/${hubId}/line_alert_state/${alertStateSlot(bmsKey)}/${conditionId}`;
}
function getAlertState(hubId, bmsKey, conditionId) {
  const tree = getCachedHubTree();
  const val = tree?.[hubId]?.line_alert_state?.[alertStateSlot(bmsKey)]?.[conditionId];
  return val && typeof val === "object" ? val : null;
}
async function setAlertState(hubId, bmsKey, conditionId, active) {
  try {
    await writePath(alertStatePath(hubId, bmsKey, conditionId), { active, updatedAt: Date.now() });
  } catch (err) {
    console.error(`[LineAlertWatchdog] setAlertState write failed for ${hubId}/${bmsKey}/${conditionId}: ${err.message}`);
  }
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
      await setAlertState(hubId, bmsKeyNorm, condition.id, 1);
    } else if (isBreached && wasActive && condition.repeatMs) {
      // Still breached, and this condition wants periodic reminders (per
      // explicit request for soc_low_10 - a critically-low battery left
      // un-charged for hours shouldn't go silent after the first notice).
      // updatedAt doubles as "last notified at" here since setAlertState
      // is the only writer and always stamps it fresh.
      const lastNotifiedAt = row.updatedAt ?? 0;
      if (Date.now() - lastNotifiedAt >= condition.repeatMs) {
        try {
          await pushLineMessage(lineUserId, condition.message(status, settings, label));
        } catch (err) {
          console.error(`[LineAlertWatchdog] repeat push failed for ${label}/${condition.id}: ${err.message}`);
        }
        await setAlertState(hubId, bmsKeyNorm, condition.id, 1);
      }
    } else if (!isBreached && wasActive) {
      // Recovered - reset so the next real breach can notify again.
      await setAlertState(hubId, bmsKeyNorm, condition.id, 0);
    }
  }
}

// Per-hub notification preferences, checklist on the LINE settings page.
// Per explicit request (2026-08-29), trimmed down to: weather (rain/sun
// only), fleet-average step 20% (the old 10% alternative removed),
// fleet-average low-15%/near-full-95% thresholds (added 2026-08-31 - same
// idea as the per-device soc_low_15/soc_near_full_95 CONDITIONS, but
// against the aggregated fleet SOC instead of one device), plus the two
// user-set numeric limits below. The "remind every 3h while stuck" reminder
// (was here between 2026-08-29 and 2026-09-01) was removed entirely per
// follow-up request. Stored at JK_BMS_HUB/{hubId}/line_prefs (see routes/
// line.js) - same durable Firebase placement as line_link, for the same
// ephemeral-Render-disk reason. step20/fleetLow15/fleetNearFull95 default
// ON (all part of the fleet-average section); weatherEnabled +
// wattLimit/chargeAmpLimit are the "เลือกติกได้" group - opt-in, off by
// default, since those vary per installation and there's no one-size
// default that makes sense.
const DEFAULT_PREFS = {
  step20: true,
  fleetLow15: true,
  fleetNearFull95: true,
  weatherEnabled: false,
  wattLimit: 0,
  chargeAmpLimit: 0,
};
function normalizePrefs(raw) {
  const p = { ...DEFAULT_PREFS, ...(raw && typeof raw === "object" ? raw : {}) };
  return {
    step: p.step20 ? 20 : null,
    fleetLow15: !!p.fleetLow15,
    fleetNearFull95: !!p.fleetNearFull95,
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

// Shared with routes/line.js's /webhook (the on-demand "เช็คสถานะ" reply
// feature, 2026-08-26) so a status check answers with EXACTLY the same
// numbers the automatic fleet-average alerts use - one formula, not two
// copies that could quietly drift apart.
export function computeFleetSummary(devices) {
  let remainingAh = 0;
  let capacityAh = 0;
  let current = 0;
  for (const { status } of devices) {
    remainingAh += status.capacity_remain || 0;
    capacityAh += status.nominal_capacity || 0;
    current += currentOf(status);
  }
  const soc = capacityAh > 0 ? Math.max(0, Math.min(100, (remainingAh / capacityAh) * 100)) : null;
  // Same convention BMSDashboard.jsx's "System Vol" tile already uses - the
  // packs are wired in parallel, so they share (near enough) one real
  // voltage rather than summing, and the first live device's own reading is
  // the representative value (see its own comment on this exact tradeoff).
  const voltage = devices.find((d) => d.status?.battery_voltage > 0)?.status?.battery_voltage ?? 0;
  return { soc, remainingAh, capacityAh, current, voltage };
}

async function checkFleetAverage(hubId, devices, lineUserId, prefs) {
  const { soc, remainingAh, capacityAh, voltage } = computeFleetSummary(devices);
  if (soc === null) return; // nothing real to compute a % from yet
  if (!prefs.step) return; // step20 disabled - feature off

  const binKey = `${hubId}:${prefs.step}`;
  const prevBin = lastNotifiedBinByHub.get(binKey);
  const rawBin = Math.floor(soc / prefs.step);
  const detail = `${voltage.toFixed(2)}V (${nowTimeLabel()})`;

  if (prevBin === undefined) {
    // First observation ever (or since restart, or since this step size was
    // just enabled) - just seed the baseline, never fire on it.
    lastNotifiedBinByHub.set(binKey, rawBin);
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
  }
}

// Fleet-average low-15%/near-full-95% alerts, per explicit request
// (2026-08-31) - same idea as the per-device soc_low_15/soc_near_full_95
// CONDITIONS, but against the aggregated fleet SOC (computeFleetSummary)
// instead of one device's own reading, and each independently toggleable
// via prefs (unlike the per-device ones, which are always on). Edge-
// triggered through line_alert_state (hub-scoped, bmsKey=""), same simple
// breach/recover boolean shape as the Watt/Amp alerts below.
//
// Confirmed real flapping (2026-09-01): fired 5 times in 12 minutes while
// soc sat in a 9-15% band, real telemetry noise crossing back over the flat
// 15%/95% line repeatedly - same root cause the fleet-average %-step
// alert's own BIN_HYSTERESIS_PERCENT already fixed. Same fix here: once
// active, require the value to clear the line by
// FLEET_THRESHOLD_HYSTERESIS_PERCENT before counting as recovered, not just
// touch it.
//
// Also per explicit request: fleetLow15 only fires while the fleet is NOT
// actively charging (current > 0, this codebase's established sign
// convention) - a low reading that's already charging back up isn't the
// urgent case this alert exists for. fleetNearFull95 has no such gate
// (charging is how you GET near-full in the first place).
const FLEET_THRESHOLD_HYSTERESIS_PERCENT = 2;
const FLEET_NEAR_FULL_REARM_PERCENT = 65;
const FLEET_LOW_15_CONDITION_ID = "fleet_soc_low_15";
const FLEET_NEAR_FULL_95_CONDITION_ID = "fleet_soc_near_full_95";
async function checkFleetThresholds(hubId, devices, lineUserId, prefs) {
  const { soc, current, voltage } = computeFleetSummary(devices);
  if (soc === null) return;
  const detail = `(${soc.toFixed(0)}%, ${voltage.toFixed(2)}V) (${nowTimeLabel()})`;

  if (prefs.fleetLow15) {
    const row = getAlertState(hubId, "", FLEET_LOW_15_CONDITION_ID);
    const wasActive = row ? !!row.active : false;
    const socBreached = wasActive ? soc <= 15 + FLEET_THRESHOLD_HYSTERESIS_PERCENT : soc <= 15;
    const isBreached = socBreached && current <= 0; // suppressed while charging
    if (isBreached && !wasActive) {
      try {
        await pushLineMessage(lineUserId, `🪫 แบตเฉลี่ยทั้งระบบเหลือน้อย ${detail}`);
      } catch (err) {
        console.error(`[LineAlertWatchdog] fleet low-15 push failed for ${hubId}: ${err.message}`);
      }
      await setAlertState(hubId, "", FLEET_LOW_15_CONDITION_ID, 1);
    } else if (!isBreached && wasActive) {
      await setAlertState(hubId, "", FLEET_LOW_15_CONDITION_ID, 0);
    }
  }

  if (prefs.fleetNearFull95) {
    // Per further explicit request (2026-09-02): a small hysteresis band
    // still re-fired once a day or more for a system that shallow-cycles
    // near the 95% line (charges up, a small load pulls it back down a
    // few %, charges back up again). Once notified, this now stays silent
    // regardless of how many times it re-enters the 95-99% band, and only
    // "rearms" (ready to fire again on the next climb to 95%) once soc has
    // genuinely dropped to FLEET_NEAR_FULL_REARM_PERCENT (65%) first - a
    // real deep-discharge-then-recharge cycle, not line noise.
    const row = getAlertState(hubId, "", FLEET_NEAR_FULL_95_CONDITION_ID);
    const wasActive = row ? !!row.active : false;
    if (!wasActive && soc >= 95 && soc < 100) {
      try {
        await pushLineMessage(lineUserId, `🔋 แบตเฉลี่ยทั้งระบบใกล้เต็มแล้ว ${detail}`);
      } catch (err) {
        console.error(`[LineAlertWatchdog] fleet near-full-95 push failed for ${hubId}: ${err.message}`);
      }
      await setAlertState(hubId, "", FLEET_NEAR_FULL_95_CONDITION_ID, 1);
    } else if (wasActive && soc <= FLEET_NEAR_FULL_REARM_PERCENT) {
      await setAlertState(hubId, "", FLEET_NEAR_FULL_95_CONDITION_ID, 0);
    }
  }
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
    await setAlertState(hubId, "", WATT_ALERT_CONDITION_ID, 1);
  } else if (!isBreached && wasActive) {
    // Recovered - reset silently so the next real breach can notify again,
    // same as the per-device CONDITIONS above.
    await setAlertState(hubId, "", WATT_ALERT_CONDITION_ID, 0);
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
    totalCurrent += currentOf(status);
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
    await setAlertState(hubId, "", CHARGE_AMP_ALERT_CONDITION_ID, 1);
  } else if (!isBreached && wasActive) {
    await setAlertState(hubId, "", CHARGE_AMP_ALERT_CONDITION_ID, 0);
  }
}

async function runCycle() {
  if (!isLineMessagingConfigured) return;

  // The link itself lives in Firebase now (JK_BMS_HUB/{hubId}/line_link,
  // not a SQLite table - see routes/line.js's own comment on why), so this
  // reads the whole tree and picks out whichever hubs have one. Reads the
  // shared hubTreeCache (per explicit bandwidth-reduction request,
  // 2026-08-29) rather than its own readPath call - same tree
  // chargeWatchdog.js/telemetryLogger.js/realtime.js all now share, kept at
  // most 1s stale, well within what a 15s cycle already tolerated.
  const allHubs = getCachedHubTree();
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
      await checkFleetThresholds(hubId, fleetDevices, lineUserId, prefs).catch((err) =>
        console.error(`[LineAlertWatchdog] fleet thresholds for ${hubId} failed: ${err.message}`)
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
