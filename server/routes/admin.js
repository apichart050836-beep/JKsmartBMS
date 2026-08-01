import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRole } from "../middleware/requireRole.js";
import { requireFirebase } from "../middleware/requireFirebase.js";
import { writePath } from "../firebaseRead.js";
import { db } from "../db.js";
import { emailToHubId } from "../emailToHubId.js";

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

// New self-service sign-ups (routes/auth.js's /login) waiting for an admin
// to let them in - see pending_signups in schema.sql.
router.get("/pending-signups", (_req, res) => {
  const rows = db.prepare(`SELECT email, requested_at AS requestedAt FROM pending_signups ORDER BY requested_at ASC`).all();
  res.json({ pending: rows });
});

// Approving is the moment the real Firebase hub actually gets created -
// same minimal `admin` marker shape auth.js's original self-provisioning
// draft used, kept here since creation now only ever happens through this
// explicit admin action. Removes the pending row after a successful write
// so it isn't shown (or approvable again) twice; if the write fails the row
// is deliberately left in place so the admin can just retry.
router.post("/pending-signups/:email/approve", async (req, res) => {
  const email = String(req.params.email || "").trim();
  const row = db.prepare(`SELECT email FROM pending_signups WHERE email = ?`).get(email);
  if (!row) return res.status(404).json({ error: "No pending request for this email" });

  try {
    const hubId = emailToHubId(email);
    await writePath(`JK_BMS_HUB/${hubId}/admin`, { enabled: true, createdAt: Date.now() });
    db.prepare(`DELETE FROM pending_signups WHERE email = ?`).run(email);
    res.json({ ok: true });
  } catch (err) {
    console.error(`POST /api/admin/pending-signups/${email}/approve failed: ${err.message}`);
    res.status(503).json({ error: "Could not approve request" });
  }
});

// Dismiss a request without creating a hub for it (spam, typo, no longer
// wanted) - purely local, no Firebase write to undo.
router.delete("/pending-signups/:email", (req, res) => {
  const email = String(req.params.email || "").trim();
  db.prepare(`DELETE FROM pending_signups WHERE email = ?`).run(email);
  res.json({ ok: true });
});

export default router;
