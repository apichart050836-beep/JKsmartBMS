import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireFirebase } from "../middleware/requireFirebase.js";
import { allowedHubIds, canAccessHub } from "../hubAccess.js";
import { readPath, writePath } from "../firebaseRead.js";

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
    res.json({ ok: true });
  } catch (err) {
    console.error(`PATCH /api/hubs/${hubId}/settings failed: ${err.message}`);
    res.status(503).json({ error: "Could not save setting" });
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
