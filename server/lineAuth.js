import "dotenv/config";
import jwt from "jsonwebtoken";

// LINE Login (OAuth) - how a hub's owner links their personal LINE account
// so lineAlertWatchdog.js has a userId to push alerts to (see
// lineNotify.js for the actual push call). This is a SEPARATE LINE channel
// from the Messaging API one - LINE Login only authenticates the user and
// hands back their userId, it can't send messages; the Messaging API
// channel is what actually pushes. Both need to be under the same LINE
// Developers "Provider" so the userId from Login matches the userId the
// Messaging API can push to (see .env.example for setup).
const CHANNEL_ID = process.env.LINE_LOGIN_CHANNEL_ID;
const CHANNEL_SECRET = process.env.LINE_LOGIN_CHANNEL_SECRET;
const REDIRECT_URI = process.env.LINE_LOGIN_REDIRECT_URI;

export const isLineLoginConfigured = !!(CHANNEL_ID && CHANNEL_SECRET && REDIRECT_URI);

if (!isLineLoginConfigured) {
  console.warn(
    "\nLINE Login not configured (LINE_LOGIN_CHANNEL_ID/LINE_LOGIN_CHANNEL_SECRET/LINE_LOGIN_REDIRECT_URI\n" +
      "missing from server/.env) - GET /api/line/login-url will respond with 503 until these are set.\n"
  );
}

// Short-lived (10 min - just long enough for the user to actually go
// through LINE's consent screen and come back), scoped to exactly this
// purpose so it can never be reused as a real session token even if
// intercepted. Doubles as CSRF protection for the OAuth flow (the state
// param LINE round-trips back to us on /callback).
const STATE_PURPOSE = "line_link_state";
export function signLinkState(hubId) {
  return jwt.sign({ hubId, purpose: STATE_PURPOSE }, process.env.JWT_SECRET, { expiresIn: "10m" });
}

// Returns the hubId this state was issued for, or null if missing/expired/
// tampered/not actually a link-state token.
export function verifyLinkState(state) {
  if (!state) return null;
  try {
    const payload = jwt.verify(state, process.env.JWT_SECRET);
    if (payload.purpose !== STATE_PURPOSE || !payload.hubId) return null;
    return payload.hubId;
  } catch {
    return null;
  }
}

export function buildLoginUrl(state) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CHANNEL_ID,
    redirect_uri: REDIRECT_URI,
    state,
    scope: "openid profile",
  });
  return `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;
}

// Exchanges the one-time authorization code LINE redirected back with for
// the user's LINE userId - decodes id_token (an OIDC JWT) rather than
// calling the separate /v2/profile endpoint, one fewer round-trip. Not
// signature-verified against LINE's JWKS (would need to fetch+cache their
// public keys for one field): this token arrives over a direct
// server-to-server HTTPS POST authenticated with our own client secret,
// the same trust boundary an OAuth confidential client normally relies on
// - aud/iss are still checked as a sanity guard against gross
// misconfiguration, just not full cryptographic verification.
export async function exchangeCodeForLineUserId(code) {
  const res = await fetch("https://api.line.me/oauth2/v2.1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CHANNEL_ID,
      client_secret: CHANNEL_SECRET,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LINE token exchange failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const { id_token } = await res.json();
  if (!id_token) throw new Error("LINE token response had no id_token");

  const claims = jwt.decode(id_token);
  if (!claims || claims.aud !== CHANNEL_ID || claims.iss !== "https://access.line.me" || !claims.sub) {
    throw new Error("LINE id_token failed sanity check (aud/iss/sub)");
  }
  return claims.sub; // the LINE userId
}
