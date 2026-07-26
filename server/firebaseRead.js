import { adminDb, isFirebaseConfigured } from "./firebaseAdmin.js";

const REST_BASE = process.env.FIREBASE_DATABASE_URL;

// Read-only. Prefers the privileged Admin SDK (adminDb) when the service
// account key is present; falls back to the plain public REST endpoint
// otherwise (real project's Security Rules currently allow public read on
// most paths - confirmed live). Writes never go through this path - they
// stay gated behind requireFirebase/adminDb-only, since REST writes to a
// real production database aren't something to attempt without the
// privileged key confirming what's actually allowed.
export async function readPath(path) {
  if (isFirebaseConfigured) {
    const snap = await adminDb.ref(path).once("value");
    return snap.val();
  }
  const res = await fetch(`${REST_BASE}/${path}.json`);
  if (!res.ok) throw new Error(`Firebase REST read failed for ${path}: ${res.status}`);
  return res.json();
}

// True once there's SOME way to read Firebase (Admin SDK or public REST) -
// distinct from isFirebaseConfigured, which only reflects the privileged
// path. Routes that only need reads (login, hub data) can work off this;
// routes that need writes must still check isFirebaseConfigured directly.
export const canReadFirebase = isFirebaseConfigured || !!REST_BASE;
