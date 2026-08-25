import "dotenv/config";

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

export const isLineMessagingConfigured = !!CHANNEL_ACCESS_TOKEN;

if (!isLineMessagingConfigured) {
  console.warn(
    "\nLINE Messaging API not configured (LINE_MESSAGING_CHANNEL_ACCESS_TOKEN missing from server/.env)\n" +
      "LINE alert push notifications will silently no-op until this is set.\n"
  );
}

// Resolves once LINE has accepted the message. Callers should treat a
// rejected promise as "this specific user did not get this message" (e.g.
// they unfriended the bot) - never fatal to the watchdog cycle around it.
export async function pushLineMessage(lineUserId, text) {
  if (!isLineMessagingConfigured) throw new Error("LINE Messaging API not configured");
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      to: lineUserId,
      messages: [{ type: "text", text }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LINE push failed (${res.status}): ${body.slice(0, 300)}`);
  }
}
