import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

export function comparePassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

export function signSession(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || "12h" });
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
  maxAge: 12 * 60 * 60 * 1000,
};
