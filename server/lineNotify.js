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
