import { Router } from "express";
import express from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRole } from "../middleware/requireRole.js";
import { db } from "../db.js";

// Generous headroom over a typical ESP32 .bin (~1-2MB).
const MAX_FIRMWARE_BYTES = 8 * 1024 * 1024;

function toReleaseJson(row) {
  return { id: row.id, version: row.version, filename: row.filename, sizeBytes: row.size_bytes, uploadedAt: row.uploaded_at };
}

/**
 * Admin-published ESP32 firmware .bin files - upload, "what's the latest",
 * and download. Broadcasts a "firmware:release" Socket.IO event to every
 * connected user-role dashboard the same way announcements.js broadcasts
 * "announcement" (same "role:user" room, same live-push + catch-up-fetch
 * pattern for a dashboard that loads shortly after).
 *
 * Deliberately does NOT talk to any physical ESP32 - there's no OTA
 * transport in this app (see the explicit instruction not to touch ESP32/
 * JK BMS protocol). "Update" on the dashboard is acknowledge-only: it marks
 * the notification as seen and shows the existing update-in-progress
 * animation, nothing more. An admin who wants the new .bin on a real device
 * still flashes it themselves (USB/ESPHome dashboard) - this panel is a
 * publish + notify workflow, not a remote-flash mechanism.
 */
export function createFirmwareRouter(io) {
  const router = Router();

  router.post(
    "/",
    requireAuth,
    requireRole("admin"),
    express.raw({ type: "application/octet-stream", limit: MAX_FIRMWARE_BYTES }),
    (req, res) => {
      const version = String(req.query.version ?? "").trim();
      const filename = String(req.query.filename ?? "firmware.bin").trim();
      if (!version) return res.status(400).json({ error: "Version required" });
      if (version.length > 40) return res.status(400).json({ error: "Version too long" });
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const uploadedAt = Date.now();
      const info = db
        .prepare(
          `INSERT INTO firmware_releases (version, filename, size_bytes, data, uploaded_by, uploaded_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(version, filename, req.body.length, req.body, req.user.email, uploadedAt);

      const release = toReleaseJson({
        id: Number(info.lastInsertRowid),
        version,
        filename,
        size_bytes: req.body.length,
        uploaded_at: uploadedAt,
      });
      io.to("role:user").emit("firmware:release", release);
      res.json({ ok: true, release });
    }
  );

  router.get("/latest", requireAuth, (req, res) => {
    const row = db
      .prepare(`SELECT id, version, filename, size_bytes, uploaded_at FROM firmware_releases ORDER BY id DESC LIMIT 1`)
      .get();
    res.json({ release: row ? toReleaseJson(row) : null });
  });

  router.get("/:id/download", requireAuth, (req, res) => {
    const row = db.prepare(`SELECT filename, data FROM firmware_releases WHERE id = ?`).get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: "Not found" });
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${row.filename}"`);
    res.send(row.data);
  });

  return router;
}
