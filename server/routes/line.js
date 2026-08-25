import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { db } from "../db.js";
import { isLineLoginConfigured, signLinkState, verifyLinkState, buildLoginUrl, exchangeCodeForLineUserId } from "../lineAuth.js";
import { pushLineMessage } from "../lineNotify.js";

const router = Router();

// Where /callback sends the browser back to once linking succeeds/fails -
// CLIENT_ORIGIN in local dev (separate Vite port from this backend), a
// plain relative path in production (single same-origin service, see
// index.js's express.static comment - any absolute value here would just
// be extra assumption about the deployed domain that RENDER_EXTERNAL_URL
// already makes unnecessary).
function frontendReturnUrl(query) {
  const base = process.env.CLIENT_ORIGIN || "";
  return `${base}/?${new URLSearchParams(query).toString()}`;
}

// Only a 'user' session has a personal hub to link (admin sessions have no
// hubId - see hubAccess.js) - LINE alerts are a per-hub-owner feature.
function requireOwnHub(req, res) {
  if (!req.user.hubId) {
    res.status(400).json({ error: "Only a hub-owner account can link LINE" });
    return null;
  }
  return req.user.hubId;
}

router.get("/status", requireAuth, (req, res) => {
  const hubId = requireOwnHub(req, res);
  if (!hubId) return;
  const row = db.prepare(`SELECT linked_at FROM line_links WHERE hub_id = ?`).get(hubId);
  res.json({ linked: !!row, linkedAt: row?.linked_at ?? null });
});

router.get("/login-url", requireAuth, (req, res) => {
  const hubId = requireOwnHub(req, res);
  if (!hubId) return;
  if (!isLineLoginConfigured) return res.status(503).json({ error: "LINE Login not configured" });
  const state = signLinkState(hubId);
  res.json({ url: buildLoginUrl(state) });
});

// LINE redirects the user's browser here directly (a real top-level GET
// navigation, not a fetch from our own frontend) - authorization comes
// from the signed `state` param itself (minted for a specific hubId in
// /login-url above), not the session cookie, so this stays valid even if
// the cookie expired mid-flow. Always ends in a redirect back to the app,
// success or failure, never a bare JSON error - there's no frontend route
// actually rendering at this URL to show one.
router.get("/callback", async (req, res) => {
  const { code, state, error: lineError } = req.query;
  if (lineError) return res.redirect(frontendReturnUrl({ line: "error" }));

  const hubId = verifyLinkState(state);
  if (!hubId || typeof code !== "string") return res.redirect(frontendReturnUrl({ line: "error" }));

  try {
    const lineUserId = await exchangeCodeForLineUserId(code);
    db.prepare(
      `INSERT INTO line_links (hub_id, line_user_id, linked_at) VALUES (?, ?, ?)
       ON CONFLICT (hub_id) DO UPDATE SET line_user_id = excluded.line_user_id, linked_at = excluded.linked_at`
    ).run(hubId, lineUserId, Date.now());
    res.redirect(frontendReturnUrl({ line: "linked" }));
  } catch (err) {
    console.error(`LINE link callback failed for hub ${hubId}: ${err.message}`);
    res.redirect(frontendReturnUrl({ line: "error" }));
  }
});

// Lets the user confirm the whole chain (link + LINE friend-add + push
// delivery) actually works, per explicit request, instead of waiting for a
// real battery condition to happen to find out.
router.post("/test", requireAuth, async (req, res) => {
  const hubId = requireOwnHub(req, res);
  if (!hubId) return;
  const row = db.prepare(`SELECT line_user_id FROM line_links WHERE hub_id = ?`).get(hubId);
  if (!row) return res.status(400).json({ error: "ยังไม่ได้เชื่อมต่อบัญชี LINE" });
  try {
    const time = new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    await pushLineMessage(row.line_user_id, `🔔 นี่คือข้อความทดสอบจาก JK BMS Dashboard (${time})`);
    res.json({ ok: true });
  } catch (err) {
    console.error(`LINE test push failed for hub ${hubId}: ${err.message}`);
    res.status(502).json({ error: err.message || "ส่งข้อความทดสอบไม่สำเร็จ" });
  }
});

router.delete("/unlink", requireAuth, (req, res) => {
  const hubId = requireOwnHub(req, res);
  if (!hubId) return;
  db.prepare(`DELETE FROM line_links WHERE hub_id = ?`).run(hubId);
  db.prepare(`DELETE FROM line_alert_state WHERE hub_id = ?`).run(hubId);
  res.json({ ok: true });
});

export default router;
