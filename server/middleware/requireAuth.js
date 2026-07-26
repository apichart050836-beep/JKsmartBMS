import { COOKIE_NAME, verifySession } from "../auth.js";

// Every protected route reads role/email from the verified JWT only - never
// from req.body/req.query, so a client can't just claim to be an admin or
// claim a different email/hubId in the request payload.
export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  const payload = verifySession(token);
  if (!payload) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  req.user = payload; // { sub, email, role }
  next();
}
