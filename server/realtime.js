import { Server } from "socket.io";
import { parse as parseCookie } from "cookie";
import { COOKIE_NAME, verifySession } from "./auth.js";
import { allowedHubIds } from "./hubAccess.js";
import { adminDb, isFirebaseConfigured } from "./firebaseAdmin.js";
import { readPath } from "./firebaseRead.js";
import { isAllowedOrigin } from "./corsOrigin.js";

const REST_POLL_MS = 5000;

// Same role filtering as GET /api/hubs, but live: a non-admin socket only
// ever reads the specific hub_id path its account owns - it can't receive
// another user's hub even if the frontend were compromised, because the
// server never reads that path for this connection in the first place.
export function attachRealtime(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin(origin, callback) {
        if (isAllowedOrigin(origin)) return callback(null, true);
        callback(new Error("Not allowed by CORS"));
      },
      credentials: true,
    },
  });

  io.use((socket, next) => {
    const cookies = parseCookie(socket.request.headers.cookie || "");
    const payload = verifySession(cookies[COOKIE_NAME]);
    if (!payload) return next(new Error("unauthorized"));
    socket.user = payload;
    next();
  });

  io.on("connection", (socket) => {
    const allowed = allowedHubIds(socket.user);
    const cleanup = [];

    // Lets admin-broadcast announcements (routes/announcements.js) target
    // exactly the sessions that actually render the Dashboard/announcement
    // banner - admin sessions don't need their own broadcast pushed back at
    // them since they never see that page anymore.
    if (socket.user.role === "user") socket.join("role:user");

    if (isFirebaseConfigured) {
      // True push via the Admin SDK.
      if (allowed === null) {
        const ref = adminDb.ref("JK_BMS_HUB");
        const cb = (snap) => socket.emit("hubs:all", snap.val() ?? {});
        ref.on("value", cb);
        cleanup.push(() => ref.off("value", cb));
      } else {
        socket.emit("hubs:list", allowed);
        for (const hubId of allowed) {
          const ref = adminDb.ref(`JK_BMS_HUB/${hubId}`);
          const cb = (snap) => socket.emit("hub:update", { hubId, data: snap.val() });
          ref.on("value", cb);
          cleanup.push(() => ref.off("value", cb));
        }
      }
    } else {
      // No Admin SDK key yet - plain REST has no push mechanism, so poll
      // instead. Same role scoping as the push path above, just on a timer.
      // Upgrades to true push automatically once the key is added and the
      // backend restarts.
      if (allowed === null) {
        const tick = async () => socket.emit("hubs:all", (await readPath("JK_BMS_HUB")) ?? {});
        tick();
        const id = setInterval(tick, REST_POLL_MS);
        cleanup.push(() => clearInterval(id));
      } else {
        socket.emit("hubs:list", allowed);
        const id = setInterval(async () => {
          for (const hubId of allowed) {
            socket.emit("hub:update", { hubId, data: await readPath(`JK_BMS_HUB/${hubId}`) });
          }
        }, REST_POLL_MS);
        for (const hubId of allowed) {
          readPath(`JK_BMS_HUB/${hubId}`).then((data) => socket.emit("hub:update", { hubId, data }));
        }
        cleanup.push(() => clearInterval(id));
      }
    }

    socket.on("disconnect", () => {
      for (const fn of cleanup) fn();
    });
  });

  return io;
}
