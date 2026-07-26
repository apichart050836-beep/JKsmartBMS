import { isFirebaseConfigured } from "../firebaseAdmin.js";

// Guards every route that touches adminDb - without this, a missing
// serviceAccountKey.json would throw a raw null-reference error instead of
// a clear, actionable message. Auth routes never use this middleware, so
// login keeps working regardless of Firebase setup state.
export function requireFirebase(req, res, next) {
  if (!isFirebaseConfigured) {
    return res.status(503).json({
      error: "Firebase not configured on the server yet - add server/serviceAccountKey.json and restart.",
    });
  }
  next();
}
