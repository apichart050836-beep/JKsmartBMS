import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRole } from "../middleware/requireRole.js";
import { db } from "../db.js";

// Only show a persisted announcement to a freshly-loading dashboard if it's
// still recent - otherwise a week-old "system update" notice would greet
// every login forever. Live-connected sessions get it instantly regardless
// of this window (see realtime.js / AnnounceModal.jsx), this cutoff only
// affects the catch-up fetch on page load.
const STALE_AFTER_MS = 6 * 60 * 60 * 1000; // 6 hours

const CATEGORIES = new Set(["ปรับปรุงระบบ", "อัพเดทระบบ", "ระบบขัดข้อง"]);

export function createAnnouncementsRouter(io) {
  const router = Router();

  router.post("/", requireAuth, requireRole("admin"), (req, res) => {
    const message = String(req.body?.message ?? "").trim();
    const category = CATEGORIES.has(req.body?.category) ? req.body.category : null;
    if (!message) return res.status(400).json({ error: "Message required" });
    if (message.length > 500) return res.status(400).json({ error: "Message too long" });

    const createdAt = Date.now();
    const info = db
      .prepare(`INSERT INTO announcements (message, category, created_at) VALUES (?, ?, ?)`)
      .run(message, category, createdAt);

    const announcement = { id: Number(info.lastInsertRowid), message, category, createdAt };
    io.to("role:user").emit("announcement", announcement);
    res.json({ ok: true, announcement });
  });

  router.get("/latest", requireAuth, (req, res) => {
    const row = db.prepare(`SELECT id, message, category, created_at FROM announcements ORDER BY id DESC LIMIT 1`).get();
    if (!row || Date.now() - row.created_at > STALE_AFTER_MS) return res.json({ announcement: null });
    res.json({
      announcement: { id: row.id, message: row.message, category: row.category, createdAt: row.created_at },
    });
  });

  return router;
}
