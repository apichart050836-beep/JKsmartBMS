import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp, cert } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const keyPath = path.resolve(__dirname, process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "./serviceAccountKey.json");

// Two ways to supply the key:
// - A file on disk (serviceAccountKey.json) - what local dev uses, and what
//   run.bat expects.
// - The FIREBASE_SERVICE_ACCOUNT_JSON env var, holding the entire key JSON
//   as one string - for hosts like Render where the repo (and therefore the
//   deploy) never has the actual key file on disk at all, only what's
//   pasted into the dashboard's environment variables.
function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }
  if (fs.existsSync(keyPath)) {
    return JSON.parse(fs.readFileSync(keyPath, "utf8"));
  }
  return null;
}

const serviceAccount = loadServiceAccount();

// Missing the key does NOT crash the whole server - login/session/auth
// routes don't touch Firebase at all, so they must keep working while the
// key is still being set up. Only routes/hubs.js, routes/admin.js, and
// realtime.js actually need `adminDb`; each checks isFirebaseConfigured
// and responds with a clear "not configured yet" error instead of crashing.
export const isFirebaseConfigured = !!serviceAccount;

if (!isFirebaseConfigured) {
  console.warn(
    `\nFirebase service account key not found at ${keyPath} (and FIREBASE_SERVICE_ACCOUNT_JSON is not set)\n` +
      "Login will work, but Hub/ESP32 data won't load until you add it:\n" +
      "Firebase Console > Project Settings > Service Accounts > Generate new private key,\n" +
      "save the downloaded JSON there (or point FIREBASE_SERVICE_ACCOUNT_PATH at it in server/.env),\n" +
      "or paste the whole JSON as FIREBASE_SERVICE_ACCOUNT_JSON in a hosted environment's dashboard.\n"
  );
}

const credential = isFirebaseConfigured ? cert(serviceAccount) : null;

export const adminDb = isFirebaseConfigured
  ? getDatabase(
      initializeApp({
        credential,
        databaseURL: process.env.FIREBASE_DATABASE_URL,
      })
    )
  : null;

// Lets firebaseRead.js's REST write fallback authenticate as this same
// service account over plain HTTPS instead of the Admin SDK's own RTDB
// transport (whose websocket connection has been confirmed to hang on
// Render) - reuses the credential already built above rather than a
// second one.
export async function getAccessToken() {
  const { access_token } = await credential.getAccessToken();
  return access_token;
}
