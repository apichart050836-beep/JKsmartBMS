// Must run after requireAuth - relies on req.user already being set from the
// verified session token, not from anything the client sent this request.
export function requireRole(role) {
  return (req, res, next) => {
    if (req.user?.role !== role) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}
