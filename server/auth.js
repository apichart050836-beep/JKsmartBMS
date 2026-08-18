import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

export function comparePassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

// No expiresIn - per explicit request, a session should last until the
// user actually clicks logout, not expire on a fixed timer. Omitting
// expiresIn means jwt.sign() never adds an exp claim, so verifySession's
// jwt.verify() below can never reject this token as expired.
export function signSession(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET);
}

// Returns the decoded payload, or null if missing/invalid/expired - callers
// treat null as "not authenticated", never throw past this boundary.
export function verifySession(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
}

export const COOKIE_NAME = process.env.COOKIE_NAME || "bms_session";

export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  // Effectively never expires (100 years) - same "only logout ends the
  // session" intent as the JWT above, but for the cookie itself, so it
  // survives browser restarts too, not just staying alive until the
  // browser is closed (which is what omitting maxAge entirely would do).
  maxAge: 100 * 365 * 24 * 60 * 60 * 1000,
};
