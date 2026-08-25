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
-- persistent disk. This table alone only powers the web dashboard's "latest
-- published" notification badge - the real per-device OTA signal is a
-- Firebase write (see routes/firmware.js), not anything here. md5 is a
-- fresh MD5 of that upload's exact bytes, computed once at upload time and
-- carried along into the same Firebase write, for the ESP32 side to verify
-- the download before flashing.
CREATE TABLE IF NOT EXISTS firmware_releases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  version     TEXT NOT NULL,
  filename    TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  data        BLOB NOT NULL,
  md5         TEXT,
  uploaded_by TEXT NOT NULL,
  uploaded_at INTEGER NOT NULL
);

-- The user's own last deliberate Charge Switch command, per device -
-- written by PATCH /:hubId/settings (see routes/hubs.js) whenever the
-- "charge" key is saved. server/chargeWatchdog.js reads this to tell "the
-- user themselves turned it off" (respect it, never touch) apart from
-- "it's off with no known user command behind it" (a firmware reboot
-- echoing its real MOSFET state into the same settings/charge field,
-- confirmed as a real failure mode earlier - see BMSDashboard.jsx's
-- write-guard comments) - only the latter gets auto-corrected back on.
CREATE TABLE IF NOT EXISTS charge_switch_intent (
  hub_id         TEXT NOT NULL,
  bms_key        TEXT NOT NULL DEFAULT '',
  desired_charge INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (hub_id, bms_key)
);

-- Same idea as charge_switch_intent above, for the Balancer Switch
-- (explicit request, 2026-08-01) - kept as its own table rather than a
-- second column on charge_switch_intent so each switch's intent history
-- stays independent (a user turning charge off deliberately says nothing
-- about what they want the balancer to do, and vice versa).
CREATE TABLE IF NOT EXISTS balancer_switch_intent (
  hub_id           TEXT NOT NULL,
  bms_key          TEXT NOT NULL DEFAULT '',
  desired_balancer INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  PRIMARY KEY (hub_id, bms_key)
);

-- Temporary web-side safety net for a known ESP32 firmware bug (explicit
-- request, 2026-08-01): until the fixed firmware is actually flashed, the
-- device can still overwrite settings/my_custom_name with its own raw MAC
-- address on boot/BLE-reconnect. Unlike charge/balancer, this isn't "the
-- user's last command" - it's just "the last name we saw that wasn't a MAC
-- address", refreshed automatically by chargeWatchdog.js every time a real
-- name is observed, and written back whenever the name reverts to a MAC.
-- Safe to remove once every board is running the fixed firmware, at which
-- point the bug this works around can't happen anymore.
CREATE TABLE IF NOT EXISTS custom_name_intent (
  hub_id     TEXT NOT NULL,
  bms_key    TEXT NOT NULL DEFAULT '',
  name       TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (hub_id, bms_key)
);

-- Self-service signup requests awaiting admin approval (explicit request,
-- 2026-08-01): a brand-new email + the correct shared password lands here
-- instead of immediately getting a Firebase hub - see POST /api/auth/login.
-- Cleared by DELETE the moment an admin approves it (routes/admin.js),
-- since at that point the real signal of "approved" becomes "the hub node
-- now exists in Firebase" and this row has no further purpose. Same
-- ephemeral-disk caveat as every other table here (see firmware_releases'
-- comment above) - a pending row can be lost on redeploy if DB_PATH isn't
-- pointed at a real persistent disk; the requester would just need to
-- submit the request again.
CREATE TABLE IF NOT EXISTS pending_signups (
  email        TEXT PRIMARY KEY,
  requested_at INTEGER NOT NULL
);

-- Personal LINE push notifications (explicit request) - one row per hub
-- (a 'user' session owns exactly one hub, see hubAccess.js), linking it to
-- the LINE userId obtained via LINE Login OAuth (server/lineAuth.js). This
-- is what lineAlertWatchdog.js reads to know who to push to; a hub with no
-- row here just never gets checked/notified.
CREATE TABLE IF NOT EXISTS line_links (
  hub_id      TEXT PRIMARY KEY,
  line_user_id TEXT NOT NULL,
  linked_at   INTEGER NOT NULL
);

-- Edge-trigger state for each (hub, device, condition) the watchdog
-- checks (cell imbalance, SOC thresholds, charge/discharge current
-- thresholds - see lineAlertWatchdog.js's CONDITIONS list). `active=1`
-- means "already notified for this ongoing breach" - the watchdog only
-- pushes a message on the 0->1 transition, so a condition that stays
-- breached for hours doesn't spam a message every poll. It resets back to
-- 0 (and can fire again) once the underlying reading recovers below the
-- threshold.
CREATE TABLE IF NOT EXISTS line_alert_state (
  hub_id       TEXT NOT NULL,
  bms_key      TEXT NOT NULL DEFAULT '',
  condition_id TEXT NOT NULL,
  active       INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (hub_id, bms_key, condition_id)
);
