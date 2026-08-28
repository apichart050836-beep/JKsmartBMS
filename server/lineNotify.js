import "dotenv/config";
import { createHmac, timingSafeEqual } from "node:crypto";

// Personal LINE push notifications (explicit request) - sends a message
// straight to one LINE userId via the Messaging API's push endpoint. This
// is the "1-to-1" delivery half; server/lineAuth.js is how a hub's owner
// links their LINE account (OAuth) so lineAlertWatchdog.js has a userId to
// push to in the first place.
//
// Note: "LINE Notify" (the old single-token webhook service) was
// discontinued by LINE in 2025 - this uses the current Messaging API
// instead, which needs its own LINE Official Account + Channel Access
// Token from the LINE Developers Console (see .env.example for setup).
const CHANNEL_ACCESS_TOKEN = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
// Only needed for the webhook (routes/line.js's /webhook, added 2026-08-26
// for the on-demand "เช็คสถานะ" reply feature) - this is the Messaging API
// channel's OWN Channel Secret (Basic Settings tab), a DIFFERENT value from
// LINE_LOGIN_CHANNEL_SECRET (that one's for the separate LINE Login
// channel's OAuth token exchange - see lineAuth.js). Used to verify an
// incoming webhook request really came from LINE, not to call any LINE API.
const MESSAGING_CHANNEL_SECRET = process.env.LINE_MESSAGING_CHANNEL_SECRET;

export const isLineMessagingConfigured = !!CHANNEL_ACCESS_TOKEN;
export const isWebhookConfigured = !!MESSAGING_CHANNEL_SECRET;

if (!isLineMessagingConfigured) {
  console.warn(
    "\nLINE Messaging API not configured (LINE_MESSAGING_CHANNEL_ACCESS_TOKEN missing from server/.env)\n" +
      "LINE alert push notifications will silently no-op until this is set.\n"
  );
}

// Tappable buttons shown above the user's keyboard, attached to a message -
// shared by pushLineMessage AND replyLineMessage below (both default to
// showing these) so the "just tap it" shortcuts are available after EITHER
// an automatic alert or an on-demand reply, not just one of the two. Per
// explicit follow-up (2026-08-26): Quick Reply buttons only ever appear on
// the specific message they're attached to and vanish once the user does
// anything else - there's no way to make them permanently visible without a
// Rich Menu (a whole separate LINE feature needing an uploaded image +
// console setup), so defaulting BOTH send paths to always include these is
// the simplest way to make a button available as often as possible. Each
// tap just SENDS the button's own text back through the webhook exactly as
// if typed, re-triggering routes/line.js's matching reply - see that file's
// buildStatusReply/buildWeatherReply/buildTempReply.
export const QUICK_REPLY_ITEMS = [
  { type: "action", action: { type: "message", label: "🔄 เช็คสถานะ", text: "เช็คสถานะ" } },
  { type: "action", action: { type: "message", label: "☀️ เช็คสภาพอากาศ", text: "เช็คสภาพอากาศ" } },
  // LINE caps quick-reply "label" (what shows on the button) at 20
  // characters - "เช็คเซ็นเซอร์วัดอุณหภูมิ" alone is 24, so the full phrase
  // only fits in "text" (the 300-char field actually sent/matched on tap,
  // see routes/line.js's webhook), shortened just for the visible label.
  { type: "action", action: { type: "message", label: "🌡️ เช็คอุณหภูมิ", text: "เช็คเซ็นเซอร์วัดอุณหภูมิ" } },
];

// Resolves once LINE has accepted the message. Callers should treat a
// rejected promise as "this specific user did not get this message" (e.g.
// they unfriended the bot) - never fatal to the watchdog cycle around it.
// Pass quickReplyItems: null to send a plain message with no buttons (used
// where there's nothing meaningful to tap yet).
export async function pushLineMessage(lineUserId, text, quickReplyItems = QUICK_REPLY_ITEMS) {
  if (!isLineMessagingConfigured) throw new Error("LINE Messaging API not configured");
  const message = { type: "text", text };
  if (quickReplyItems?.length) message.quickReply = { items: quickReplyItems };
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      to: lineUserId,
      messages: [message],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LINE push failed (${res.status}): ${body.slice(0, 300)}`);
  }
}

// Free counterpart to pushLineMessage above - only usable within a few
// minutes of, and only in direct response to, one specific incoming webhook
// event (the replyToken LINE hands over with that event, single-use, short
// TTL) - can never be used to send a spontaneous/scheduled message like the
// automatic battery alerts do, only to answer something the user just sent.
// See routes/line.js's /webhook for the "เช็คสถานะ" on-demand feature this
// exists for.
export async function replyLineMessage(replyToken, text, quickReplyItems = QUICK_REPLY_ITEMS) {
  if (!isLineMessagingConfigured) throw new Error("LINE Messaging API not configured");
  const message = { type: "text", text };
  if (quickReplyItems?.length) message.quickReply = { items: quickReplyItems };
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [message],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LINE reply failed (${res.status}): ${body.slice(0, 300)}`);
  }
}

// LINE signs every webhook POST with HMAC-SHA256 of the raw request body,
// keyed by the Messaging API channel's Channel Secret, sent as base64 in
// the X-Line-Signature header - verifying this is the only way to know a
// webhook call genuinely came from LINE and not e.g. a stranger POSTing to
// a guessed URL and spoofing arbitrary lineUserIds to read someone else's
// battery status. timingSafeEqual (not === ) so comparing the signature
// can't leak timing info about how much of it matched.
export function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!isWebhookConfigured || !signatureHeader) return false;
  const expected = createHmac("sha256", MESSAGING_CHANNEL_SECRET).update(rawBody).digest("base64");
  const expectedBuf = Buffer.from(expected);
  const givenBuf = Buffer.from(signatureHeader);
  if (expectedBuf.length !== givenBuf.length) return false;
  return timingSafeEqual(expectedBuf, givenBuf);
}

// Confirmed real-world failure mode (2026-08-26): a user can complete the
// LINE Login OAuth link just fine, and pushLineMessage above can even
// resolve successfully, while LINE still silently never delivers anything -
// because that specific LINE account never added this Official Account as a
// friend. LINE has no way to detect/reject that at push time in every case,
// so the actual fix is giving users a direct "Add friend" link instead of
// making them search for the bot manually. The Basic ID (e.g. "@abc1234")
// needed for that link isn't derivable from the Channel Access Token or any
// other env var - it has to come from LINE's own "get bot info" endpoint,
// authenticated with the SAME token this file already has, so no new secret
// is needed. Cached in memory since a channel's Basic ID never changes.
let cachedBotInfo = null;
export async function getBotInfo() {
  if (cachedBotInfo) return cachedBotInfo;
  if (!isLineMessagingConfigured) throw new Error("LINE Messaging API not configured");
  const res = await fetch("https://api.line.me/v2/bot/info", {
    headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LINE bot info fetch failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  cachedBotInfo = {
    basicId: data.basicId ?? null,
    pictureUrl: data.pictureUrl ?? null,
    displayName: data.displayName ?? null,
  };
  return cachedBotInfo;
}
