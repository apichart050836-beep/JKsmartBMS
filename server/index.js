import "dotenv/config";
import express from "express";
import compression from "compression";
import cors from "cors";
import cookieParser from "cookie-parser";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import axios from "axios";
import FormData from "form-data";

import { migrate } from "./db.js";
import authRoutes from "./routes/auth.js";
import hubsRoutes from "./routes/hubs.js";
import adminRoutes from "./routes/admin.js";
import historyRoutes from "./routes/history.js";
import lineRoutes from "./routes/line.js";
import { createAnnouncementsRouter } from "./routes/announcements.js";
import { createFirmwareRouter } from "./routes/firmware.js";
import { attachRealtime } from "./realtime.js";
import { startTelemetryLogger } from "./telemetryLogger.js";
import { startChargeWatchdog } from "./chargeWatchdog.js";
import { startLineAlertWatchdog } from "./lineAlertWatchdog.js";
import { isAllowedOrigin } from "./corsOrigin.js";

migrate();
startTelemetryLogger();
startChargeWatchdog();
startLineAlertWatchdog();

const app = express();

// gzip/brotli-compresses every response this process sends (JSON API
// replies, and the static JS/CSS bundle below) - per explicit request to
// cut Render bandwidth usage. Registered first so nothing downstream can
// bypass it. Uses compression's default content-type filter, which already
// skips already-compressed binary payloads (firmware .bin downloads,
// images) automatically - no extra config needed for that.
app.use(compression());

// 🎯 ตั้งค่า Multer สำหรับรับไฟล์อัปโหลดไว้ใน Memory ชั่วคราว
const upload = multer({ storage: multer.memoryStorage() });

// Scoped to /api only - the built frontend is served same-origin from this
// same process (see express.static below), and same-origin requests for
// module scripts/stylesheets still carry a crossorigin attribute (Vite's
// default for type="module"), which makes browsers send an Origin header
// even though it's not actually cross-origin. A global CORS check rejected
// those (Origin didn't match localhost or CLIENT_ORIGIN), breaking every
// production load - keep this scoped to /api or that regression comes back.
app.use(
  "/api",
  cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) return callback(null, true);
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// Routes หลักของระบบ
app.use("/api/auth", authRoutes);
app.use("/api/hubs", hubsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/hubs", historyRoutes);
app.use("/api/line", lineRoutes);

// =========================================================
// 🚀 Route สำหรับเป็น Proxy ส่ง Firmware ไปยัง ESPHome (Direct/LAN)
// =========================================================
app.post("/api/esphome/update", upload.single("file"), async (req, res) => {
  try {
    const { deviceIp, password } = req.body;
    const file = req.file;

    if (!file || !deviceIp) {
      return res.status(400).json({ error: "กรุณาส่งไฟล์และ IP Address มาให้ครบถ้วน" });
    }

    const form = new FormData();
    form.append("file", file.buffer, {
      filename: file.originalname || "firmware.bin",
      contentType: "application/octet-stream",
    });

    if (password) {
      form.append("password", password);
    }

    const targetUrl = `http://${deviceIp}/update`;
    console.log(`[Proxy] กำลังส่งไฟล์ Firmware ต่อไปที่: ${targetUrl}`);

    const response = await axios.post(targetUrl, form, {
      headers: {
        ...form.getHeaders(),
      },
      timeout: 120000, // กำหนด Timeout ไว้ที่ 2 นาที
    });

    return res.status(200).json({
      message: "อัปเดต Firmware ลง ESP32 สำเร็จ",
      espStatus: response.status,
    });

  } catch (error) {
    console.error("[Proxy Error]:", error.message);
    return res.status(500).json({
      error: "ไม่สามารถส่งไฟล์ไปที่ ESP32 ได้",
      details: error.response ? error.response.data : error.message,
    });
  }
});
// =========================================================

app.get("/api/health", (_req, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const io = attachRealtime(httpServer);
app.use("/api/announcements", createAnnouncementsRouter(io));
app.use("/api/firmware", createFirmwareRouter(io));

// Serves the built frontend (npm run build -> ../dist) from this same
// process/port - a single deployable service instead of two separate
// origins glued together by CORS (that split is only for local dev's
// hot-reload convenience, see run.bat). Registered after every /api route
// so nothing here can shadow the API; the catch-all falls back to
// index.html for any non-API path so a direct URL load or refresh on a
// client-side route still works. Required on Render - without this the
// deployed process only ever serves bare API responses, no HTML/JS/CSS.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, "../dist");
// Vite content-hashes every file under dist/assets/ (index-<hash>.js,
// vendor-<hash>.js, ...) - a changed file always gets a new URL, so those
// alone are safe to tell browsers to cache for a full year and never
// re-validate (immutable). Everything else in dist/ is a verbatim copy of
// public/ (e.g. images/flow-main.jpg) with a STABLE filename that could
// be replaced by a future deploy - caching those "immutable" would leave
// visitors stuck on a year-old stale copy forever if that ever happens,
// so they get a short, revalidating cache instead. index.html is the
// other exception: it's the file that actually changes on every deploy
// (it references that build's current hashed filenames), so it must
// always be re-fetched/re-validated, never served stale.
app.use(
  express.static(distPath, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith("index.html")) {
        res.setHeader("Cache-Control", "no-cache");
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else {
        res.setHeader("Cache-Control", "public, max-age=3600");
      }
    },
  })
);
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.set("Cache-Control", "no-cache");
  res.sendFile(path.join(distPath, "index.html"));
});

const port = process.env.PORT || 10000;
httpServer.listen(port, () => {
  console.log(`BMS backend listening on http://localhost:${port}`);
});