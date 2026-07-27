import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRole } from "../middleware/requireRole.js";
import { requireFirebase } from "../middleware/requireFirebase.js";
import { writePath } from "../firebaseRead.js";

const router = Router();
router.use(requireAuth, requireRole("admin"), requireFirebase);

// Firebase RTDB keys can't contain '.', '#', '$', '[', ']', or '/' - reject
// anything with a literal slash here so hubId/bmsKey can't be used to escape
// the JK_BMS_HUB/... path this router is scoped to.
function isSafeKey(k) {
  return typeof k === "string" && k.length > 0 && !/[./#$\[\]]/.test(k);
}

function devicePath(hubId, bmsKey) {
  return bmsKey ? `JK_BMS_HUB/${hubId}/${bmsKey}` : `JK_BMS_HUB/${hubId}`;
}

// Same two writes AdminMonitor's EnabledToggle/ExpirationCell used to make
// straight to Firebase from the browser - now behind requireRole('admin')
// so a non-admin session token can never reach them, no matter what the
// frontend does or doesn't render.
router.patch("/hub-device/enabled", async (req, res) => {
  const { hubId, bmsKey, enabled } = req.body ?? {};
  if (!isSafeKey(hubId) || (bmsKey !== undefined && !isSafeKey(bmsKey)) || typeof enabled !== "boolean") {
    return res.status(400).json({ error: "Invalid request" });
  }
  try {
    await writePath(`${devicePath(hubId, bmsKey)}/admin/enabled`, enabled);
    res.json({ ok: true });
  } catch (err) {
    console.error(`PATCH /api/admin/hub-device/enabled failed: ${err.message}`);
    res.status(503).json({ error: "Could not save setting" });
  }
});

router.patch("/hub-device/expiration", async (req, res) => {
  const { hubId, bmsKey, expirationDate } = req.body ?? {};
  if (!isSafeKey(hubId) || (bmsKey !== undefined && !isSafeKey(bmsKey))) {
    return res.status(400).json({ error: "Invalid request" });
  }
  try {
    await writePath(`${devicePath(hubId, bmsKey)}/admin/expirationDate`, expirationDate || null);
    res.json({ ok: true });
  } catch (err) {
    console.error(`PATCH /api/admin/hub-device/expiration failed: ${err.message}`);
    res.status(503).json({ error: "Could not save setting" });
  }
});

export default router;
