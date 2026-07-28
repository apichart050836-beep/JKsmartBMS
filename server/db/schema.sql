-- Re-runnable: every statement is idempotent (IF NOT EXISTS), safe to run
-- against a database that already has data - never drops or truncates
-- anything.

-- Admin accounts only now - 'user'-role logins authenticate against each
-- hub's own JK_BMS_HUB/{hub_id}/userCong node in Firebase instead (the
-- pre-existing credential store the original system already writes to),
-- not a SQL row. See routes/auth.js.
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'user')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Periodic snapshots of live telemetry, written by server/telemetryLogger.js
-- every SNAPSHOT_INTERVAL_MS. Firebase itself never stores history (only the
-- current-moment status node), so Daily/Monthly/Yearly charts and the
-- Charge/Discharge Ah totals are derived entirely from this table -
-- capacity_remain is the BMS's own coulomb counter, so charged/discharged Ah
-- per period comes from summing its deltas rather than integrating current
-- (there is no discharge-current magnitude field anywhere in Firebase, only
-- a charge_current value and a discharge on/off boolean).
CREATE TABLE IF NOT EXISTS telemetry_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  hub_id          TEXT NOT NULL,
  bms_key         TEXT NOT NULL DEFAULT '',
  ts              INTEGER NOT NULL,
  pack_voltage    REAL,
  charge_current  REAL,
  capacity_remain REAL,
  percent_remain  REAL
);
CREATE INDEX IF NOT EXISTS idx_telemetry_log_lookup ON telemetry_log (hub_id, bms_key, ts);

-- Admin broadcast messages ("แจ้ง Update") - pushed live over Socket.IO to
-- every connected user-role session (see realtime.js's "role:user" room),
-- and also persisted here so a dashboard that loads shortly after a
-- broadcast (rather than being open live at send-time) still catches it -
-- see GET /api/announcements/latest.
CREATE TABLE IF NOT EXISTS announcements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  message    TEXT NOT NULL,
  category   TEXT,
  created_at INTEGER NOT NULL
);

-- ESP32 firmware .bin files an admin has published from Admin Monitor's
-- "Firmware Update" panel - stored as a BLOB here rather than a bare file
-- on disk, same tradeoff telemetry_log already makes (see db.js's comment
-- on Render's Free-tier disk being ephemeral): this table doesn't survive
-- a redeploy/restart either unless DB_PATH points at a real attached
-- persistent disk. Pressing "Update" on the dashboard (see server/routes/
-- firmware.js) is acknowledge-only - nothing here ever gets pushed to a
-- physical ESP32, there's no OTA transport in this app.
CREATE TABLE IF NOT EXISTS firmware_releases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  version     TEXT NOT NULL,
  filename    TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  data        BLOB NOT NULL,
  uploaded_by TEXT NOT NULL,
  uploaded_at INTEGER NOT NULL
);
