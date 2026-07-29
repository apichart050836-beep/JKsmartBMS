import { Router } from "express";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRole } from "../middleware/requireRole.js";
import { db } from "../db.js";
import { commitFirmwareFile, getRawFirmwareUrl, isGitStorageConfigured } from "../gitStorage.js";
import { isFirebaseConfigured } from "../firebaseAdmin.js";
import { writePath } from "../firebaseRead.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIRMWARE_DIR = path.resolve(__dirname, "..", "firmware");

// Generous headroom over a typical ESP32 .bin (~1-2MB).
const MAX_FIRMWARE_BYTES = 8 * 1024 * 1024;
const MAX_RELEASE_NOTES_LEN = 2000;
const MAX_TARGETS = 50;

function toReleaseJson(row) {
  return { id: row.id, version: row.version, filename: row.filename, sizeBytes: row.size_bytes, uploadedAt: row.uploaded_at };
}

// Same rule as admin.js/hubs.js - Firebase RTDB keys can't contain '.', '#',
// '$', '[', ']', or '/'.
function isSafeKey(k) {
  return typeof k === "string" && k.length > 0 && !/[./#$\[\]]/.test(k);
}

function devicePath(hubId, bmsKey) {
  return bmsKey ? `JK_BMS_HUB/${hubId}/${bmsKey}` : `JK_BMS_HUB/${hubId}`;
}

// Parses+validates the `targets` query param (JSON array of {hubId, bmsKey}
// - bmsKey optional/null for a flat, non-nested hub). Bad entries are
// dropped rather than failing the whole upload - the .bin is already safely
// committed by the time this runs, so a malformed target list should degrade
// to "published, but didn't reach that specific device", not lose the file.
function parseTargets(raw) {
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .slice(0, MAX_TARGETS)
    .filter((t) => t && isSafeKey(t.hubId) && (t.bmsKey === undefined || t.bmsKey === null || isSafeKey(t.bmsKey)))
    .map((t) => ({ hubId: t.hubId, bmsKey: t.bmsKey ?? null }));
}

/**
 * Admin-published ESP32 firmware .bin files - upload, "what's the latest",
 * and download. Broadcasts a "firmware:release" Socket.IO event to every
 * connected user-role dashboard the same way announcements.js broadcasts
 * "announcement" (same "role:user" room, same live-push + catch-up-fetch
 * pattern for a dashboard that loads shortly after).
 *
 * This server still never talks to a physical ESP32 directly - there's no
 * OTA transport *in this app*. What it DOES do now: for every device the
 * admin explicitly checks (`targets`), it writes {latest_version, url,
 * release_notes, update_flag: true} to that device's own Firebase firmware
 * node. That write is a real, meaningful signal - it's the exact path each
 * device's own ota_updater ESPHome component (esphome_components/
 * ota_updater/, wired into jkbms-bridge.yaml) polls on its own schedule and
 * self-flashes from when it sees update_flag=true. No target selected =
 * published to GitHub/the web notification only, same as before this
 * feature existed.
 *
 * Every upload is still saved to the firmware_releases table (metadata +
 * BLOB) unconditionally - that alone is what the notification/"latest"
 * system needs, and it must keep working even if git push below fails or
 * isn't configured yet. The git commit+push is a best-effort *addition* on
 * top: it's what makes the file survive a Render redeploy without a paid
 * persistent disk (see gitStorage.js), but its failure is reported back to
 * the admin rather than made a hard blocker on publishing - and skips the
 * Firebase writes entirely, since there'd be no real URL to give a device.
 */
export function createFirmwareRouter(io) {
  const router = Router();

  router.post(
    "/",
    requireAuth,
    requireRole("admin"),
    express.raw({ type: "application/octet-stream", limit: MAX_FIRMWARE_BYTES }),
    async (req, res) => {
      const version = String(req.query.version ?? "").trim();
      const filename = String(req.query.filename ?? "firmware.bin").trim();
      const releaseNotes = String(req.query.releaseNotes ?? "").trim().slice(0, MAX_RELEASE_NOTES_LEN);
      const targets = parseTargets(req.query.targets);
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

      let gitError = null;
      let rawUrl = null;
      try {
        await commitFirmwareFile(filename, req.body);
        // "nothing to commit" (identical bytes re-uploaded) still means the
        // file is already on GitHub at this path - the URL is still valid.
        rawUrl = await getRawFirmwareUrl(filename);
      } catch (err) {
        console.error(`Firmware git push failed: ${err.message}`);
        gitError = err.message;
      }

      // Real per-device OTA signal (polled by each device's own ESP32
      // ota_updater component - see jkbms-bridge.yaml) - separate from the
      // firmware_releases row above, which only powers the web dashboard's
      // notification badge. Best-effort per target: one device's write
      // failing (bad hubId, Firebase hiccup) doesn't roll back the others or
      // the publish itself, since the file's already safely on GitHub.
      const firebaseResults = [];
      if (rawUrl && isFirebaseConfigured && targets.length > 0) {
        for (const target of targets) {
          try {
            await writePath(`${devicePath(target.hubId, target.bmsKey)}/firmware`, {
              latest_version: version,
              url: rawUrl,
              release_notes: releaseNotes || null,
              uploaded_at: uploadedAt,
              update_flag: true,
            });
            firebaseResults.push({ ...target, ok: true });
          } catch (err) {
            console.error(`Firmware Firebase write failed for ${target.hubId}/${target.bmsKey ?? ""}: ${err.message}`);
            firebaseResults.push({ ...target, ok: false, error: err.message });
          }
        }
      }

      const release = toReleaseJson({
        id: Number(info.lastInsertRowid),
        version,
        filename,
        size_bytes: req.body.length,
        uploaded_at: uploadedAt,
      });
      io.to("role:user").emit("firmware:release", release);
      res.json({ ok: true, release, gitError, rawUrl, firebaseResults });
    }
  );

  router.get("/latest", requireAuth, (req, res) => {
    const row = db
      .prepare(`SELECT id, version, filename, size_bytes, uploaded_at FROM firmware_releases ORDER BY id DESC LIMIT 1`)
      .get();
    res.json({ release: row ? toReleaseJson(row) : null, gitConfigured: isGitStorageConfigured() });
  });

  router.get("/:id/download", requireAuth, (req, res) => {
    const row = db.prepare(`SELECT filename, data FROM firmware_releases WHERE id = ?`).get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: "Not found" });
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${row.filename}"`);
    // Prefer the git-tracked copy when present - it's the one that survives
    // a redeploy; the DB blob is the fallback for rows uploaded before git
    // storage was configured, or if a past push failed.
    const gitPath = path.join(FIRMWARE_DIR, row.filename);
    if (fs.existsSync(gitPath)) {
      return res.sendFile(gitPath);
    }
    res.send(row.data);
  });

  return router;
}
