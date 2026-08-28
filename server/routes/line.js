import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireFirebase } from "../middleware/requireFirebase.js";
import { db } from "../db.js";
import { readPath, writePath } from "../firebaseRead.js";
import { isLineLoginConfigured, signLinkState, verifyLinkState, buildLoginUrl, exchangeCodeForLineUserId } from "../lineAuth.js";
import { pushLineMessage, replyLineMessage, getBotInfo, verifyWebhookSignature, isWebhookConfigured } from "../lineNotify.js";
import { computeFleetSummary, isFleetCountable, nowTimeLabel } from "../lineAlertWatchdog.js";

const router = Router();

// The LINE link itself now lives in Firebase, NOT the local SQLite db
// (unlike line_alert_state, which stays there) - per explicit report: every
// git push triggers a Render redeploy, and Render's free tier disk is
// ephemeral (re-cloned fresh on every deploy, same reason gitStorage.js
// exists for firmware files - see its own comment), so a SQLite-only link
// was getting silently wiped on every single deploy, forcing a full
// LINE-reconnect each time. Firebase is this app's one genuinely durable
// store, already used the same way for other per-hub account data
// (location, admin.enabled) - stored as JK_BMS_HUB/{hubId}/line_link, a
// sibling of the BMS device keys (same placement location already uses),
// so isBmsDevice()'s {status,settings} shape check safely ignores it
// everywhere device-discovery walks the hub tree.
function lineLinkPath(hubId) {
  return `JK_BMS_HUB/${hubId}/line_link`;
}

// Per-hub notification checklist (select all / remind 1h / remind 2h /
// weather / step 10% / step 20% - see lineAlertWatchdog.js's normalizePrefs
// for how these combine), same durable Firebase placement as line_link
// above and for the same reason.
function linePrefsPath(hubId) {
  return `JK_BMS_HUB/${hubId}/line_prefs`;
}
const PREFS_BOOL_KEYS = ["remind2h", "remind3h", "step10", "step20", "weatherEnabled"];

// Strict 1-account-to-1-LINE in BOTH directions (per explicit request) - a
// real LINE account must never end up receiving another hub's BMS alerts.
// Scans the whole hub tree for any OTHER hub whose line_link.lineUserId
// matches, same cost class as chargeWatchdog.js's own whole-tree read, but
// only run once per actual link event (not every poll cycle).
async function detachOtherHubsLinkedTo(lineUserId, exceptHubId) {
  const hubs = await readPath("JK_BMS_HUB");
  if (!hubs || typeof hubs !== "object") return;
  for (const [otherHubId, hubData] of Object.entries(hubs)) {
    if (otherHubId === exceptHubId) continue;
    if (hubData?.line_link?.lineUserId === lineUserId) {
      await writePath(lineLinkPath(otherHubId), null);
    }
  }
}

// Reverse of the forward lookup everywhere else in this file (hubId ->
// link) - the webhook below only ever gets the SENDER's lineUserId from
// LINE, so it has to find which hub (if any) that real person is linked to.
// Same whole-tree-scan cost class as detachOtherHubsLinkedTo above, and
// only run per incoming message, not per poll cycle.
async function findHubByLineUserId(lineUserId) {
  const hubs = await readPath("JK_BMS_HUB");
  if (!hubs || typeof hubs !== "object") return null;
  for (const [hubId, hubData] of Object.entries(hubs)) {
    if (hubData?.line_link?.lineUserId === lineUserId) return { hubId, hubData };
  }
  return null;
}

// The on-demand counterpart to lineAlertWatchdog.js's automatic fleet
// average - built from the exact same computeFleetSummary formula so the
// numbers always agree with what the automatic alerts already said.
function buildStatusReply(hubData) {
  const devices = Object.values(hubData).filter(isFleetCountable);
  if (devices.length === 0) return "ยังไม่พบข้อมูลอุปกรณ์ BMS ในระบบ";
  const { soc, remainingAh, capacityAh, current, voltage } = computeFleetSummary(devices);
  if (soc === null) return "ยังไม่พบข้อมูลอุปกรณ์ BMS ในระบบ";
  const currentLabel = current > 0 ? `+${current.toFixed(1)}` : current.toFixed(1);
  return (
    `🔋 สถานะแบตปัจจุบัน\n` +
    `SOC: ${soc.toFixed(0)}% (${remainingAh.toFixed(1)}/${capacityAh.toFixed(1)}Ah)\n` +
    `แรงดัน: ${voltage.toFixed(2)}V\n` +
    `กระแส: ${currentLabel}A\n` +
    `(${nowTimeLabel()})`
  );
}

// LINE POSTs every incoming message/follow/etc event here - requires a
// Webhook URL configured in the Messaging API channel's console settings
// (https://<this app's deployed URL>/api/line/webhook) and
// LINE_MESSAGING_CHANNEL_SECRET set (see lineNotify.js's comment on why
// that's a different value from LINE_LOGIN_CHANNEL_SECRET). No requireAuth
// here - LINE calls this directly, not a logged-in browser session;
// verifyWebhookSignature is what proves the request is genuinely from LINE
// instead of a session cookie. Only handles plain text messages - any other
// event type (follow, sticker, image, ...) is acknowledged (200) and
// otherwise ignored, per explicit scope: an on-demand status check, not a
// general chatbot.
router.post("/webhook", async (req, res) => {
  if (!isWebhookConfigured) return res.status(503).end();
  const signature = req.get("X-Line-Signature");
  if (!req.rawBody || !verifyWebhookSignature(req.rawBody, signature)) {
    return res.status(401).end();
  }
  // Ack immediately - LINE expects a fast 200 and doesn't wait on the
  // reply itself (that goes out as its own separate API call below), so
  // there's no reason to make LINE's webhook delivery wait on a Firebase
  // read + reply push.
  res.status(200).end();

  const events = Array.isArray(req.body?.events) ? req.body.events : [];
  for (const event of events) {
    if (event.type !== "message" || event.message?.type !== "text") continue;
    const replyToken = event.replyToken;
    const senderId = event.source?.userId;
    if (!replyToken || !senderId) continue;

    try {
      const found = await findHubByLineUserId(senderId);
      const text = found ? buildStatusReply(found.hubData) : "บัญชีนี้ยังไม่ได้เชื่อมต่อกับระบบ กรุณาเชื่อมต่อผ่านเว็บ JK BMS Dashboard ก่อน";
      await replyLineMessage(replyToken, text);
    } catch (err) {
      console.error(`LINE webhook reply failed: ${err.message}`);
    }
  }
});

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

router.get("/status", requireAuth, async (req, res) => {
  const hubId = requireOwnHub(req, res);
  if (!hubId) return;
  try {
    const link = await readPath(lineLinkPath(hubId));
    res.json({ linked: !!link, linkedAt: link?.linkedAt ?? null });
  } catch (err) {
    console.error(`GET /api/line/status failed for hub ${hubId}: ${err.message}`);
    res.status(503).json({ error: "Could not read LINE link status" });
  }
});

// Lets the frontend show a direct "add friend" link instead of making the
// user search for the Official Account manually - see lineNotify.js's
// getBotInfo comment for why this is needed at all (a completed OAuth link
// alone doesn't guarantee messages will actually deliver).
router.get("/bot-info", requireAuth, async (req, res) => {
  try {
    const info = await getBotInfo();
    if (!info.basicId) return res.status(503).json({ error: "Bot info unavailable" });
    res.json({ addFriendUrl: `https://line.me/R/ti/p/${info.basicId}`, pictureUrl: info.pictureUrl, displayName: info.displayName });
  } catch (err) {
    console.error(`GET /api/line/bot-info failed: ${err.message}`);
    res.status(503).json({ error: "Could not load LINE bot info" });
  }
});

router.get("/prefs", requireAuth, async (req, res) => {
  const hubId = requireOwnHub(req, res);
  if (!hubId) return;
  try {
    const prefs = await readPath(linePrefsPath(hubId));
    res.json(prefs && typeof prefs === "object" ? prefs : {});
  } catch (err) {
    console.error(`GET /api/line/prefs failed for hub ${hubId}: ${err.message}`);
    res.status(503).json({ error: "Could not read LINE notification preferences" });
  }
});

router.put("/prefs", requireAuth, async (req, res) => {
  const hubId = requireOwnHub(req, res);
  if (!hubId) return;
  // Only ever write the known keys, each coerced to its own real type -
  // never trust arbitrary request body shape straight into Firebase.
  const prefs = {};
  for (const key of PREFS_BOOL_KEYS) prefs[key] = !!req.body?.[key];
  const wattLimit = Number(req.body?.wattLimit);
  prefs.wattLimit = Number.isFinite(wattLimit) && wattLimit > 0 ? wattLimit : 0;
  const chargeAmpLimit = Number(req.body?.chargeAmpLimit);
  prefs.chargeAmpLimit = Number.isFinite(chargeAmpLimit) && chargeAmpLimit > 0 ? chargeAmpLimit : 0;
  try {
    await writePath(linePrefsPath(hubId), prefs);
    res.json({ ok: true, prefs });
  } catch (err) {
    console.error(`PUT /api/line/prefs failed for hub ${hubId}: ${err.message}`);
    res.status(503).json({ error: "Could not save LINE notification preferences" });
  }
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
    // Detaching any other hub's link to this exact lineUserId first makes
    // linking here effectively a MOVE, not an ADD - only the most recent
    // hub this LINE account was linked to ever receives its alerts.
    await detachOtherHubsLinkedTo(lineUserId, hubId);
    await writePath(lineLinkPath(hubId), { lineUserId, linkedAt: Date.now() });
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
  try {
    const link = await readPath(lineLinkPath(hubId));
    if (!link?.lineUserId) return res.status(400).json({ error: "ยังไม่ได้เชื่อมต่อบัญชี LINE" });
    // timeZone required - see lineAlertWatchdog.js's nowTimeLabel comment
    // for why (server runs in UTC, not Bangkok, without it).
    const time = new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Bangkok" });
    await pushLineMessage(link.lineUserId, `🔔 นี่คือข้อความทดสอบจาก JK BMS Dashboard (${time})`);
    res.json({ ok: true });
  } catch (err) {
    console.error(`LINE test push failed for hub ${hubId}: ${err.message}`);
    res.status(502).json({ error: err.message || "ส่งข้อความทดสอบไม่สำเร็จ" });
  }
});

router.delete("/unlink", requireAuth, requireFirebase, async (req, res) => {
  const hubId = requireOwnHub(req, res);
  if (!hubId) return;
  try {
    await writePath(lineLinkPath(hubId), null);
    // line_alert_state (the per-condition edge-trigger dedup) stays in
    // SQLite - unlike the link itself, losing this on redeploy is
    // harmless self-healing (worst case: one duplicate notification for
    // whatever's already breached right after a deploy), so it wasn't
    // worth the same Firebase migration.
    db.prepare(`DELETE FROM line_alert_state WHERE hub_id = ?`).run(hubId);
    res.json({ ok: true });
  } catch (err) {
    console.error(`DELETE /api/line/unlink failed for hub ${hubId}: ${err.message}`);
    res.status(503).json({ error: "Could not unlink LINE account" });
  }
});

export default router;
