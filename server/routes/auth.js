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
//   against JK_BMS_HUB, not against the userConf node. Password is the
//   single shared default (DEFAULT_USER_PASSWORD), not a per-hub value.
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

// Step 1 of the login flow: does this Gmail exist at all. Deliberately does
// NOT reveal anything about the password at this stage.
router.post("/check-email", async (req, res) => {
  const emailRaw = String(req.body?.email || "").trim();
  const email = emailRaw.toLowerCase();
  if (!email) return res.status(400).json({ error: "Email required" });

  const adminRow = db.prepare("SELECT id FROM users WHERE lower(email) = ? AND role = 'admin'").get(email);
  if (adminRow) return res.json({ exists: true });

  if (canReadFirebase && (await hubExists(emailRaw))) {
    return res.json({ exists: true });
  }

  res.json({ exists: false });
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

  if (canReadFirebase && password === process.env.DEFAULT_USER_PASSWORD) {
    const hubId = await hubExists(emailRaw);
    if (hubId) {
      const token = signSession({ sub: null, email: emailRaw, role: "user", hubId });
      res.cookie(COOKIE_NAME, token, cookieOptions);
      return res.json({ email: emailRaw, role: "user" });
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
  res.json({ email: req.user.email, role: req.user.role });
});

export default router;
