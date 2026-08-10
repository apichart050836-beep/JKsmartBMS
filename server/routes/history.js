import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { canAccessHub } from "../hubAccess.js";
import { db } from "../db.js";

const router = Router();

// Bangkok never observes DST, so this offset is always exactly right -
// converts a Y/M/D in Asia/Bangkok wall-clock time to the UTC instant it
// represents, regardless of what timezone the server process itself runs
// in (never rely on the host machine's local TZ for a day boundary).
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
function bangkokMs(y, mIdx, d) {
  return Date.UTC(y, mIdx, d, 0, 0, 0, 0) - BANGKOK_OFFSET_MS;
}

// A single bad Firebase read (e.g. a momentary reset of capacity_remain to
// 0 during a brief device disconnect - confirmed live, not hypothetical)
// would otherwise register as a huge fake charge/discharge spike between
// two snapshots. At the rated 100A continuous current and the steady-state
// 5-minute snapshot interval, the real maximum plausible delta is
// 100A * (5/60)h = ~8.3 Ah - 10 Ah gives headroom above that while safely
// rejecting a ~30 Ah reset-to-zero glitch.
const MAX_PLAUSIBLE_DELTA_AH = 10;

// A gap this long between two snapshots (missed polls, device offline,
// backend restart) means we genuinely don't know what the current did in
// between - better to skip the interval entirely ("only compute for periods
// with real data") than assume the last known current held constant across
// an hours-long outage.
const MAX_INTERVAL_MS = 15 * 60 * 1000;

function isSafeKey(k) {
  return typeof k === "string" && k.length > 0 && !/[./#$\[\]]/.test(k);
}

// Prepared lazily (not at module load) - this module is imported before
// migrate() has necessarily run, and telemetry_log wouldn't exist yet.
function selectRange(hubId, bmsKey, from, to) {
  return db
    .prepare(
      `SELECT ts, pack_voltage, charge_current, capacity_remain, percent_remain
       FROM telemetry_log
       WHERE hub_id = ? AND bms_key = ? AND ts >= ? AND ts < ?
       ORDER BY ts ASC`
    )
    .all(hubId, bmsKey, from, to);
}

// Real energy integration between consecutive snapshots - charge_current is
// a genuine SIGNED net current (confirmed against 85 real logged rows:
// ranges -2.567 to +3.679, and the sign matches capacity_remain moving up
// vs down), so Energy(Wh) = avg(battery_voltage) * avg(charge_current) *
// elapsed hours is directly computable, split into charged (current > 0)
// and discharged (abs of current < 0) - never negative in the totals.
// Trapezoidal (average of the two endpoint readings) rather than just the
// later reading, since that's the honest estimate of what happened between
// two samples taken 30s-5min apart.
function bucketEnergy(rows, bucketKeyFn) {
  const buckets = new Map();
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const curr = rows[i];
    if (typeof prev.capacity_remain !== "number" || typeof curr.capacity_remain !== "number") continue;
    if (typeof prev.charge_current !== "number" || typeof curr.charge_current !== "number") continue;
    if (typeof prev.pack_voltage !== "number" || typeof curr.pack_voltage !== "number") continue;

    const dtMs = curr.ts - prev.ts;
    if (dtMs <= 0 || dtMs > MAX_INTERVAL_MS) continue; // dedup guard + gap guard

    const capDelta = curr.capacity_remain - prev.capacity_remain;
    if (Math.abs(capDelta) > MAX_PLAUSIBLE_DELTA_AH) continue; // reset-to-zero glitch guard

    const hours = dtMs / 3_600_000;
    const avgCurrent = (prev.charge_current + curr.charge_current) / 2;
    const avgVoltage = (prev.pack_voltage + curr.pack_voltage) / 2;
    const ah = avgCurrent * hours;
    const wh = avgVoltage * avgCurrent * hours;

    const key = bucketKeyFn(curr.ts);
    if (!buckets.has(key)) buckets.set(key, { chargedAh: 0, dischargedAh: 0, chargedWh: 0, dischargedWh: 0 });
    const bucket = buckets.get(key);
    if (avgCurrent > 0) {
      bucket.chargedAh += ah;
      bucket.chargedWh += wh;
    } else if (avgCurrent < 0) {
      bucket.dischargedAh += -ah;
      bucket.dischargedWh += -wh;
    }
  }
  return buckets;
}

const emptyTotals = () => ({ chargedAh: 0, dischargedAh: 0, chargedWh: 0, dischargedWh: 0 });

router.get("/:hubId/history/daily", requireAuth, (req, res) => {
  const { hubId } = req.params;
  const bmsKey = req.query.bmsKey ?? "";
  const dateStr = String(req.query.date ?? "");
  if (!isSafeKey(hubId) || !canAccessHub(req.user, hubId)) return res.status(403).json({ error: "Forbidden" });
  if (bmsKey && !isSafeKey(bmsKey)) return res.status(400).json({ error: "Invalid bmsKey" });

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return res.status(400).json({ error: "Invalid date" });
  const dayStart = bangkokMs(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;

  const rows = selectRange(hubId, bmsKey, dayStart, dayEnd);
  const buckets = bucketEnergy(rows, () => "day");
  const totals = buckets.get("day") ?? emptyTotals();

  res.json({
    date: dateStr,
    points: rows.map((r) => ({
      ts: r.ts,
      packVoltage: r.pack_voltage,
      chargeCurrent: r.charge_current,
      capacityRemain: r.capacity_remain,
      percentRemain: r.percent_remain,
    })),
    totals,
  });
});

// Fleet-wide (every bms_key under this hub, not just one device) peak
// charge/discharge power today, for the Solar Hybrid Energy Flow panel's
// "Net Battery Power"/"Net Load Power" cards - per explicit request. Sums
// power across devices AT EACH SHARED SNAPSHOT TIMESTAMP (telemetryLogger.js
// writes one `ts = Date.now()` per snapshot cycle and reuses it for every
// device logged in that cycle, so a plain GROUP BY ts here is a real,
// synchronized fleet total - not an approximation stitched together from
// independently-timed per-device peaks).
router.get("/:hubId/history/peak-today", requireAuth, (req, res) => {
  const { hubId } = req.params;
  if (!isSafeKey(hubId) || !canAccessHub(req.user, hubId)) return res.status(403).json({ error: "Forbidden" });

  const now = new Date(Date.now() + BANGKOK_OFFSET_MS);
  const dayStart = bangkokMs(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;

  const rows = db
    .prepare(
      `SELECT ts,
              SUM(COALESCE(pack_voltage, 0) * COALESCE(charge_current, 0)) AS total_power,
              SUM(COALESCE(charge_current, 0)) AS total_current
       FROM telemetry_log
       WHERE hub_id = ? AND ts >= ? AND ts < ?
       GROUP BY ts
       ORDER BY ts ASC`
    )
    .all(hubId, dayStart, dayEnd);

  let peakCharge = null;
  let peakDischarge = null;
  for (const r of rows) {
    if (r.total_power > 0 && (!peakCharge || r.total_power > peakCharge.power)) {
      peakCharge = { power: r.total_power, current: r.total_current, ts: r.ts };
    }
    if (r.total_power < 0 && (!peakDischarge || r.total_power < peakDischarge.power)) {
      peakDischarge = { power: r.total_power, current: r.total_current, ts: r.ts };
    }
  }
  res.json({ peakCharge, peakDischarge });
});

router.get("/:hubId/history/monthly", requireAuth, (req, res) => {
  const { hubId } = req.params;
  const bmsKey = req.query.bmsKey ?? "";
  const monthStr = String(req.query.month ?? ""); // "YYYY-MM"
  if (!isSafeKey(hubId) || !canAccessHub(req.user, hubId)) return res.status(403).json({ error: "Forbidden" });
  if (bmsKey && !isSafeKey(bmsKey)) return res.status(400).json({ error: "Invalid bmsKey" });

  const m = /^(\d{4})-(\d{2})$/.exec(monthStr);
  if (!m) return res.status(400).json({ error: "Invalid month" });
  const year = Number(m[1]);
  const monthIdx = Number(m[2]) - 1;
  const monthStart = bangkokMs(year, monthIdx, 1);
  const daysInMonth = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
  const monthEnd = bangkokMs(year, monthIdx, daysInMonth + 1);

  const rows = selectRange(hubId, bmsKey, monthStart, monthEnd);
  // Bucket key is the Bangkok calendar day, not whatever day the server's
  // own local TZ would derive from the raw UTC ts.
  const dayKey = (ts) => {
    const bkk = new Date(ts + BANGKOK_OFFSET_MS);
    return `${bkk.getUTCFullYear()}-${String(bkk.getUTCMonth() + 1).padStart(2, "0")}-${String(bkk.getUTCDate()).padStart(2, "0")}`;
  };
  const buckets = bucketEnergy(rows, dayKey);

  const days = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const key = `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const b = buckets.get(key) ?? emptyTotals();
    days.push({ date: key, ...b });
  }

  res.json({ month: monthStr, days });
});

router.get("/:hubId/history/yearly", requireAuth, (req, res) => {
  const { hubId } = req.params;
  const bmsKey = req.query.bmsKey ?? "";
  const yearStr = String(req.query.year ?? "");
  if (!isSafeKey(hubId) || !canAccessHub(req.user, hubId)) return res.status(403).json({ error: "Forbidden" });
  if (bmsKey && !isSafeKey(bmsKey)) return res.status(400).json({ error: "Invalid bmsKey" });

  const year = Number(yearStr);
  if (!Number.isInteger(year)) return res.status(400).json({ error: "Invalid year" });
  const yearStart = bangkokMs(year, 0, 1);
  const yearEnd = bangkokMs(year + 1, 0, 1);

  const rows = selectRange(hubId, bmsKey, yearStart, yearEnd);
  const monthKey = (ts) => {
    const bkk = new Date(ts + BANGKOK_OFFSET_MS);
    return `${bkk.getUTCFullYear()}-${String(bkk.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const buckets = bucketEnergy(rows, monthKey);

  const months = [];
  for (let mIdx = 1; mIdx <= 12; mIdx++) {
    const key = `${year}-${String(mIdx).padStart(2, "0")}`;
    const b = buckets.get(key) ?? emptyTotals();
    months.push({ month: key, ...b });
  }

  res.json({ year, months });
});

export default router;
