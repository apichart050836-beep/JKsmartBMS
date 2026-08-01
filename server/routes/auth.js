import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "../db.js";
import { comparePassword, signSession, COOKIE_NAME, cookieOptions } from "../auth.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { emailToHubId } from "../emailToHubId.js";
import { readPath, canReadFirebase } from "../firebaseRead.js";

const router = Router();

// Two account types, two different checks:
// - Admin: SQL `users` table (seeded via db/seed.js), password hashed at
//   rest, checked per-account.
// - Hub owner ('user' role): identity is just "does a hub matching this
//   email actually exist" - hub_id is derived from the login email (Firebase
//   keys can't contain ".", see emailToHubId.js) and checked directly
//   against JK_BMS_HUB, not against the userConf node. Once a hub exists,
//   the email itself is the credential (see /login below) - the shared
//   default password (DEFAULT_USER_PASSWORD) is only ever checked once,
//   to queue the original signup request for admin approval.
async function hubExists(email) {
  const hubId = emailToHubId(email);
  try {
    const val = await readPath(`JK_BMS_HUB/${hubId}`);
    return val != null ? hubId : null;
  } catch (err) {
    // A Firebase read failure (timeout, connectivity) must not hang or crash
    // the login request - Express 4 doesn't catch rejected promises from
    // async handlers, so an uncaught rejection here would leave the client
    // waiting forever instead of getting a clear response.
    console.error(`hubExists lookup failed for ${email}: ${err.message}`);
    return null;
  }
}

// Step 1 of the login flow: does this Gmail exist, and does it still need
// the access-code step. Deliberately does not otherwise reveal anything
// about the password at this stage.
//
// - Admin: always needsPassword (that's a real per-account hashed password,
//   this shortcut never applies to it).
// - 'user', hub already exists (approved) - explicit request (2026-08-01):
//   email alone is enough from here on, no access code needed on return
//   visits. needsPassword: false tells the frontend to skip straight to
//   login instead of showing a password field.
// - 'user', no hub yet - either never requested, or requested and still
//   awaiting admin approval (see pending_signups / POST /login below).
//   Either way the frontend still needs to show the access-code field, so
//   this looks identical to the caller in both cases - not distinguishing
//   them here avoids leaking "is this email already mid-approval" to an
//   unauthenticated caller.
router.post("/check-email", async (req, res) => {
  const emailRaw = String(req.body?.email || "").trim();
  const email = emailRaw.toLowerCase();
  if (!email) return res.status(400).json({ error: "Email required" });

  const adminRow = db.prepare("SELECT id FROM users WHERE lower(email) = ? AND role = 'admin'").get(email);
  if (adminRow) return res.json({ exists: true, needsPassword: true });

  if (canReadFirebase) {
    const hubId = await hubExists(emailRaw);
    return res.json({ exists: true, needsPassword: !hubId });
  }

  res.json({ exists: false, needsPassword: true });
});

// Step 2: password check against whichever store step 1 would have matched.
// Same generic error for every failure mode (no such email, wrong password,
// Firebase not reachable) - never let a client distinguish them (user
// enumeration).
router.post("/login", async (req, res) => {
  const emailRaw = String(req.body?.email || "").trim();
  const email = emailRaw.toLowerCase();
  const password = String(req.body?.password || "");

  const adminRow = db.prepare("SELECT * FROM users WHERE lower(email) = ? AND role = 'admin'").get(email);
  if (adminRow && comparePassword(password, adminRow.password_hash)) {
    const token = signSession({ sub: adminRow.id, email: adminRow.email, role: "admin" });
    res.cookie(COOKIE_NAME, token, cookieOptions);
    return res.json({ email: adminRow.email, role: "admin" });
  }

  if (canReadFirebase) {
    const hubId = await hubExists(emailRaw);

    // Approved account - explicit request (2026-08-01): the email existing
    // as a real hub IS the credential from here on, no password check at
    // all. Anyone who knows an approved user's email can sign in as them;
    // accepted tradeoff per this request for this internal tool.
    if (hubId) {
      const token = signSession({ sub: null, email: emailRaw, role: "user", hubId });
      res.cookie(COOKIE_NAME, token, cookieOptions);
      return res.json({ email: emailRaw, role: "user" });
    }

    // No hub yet - the shared access code doesn't log in directly anymore,
    // it only queues a request for an admin to approve (see routes/admin.js
    // for the approval endpoint that actually creates the Firebase hub).
    // ON CONFLICT keeps the original requested_at instead of bumping it on
    // every repeat attempt, so "waiting since" stays honest for the admin.
    if (password === process.env.DEFAULT_USER_PASSWORD) {
      db.prepare(
        `INSERT INTO pending_signups (email, requested_at) VALUES (?, ?)
         ON CONFLICT (email) DO NOTHING`
      ).run(emailRaw, Date.now());
      return res.status(202).json({ pending: true });
    }
  }

  res.status(401).json({ error: "Invalid email or password" });
});

// First-run bootstrap only - "does any admin account exist yet". The
// frontend uses this to decide whether to show the one-time admin setup
// form at all; the real enforcement is server-side in /register-admin
// below (that route re-checks this itself, doesn't just trust the client
// asked nicely first).
router.get("/admin-exists", (_req, res) => {
  const row = db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get();
  res.json({ exists: !!row });
});

// Bootstrap-only self-registration for the very first admin account -
// closes permanently the moment one admin row exists (checked here, not
// just hidden in the UI). Password must match DEFAULT_ADMIN_PASSWORD (a
// shared setup passphrase from server/.env, not hardcoded), AND - when
// DEFAULT_ADMIN_EMAIL is set - the email must match it exactly too: this
// endpoint used to accept ANY email as long as the setup password was
// right, so anyone who found/guessed the passphrase during the bootstrap
// window could register themselves as admin under an email of their own
// choosing. seed.js (the CLI alternative) already enforced this email
// pin; this HTTP route just hadn't caught up to it. Same generic error
// for both mismatches - never let a client tell which one was wrong.
router.post("/register-admin", async (req, res) => {
  const existing = db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get();
  if (existing) {
    return res.status(409).json({ error: "An admin account already exists" });
  }

  const email = String(req.body?.email || "").trim();
  const password = String(req.body?.password || "");
  if (!email) return res.status(400).json({ error: "Email required" });
  const pinnedEmail = process.env.DEFAULT_ADMIN_EMAIL;
  if (pinnedEmail && email.toLowerCase() !== pinnedEmail.toLowerCase()) {
    return res.status(401).json({ error: "Invalid setup password" });
  }
  if (password !== process.env.DEFAULT_ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Invalid setup password" });
  }

  const passwordHash = bcrypt.hashSync(password, 12);
  const info = db
    .prepare("INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'admin')")
    .run(email, passwordHash);

  const token = signSession({ sub: info.lastInsertRowid, email, role: "admin" });
  res.cookie(COOKIE_NAME, token, cookieOptions);
  res.json({ email, role: "admin" });
});

// Password-only shortcut for the "Admin" button - safe specifically because
// register-admin above guarantees at most one admin row ever exists, so
// there's no ambiguity about which account a bare password belongs to.
router.post("/admin-login", (req, res) => {
  const password = String(req.body?.password || "");
  const adminRow = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();

  if (adminRow && comparePassword(password, adminRow.password_hash)) {
    const token = signSession({ sub: adminRow.id, email: adminRow.email, role: "admin" });
    res.cookie(COOKIE_NAME, token, cookieOptions);
    return res.json({ email: adminRow.email, role: "admin" });
  }

  res.status(401).json({ error: "Invalid password" });
});

router.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: undefined });
  res.json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => {
  // hubId lets the frontend look up this session's own hub node (e.g. its
  // admin-set expirationDate) straight out of HubDataContext's already-
  // loaded tree, without a separate lookup route. null for admin sessions
  // (see hubAccess.js - they have no single owned hub).
  res.json({ email: req.user.email, role: req.user.role, hubId: req.user.hubId ?? null });
});

export default router;
