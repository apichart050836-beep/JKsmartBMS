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
import { attachRealtime } from "./realtime.js";
import { startTelemetryLogger } from "./telemetryLogger.js";
import { isAllowedOrigin } from "./corsOrigin.js";

migrate();
startTelemetryLogger();

const app = express();
app.use(
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

app.get("/api/health", (_req, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const io = attachRealtime(httpServer);
app.use("/api/announcements", createAnnouncementsRouter(io));

// Serves the built frontend (npm run build -> ../dist) from this same
// process/port - a single deployable service instead of two separate
// origins glued together by CORS (that split is only for local dev's
// hot-reload convenience, see run.bat). Registered after every /api route
// so nothing here can shadow the API; the catch-all falls back to
// index.html for any non-API path so a direct URL load or refresh on a
// client-side route still works.
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
