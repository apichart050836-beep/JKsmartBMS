import { Router } from "express";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRole } from "../middleware/requireRole.js";
import { db } from "../db.js";
import { commitFirmwareFile, getRawFirmwareUrl, isGitStorageConfigured } from "../gitStorage.js";
import { isMqttConfigured, publishOtaCommand } from "../mqttClient.js";

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
 * OTA file transport *in this app*, only a signal. That signal moved from a
 * Firebase write to an MQTT publish (per explicit request, 2026-08-06): for
 * every device the admin explicitly checks (`targets`), it PUBLISHes
 * {latest_version, url, update_flag: true, uploaded_at} to that exact
 * device's own `jk_bms_hub/{hubId}/{bmsKey}/command` topic on the MQTT
 * broker (see mqttClient.js) - the ESP32's own firmware subscribes there and
 * self-flashes the instant it arrives, no polling involved. No target
 * selected = published to GitHub/the web notification only, same as before.
 * Also upserted into firmware_targets (server/db/schema.sql) so a later
 * re-trigger (PATCH /:hubId/firmware/trigger-update) has something to
 * re-publish - MQTT itself has no "current value" a reconnecting device
 * could poll, unlike the Firebase node this replaced.
 *
 * Every upload is still saved to the firmware_releases table (metadata +
 * BLOB) unconditionally - that alone is what the notification/"latest"
 * system needs, and it must keep working even if git push below fails or
 * isn't configured yet. The git commit+push is a best-effort *addition* on
 * top: it's what makes the file survive a Render redeploy without a paid
 * persistent disk (see gitStorage.js), but its failure is reported back to
 * the admin rather than made a hard blocker on publishing - and skips the
 * MQTT publish entirely, since there'd be no real URL to give a device.
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

      // Real per-device OTA signal - published straight to this device's own
      // MQTT topic (its firmware subscribes there and self-flashes on
      // arrival, no polling) - separate from the firmware_releases row
      // above, which only powers the web dashboard's notification badge.
      // Best-effort per target: one device's publish failing (bad hubId,
      // broker hiccup) doesn't roll back the others or the publish itself,
      // since the file's already safely on GitHub. Also upserted into
      // firmware_targets so trigger-update has this to re-send later.
      const mqttResults = [];
      if (rawUrl && isMqttConfigured && targets.length > 0) {
        const upsertTarget = db.prepare(
          `INSERT INTO firmware_targets (hub_id, bms_key, latest_version, url, release_notes, uploaded_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (hub_id, bms_key) DO UPDATE SET
             latest_version = excluded.latest_version,
             url = excluded.url,
             release_notes = excluded.release_notes,
             uploaded_at = excluded.uploaded_at`
        );
        for (const target of targets) {
          const bmsKeyNorm = target.bmsKey ?? "";
          // The MAC segment in the MQTT topic - bmsKey is already this exact
          // ESP32's own chip id (its Firebase path segment before this
          // change), which is what's actually subscribed to MQTT. Flat-
          // shaped hubs (bmsKey null - a single un-nested device) have no
          // separate device MAC available here, so fall back to hubId; this
          // hasn't been needed by any real device seen so far, only nested
          // hubs have.
          const mac = bmsKeyNorm || target.hubId;
          try {
            await publishOtaCommand(target.hubId, mac, {
              latest_version: version,
              update_flag: true,
              uploaded_at: uploadedAt,
              url: rawUrl,
            });
            upsertTarget.run(target.hubId, bmsKeyNorm, version, rawUrl, releaseNotes || null, uploadedAt);
            mqttResults.push({ ...target, ok: true });
          } catch (err) {
            console.error(`Firmware MQTT publish failed for ${target.hubId}/${bmsKeyNorm}: ${err.message}`);
            mqttResults.push({ ...target, ok: false, error: err.message });
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
      res.json({ ok: true, release, gitError, rawUrl, mqttResults });
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
