import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireFirebase } from "../middleware/requireFirebase.js";
import { allowedHubIds, canAccessHub } from "../hubAccess.js";
import { readPath, writePath } from "../firebaseRead.js";
import { isMqttConfigured, publishOtaCommand } from "../mqttClient.js";
import { db } from "../db.js";

const router = Router();

function isSafeKey(k) {
  return typeof k === "string" && k.length > 0 && !/[./#$\[\]]/.test(k);
}

function devicePath(hubId, bmsKey) {
  return bmsKey ? `JK_BMS_HUB/${hubId}/${bmsKey}` : `JK_BMS_HUB/${hubId}`;
}

// One-shot snapshot (Socket.IO in realtime.js handles live updates) - role
// filtering happens here at the read itself: a non-admin's Firebase reads
// only ever touch the specific hub_id paths their account is linked to,
// never the full JK_BMS_HUB root. Read-only, so this uses readPath (falls
// back to public REST if the privileged Admin SDK key isn't set up yet) -
// unlike the writes below, which always require the real key.
router.get("/", requireAuth, async (req, res) => {
  const allowed = allowedHubIds(req.user);

  try {
    if (allowed === null) {
      const val = await readPath("JK_BMS_HUB");
      return res.json({ hubs: val ?? {} });
    }

    const hubs = {};
    for (const hubId of allowed) {
      const val = await readPath(`JK_BMS_HUB/${hubId}`);
      if (val != null) hubs[hubId] = val;
    }
    res.json({ hubs });
  } catch (err) {
    // readPath now times out instead of hanging forever, but Express 4
    // still won't forward a rejected async handler to error middleware on
    // its own - without this the request would just hang until the client
    // gives up, exactly like the login hang this was modeled on.
    console.error(`GET /api/hubs failed: ${err.message}`);
    res.status(503).json({ error: "Could not read hub data" });
  }
});

// Configuration panel writes (Charge/Discharge/Balancer/etc settings, device
// name) - any authenticated session may use these for a hub it owns; admin
// owns everything, a 'user' role must own that exact hub. This is what
// BMSDashboard.jsx's saveSetting/saveDeviceName call instead of writing to
// Firebase directly from the browser. Always requires the real Admin SDK
// key - writePath() falls back to an authenticated REST PUT if the Admin
// SDK's own write hangs, but never to an anonymous/public write.
router.patch("/:hubId/settings", requireAuth, requireFirebase, async (req, res) => {
  const { hubId } = req.params;
  const { bmsKey, key, value } = req.body ?? {};
  if (!isSafeKey(hubId) || !canAccessHub(req.user, hubId)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if ((bmsKey !== undefined && bmsKey !== null && !isSafeKey(bmsKey)) || !isSafeKey(key)) {
    return res.status(400).json({ error: "Invalid request" });
  }
  try {
    await writePath(`${devicePath(hubId, bmsKey)}/settings/${key}`, value);
    // Records the user's own deliberate Charge/Balancer Switch command so
    // chargeWatchdog.js can tell "the user turned it off" apart from "it's
    // off with no known command behind it" (see schema.sql's comments on
    // these two tables) - only relevant for these two keys, every other
    // setting just writes through as before.
    if (key === "charge") {
      db.prepare(
        `INSERT INTO charge_switch_intent (hub_id, bms_key, desired_charge, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (hub_id, bms_key) DO UPDATE SET desired_charge = excluded.desired_charge, updated_at = excluded.updated_at`
      ).run(hubId, bmsKey ?? "", value ? 1 : 0, Date.now());
    } else if (key === "balancer") {
      db.prepare(
        `INSERT INTO balancer_switch_intent (hub_id, bms_key, desired_balancer, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (hub_id, bms_key) DO UPDATE SET desired_balancer = excluded.desired_balancer, updated_at = excluded.updated_at`
      ).run(hubId, bmsKey ?? "", value ? 1 : 0, Date.now());
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(`PATCH /api/hubs/${hubId}/settings failed: ${err.message}`);
    res.status(503).json({ error: "Could not save setting" });
  }
});

// BMS/solar installation's fixed physical location - one per hub (account),
// NOT per BMS device and NOT the viewer's own device GPS. Written once from
// the Installation Location setup modal (or Settings > Change Installation
// Location), then read back as part of the normal hub tree every session/
// device that opens this dashboard - see useWeatherLocation.js. Stored at
// the hub root (sibling of each BMS device key, not nested under one),
// since bmsShape.js's isBmsShaped() only matches {status,settings} or
// {status:string}/{expire_date} shapes, this key is safely ignored by every
// device-discovery walk (flattenHubs/useHubDevices/useAdminHubs) instead of
// being mistaken for an extra BMS tab.
router.patch("/:hubId/location", requireAuth, requireFirebase, async (req, res) => {
  const { hubId } = req.params;
  const { name, lat, lng } = req.body ?? {};
  if (!isSafeKey(hubId) || !canAccessHub(req.user, hubId)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (typeof name !== "string" || !name.trim() || typeof lat !== "number" || typeof lng !== "number") {
    return res.status(400).json({ error: "Invalid request" });
  }
  try {
    await writePath(`JK_BMS_HUB/${hubId}/location`, { name: name.trim(), lat, lng, updatedAt: Date.now() });
    res.json({ ok: true });
  } catch (err) {
    console.error(`PATCH /api/hubs/${hubId}/location failed: ${err.message}`);
    res.status(503).json({ error: "Could not save location" });
  }
});

// Real OTA trigger - re-PUBLISHES this device's last-targeted firmware
// command to its own MQTT topic (server/mqttClient.js), read back from
// firmware_targets (written by the admin's upload panel, see
// server/routes/firmware.js - see that table's schema.sql comment for why
// this lookup exists instead of just re-sending update_flag=true: MQTT has
// no "current value" a device can poll, unlike the Firebase node this
// replaced). The ESP32's own firmware subscribes to that topic and
// self-flashes on arrival; the server never talks to the device directly.
// Any session that owns this hub may call it (not admin-only) since it's
// the "user presses the Update button on their own dashboard" flow.
router.patch("/:hubId/firmware/trigger-update", requireAuth, async (req, res) => {
  const { hubId } = req.params;
  const { bmsKey } = req.body ?? {};
  if (!isSafeKey(hubId) || !canAccessHub(req.user, hubId)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (bmsKey !== undefined && bmsKey !== null && !isSafeKey(bmsKey)) {
    return res.status(400).json({ error: "Invalid request" });
  }
  if (!isMqttConfigured) {
    return res.status(503).json({ error: "MQTT not configured" });
  }
  const bmsKeyNorm = bmsKey ?? "";
  const target = db
    .prepare(`SELECT latest_version, url, uploaded_at FROM firmware_targets WHERE hub_id = ? AND bms_key = ?`)
    .get(hubId, bmsKeyNorm);
  if (!target) {
    return res.status(404).json({ error: "No firmware has been published to this device yet" });
  }
  try {
    const mac = bmsKeyNorm || hubId;
    await publishOtaCommand(hubId, mac, {
      latest_version: target.latest_version,
      update_flag: true,
      uploaded_at: target.uploaded_at,
      url: target.url,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(`PATCH /api/hubs/${hubId}/firmware/trigger-update failed: ${err.message}`);
    res.status(503).json({ error: "Could not trigger update" });
  }
});

router.patch("/:hubId/device-name", requireAuth, requireFirebase, async (req, res) => {
  const { hubId } = req.params;
  const { bmsKey, name } = req.body ?? {};
  if (!isSafeKey(hubId) || !canAccessHub(req.user, hubId)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (bmsKey !== undefined && bmsKey !== null && !isSafeKey(bmsKey)) {
    return res.status(400).json({ error: "Invalid request" });
  }
  try {
    await writePath(`${devicePath(hubId, bmsKey)}/info/my_bms_custom_name`, name);
    res.json({ ok: true });
  } catch (err) {
    console.error(`PATCH /api/hubs/${hubId}/device-name failed: ${err.message}`);
    res.status(503).json({ error: "Could not save device name" });
  }
});

export default router;
