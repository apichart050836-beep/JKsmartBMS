import { Server } from "socket.io";
import { parse as parseCookie } from "cookie";
import { COOKIE_NAME, verifySession } from "./auth.js";
import { allowedHubIds } from "./hubAccess.js";
import { adminDb, isFirebaseConfigured } from "./firebaseAdmin.js";
import { readPath, isAdminSdkBroken } from "./firebaseRead.js";
import { isAllowedOrigin } from "./corsOrigin.js";

const REST_POLL_MS = 5000;
// How long to wait for the Admin SDK's first push before assuming its
// websocket isn't going to connect at all and switching that ref to REST
// polling instead. Only matters right after server startup, before any
// other read has tripped firebaseRead.js's circuit breaker yet - once
// isAdminSdkBroken() is true, new connections skip straight to polling.
const PUSH_FALLBACK_MS = 10000;

// Watches a single Firebase path and calls emit(data) whenever it changes.
// Prefers the Admin SDK's true push, but falls back to REST polling if push
// hasn't delivered anything within PUSH_FALLBACK_MS (or is already known
// broken) - on some hosts the RTDB websocket the Admin SDK depends on never
// completes its handshake even though plain HTTPS reads work fine.
function safeEmit(emit, dataPromise, path) {
  Promise.resolve(emit(dataPromise)).catch((err) => {
    console.error(`watchPath emit failed for ${path}: ${err.message}`);
  });
}

function watchPath(path, emit) {
  if (!isFirebaseConfigured || isAdminSdkBroken()) {
    safeEmit(emit, readPath(path), path);
    const id = setInterval(() => safeEmit(emit, readPath(path), path), REST_POLL_MS);
    return () => clearInterval(id);
  }

  let usingPoll = false;
  let pollId = null;
  const ref = adminDb.ref(path);
  const cb = (snap) => {
    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    safeEmit(emit, Promise.resolve(snap.val()), path);
  };
  ref.on("value", cb);

  let fallbackTimer = setTimeout(() => {
    usingPoll = true;
    ref.off("value", cb);
    safeEmit(emit, readPath(path), path);
    pollId = setInterval(() => safeEmit(emit, readPath(path), path), REST_POLL_MS);
  }, PUSH_FALLBACK_MS);

  return () => {
    if (fallbackTimer) clearTimeout(fallbackTimer);
    if (usingPoll) clearInterval(pollId);
    else ref.off("value", cb);
  };
}

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

    if (allowed === null) {
      cleanup.push(
        watchPath("JK_BMS_HUB", async (dataPromise) => {
          socket.emit("hubs:all", (await dataPromise) ?? {});
        })
      );
    } else {
      socket.emit("hubs:list", allowed);
      for (const hubId of allowed) {
        cleanup.push(
          watchPath(`JK_BMS_HUB/${hubId}`, async (dataPromise) => {
            socket.emit("hub:update", { hubId, data: await dataPromise });
          })
        );
      }
    }

    socket.on("disconnect", () => {
      for (const fn of cleanup) fn();
    });
  });

  return io;
}
