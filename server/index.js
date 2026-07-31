import "dotenv/config";
import express from "express";
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
import { createAnnouncementsRouter } from "./routes/announcements.js";
import { createFirmwareRouter } from "./routes/firmware.js";
import { attachRealtime } from "./realtime.js";
import { startTelemetryLogger } from "./telemetryLogger.js";
import { startChargeWatchdog } from "./chargeWatchdog.js";
import { isAllowedOrigin } from "./corsOrigin.js";

migrate();
startTelemetryLogger();
startChargeWatchdog();

const app = express();

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
app.use(express.static(distPath));
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

const port = process.env.PORT || 4000;
httpServer.listen(port, () => {
  console.log(`BMS backend listening on http://localhost:${port}`);
});