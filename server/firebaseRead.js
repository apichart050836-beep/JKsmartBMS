import { adminDb, isFirebaseConfigured } from "./firebaseAdmin.js";

const REST_BASE = process.env.FIREBASE_DATABASE_URL;

// adminDb.ref(...).once("value") opens a websocket to the RTDB backend and
// has no built-in timeout - if that connection stalls (flaky egress, a slow
// TLS/auth handshake, etc.) the call hangs forever with no error, which on
// a hosted platform means the HTTP request never completes at all. Every
// read gets a hard ceiling so a Firebase hiccup surfaces as a fast, clear
// error instead of freezing whatever route awaited it (login included).
const READ_TIMEOUT_MS = 8000;

function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Firebase read timed out after ${READ_TIMEOUT_MS}ms for ${label}`)), READ_TIMEOUT_MS)
    ),
  ]);
}

async function readRest(path) {
  const res = await fetch(`${REST_BASE}/${path}.json`);
  if (!res.ok) throw new Error(`Firebase REST read failed for ${path}: ${res.status}`);
  return res.json();
}

// Once the Admin SDK's realtime websocket proves unreachable from this
// process (confirmed on Render: every read timed out at exactly 8s), stop
// retrying it - paying an 8s tax on every single read would make an
// environment that can't complete that handshake at all crawl. Naturally
// resets on redeploy/restart in case connectivity is ever fixed. Exported
// so realtime.js can skip its (equally broken, in that case) live push
// path and poll instead.
let adminSdkBroken = false;
export function isAdminSdkBroken() {
  return adminSdkBroken;
}

// Read-only. Prefers the privileged Admin SDK (adminDb) when the service
// account key is present; falls back to the plain public REST endpoint
// otherwise (real project's Security Rules currently allow public read on
// most paths - confirmed live), AND also falls back to REST if the Admin
// SDK read itself times out - on some hosts the RTDB websocket the Admin
// SDK depends on stalls even though plain HTTPS to the same database works
// fine, so a slow/broken Admin SDK connection degrades to REST instead of
// surfacing as a failed read. Writes never go through this path - they
// stay gated behind requireFirebase/adminDb-only, since REST writes to a
// real production database aren't something to attempt without the
// privileged key confirming what's actually allowed.
export async function readPath(path) {
  if (isFirebaseConfigured && !adminSdkBroken) {
    try {
      const snap = await withTimeout(adminDb.ref(path).once("value"), path);
      return snap.val();
    } catch (err) {
      if (!REST_BASE) throw err;
      adminSdkBroken = true;
      console.warn(`Admin SDK read failed for ${path} (${err.message}) - switching to REST for the rest of this process`);
      return readRest(path);
    }
  }
  return readRest(path);
}

// True once there's SOME way to read Firebase (Admin SDK or public REST) -
// distinct from isFirebaseConfigured, which only reflects the privileged
// path. Routes that only need reads (login, hub data) can work off this;
// routes that need writes must still check isFirebaseConfigured directly.
export const canReadFirebase = isFirebaseConfigured || !!REST_BASE;
