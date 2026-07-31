import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
import { Readable } from "node:stream";
import multer from "multer";
import axios from "axios";
import FormData from "form-data";

migrate();
startTelemetryLogger();
startChargeWatchdog();

const app = express();
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

app.use("/api/auth", authRoutes);
app.use("/api/hubs", hubsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/hubs", historyRoutes);
// ==========================================
// 🚀 เพิ่ม Route อัปเดต Firmware ESPHome ที่นี่
// ==========================================
app.post("/api/esphome/update", upload.single("file"), async (req, res) => {
  try {
    const { deviceIp, password } = req.body;
    const file = req.file;

    if (!deviceIp || !file) {
      return res.status(400).json({ error: "Missing deviceIp or file" });
    }

    console.log(`[OTA] Starting update for target: http://${deviceIp}/update`);
    console.log(`[OTA] File name: ${file.originalname}, Size: ${file.size} bytes`);

    // สร้าง FormData โดยใช้ form-data package
    const formData = new FormData();
    
    // แปลง Buffer เป็น Readable Stream ชัดเจน ป้องกันปัญหา source.on is not a function
    const fileStream = Readable.from(file.buffer);

    formData.append("file", fileStream, {
      filename: file.originalname || "firmware.bin",
      contentType: "application/octet-stream",
      knownLength: file.size, // ระบุขนาดไฟล์ให้ ESPHome ทราบ
    });

    if (password) {
      formData.append("password", password);
    }

    const targetUrl = `http://${deviceIp}/update`;

    // ส่งไฟล์ด้วย Axios โดยกำหนด Headers จาก formData โดยตรง
    const response = await axios.post(targetUrl, formData, {
      headers: {
        ...formData.getHeaders(),
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 180000, // Timeout 3 นาที
    });

    console.log(`[OTA Success] Response from ESPHome (${deviceIp}):`, response.data);
    return res.status(200).send(response.data || "OK");
  } catch (error) {
    console.error("[OTA Error Details]:", error.message);

    if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
      return res.status(504).json({
        error: `Gateway Timeout: ESPHome (${req.body.deviceIp}) ไม่ตอบสนองภายในเวลาที่กำหนด`,
      });
    }

    return res.status(500).json({
      error: "Firmware update failed",
      details: error.message,
    });
  }
});


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
