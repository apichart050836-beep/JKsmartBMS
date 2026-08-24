import { Server } from "socket.io";
import { parse as parseCookie } from "cookie";
import { COOKIE_NAME, verifySession } from "./auth.js";
import { allowedHubIds } from "./hubAccess.js";
import { readPath } from "./firebaseRead.js";
import { isAllowedOrigin } from "./corsOrigin.js";

// 1s - the power-flow and peak cards use this stream directly, so a new
// Solar PV/Load maximum appears on the open dashboard without a visible lag.
// Still a plain REST poll per watched path, not a real push - see the
// .once()-vs-.on() reasoning below for why this stays polling-based rather
// than switching to a live listener.
const REST_POLL_MS = 1000;

// Watches a single Firebase path and calls emit(data) whenever a poll
// delivers something CHANGED. Always polls via readPath (Admin SDK
// once()-with-timeout, REST fallback) rather than a persistent
// adminDb.ref(...).on() listener - .once() reads are proven reliable in
// this environment (extensively tested), but the one live attempt at a
// persistent .on() listener broke every subsequent request on that same
// socket connection (reproduced with a raw curl replay of the Engine.IO
// handshake: the connect packet succeeds, the very next poll 502s).
//
// Diffed against the last-sent snapshot (per explicit request to cut
// bandwidth) - a real device's status barely changes between two 1s
// polls most of the time, so re-emitting the exact same JSON every single
// second was pure waste. `lastJson` starts as a Symbol (never equal to any
// real JSON.stringify output, including "undefined" itself) so the very
// first poll always emits regardless of what the path resolves to.
function watchPath(path, emit) {
  let lastJson = Symbol("unset");

  async function poll() {
    let data;
    try {
      data = await readPath(path);
    } catch (err) {
      console.error(`watchPath poll failed for ${path}: ${err.message}`);
      return;
    }
    const json = JSON.stringify(data);
    if (json === lastJson) return;
    lastJson = json;
    try {
      await emit(data);
    } catch (err) {
      console.error(`watchPath emit failed for ${path}: ${err.message}`);
    }
  }

  poll();
  const id = setInterval(poll, REST_POLL_MS);
  return () => clearInterval(id);
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
        watchPath("JK_BMS_HUB", (data) => {
          socket.emit("hubs:all", data ?? {});
        })
      );
    } else {
      socket.emit("hubs:list", allowed);
      for (const hubId of allowed) {
        cleanup.push(
          watchPath(`JK_BMS_HUB/${hubId}`, (data) => {
            socket.emit("hub:update", { hubId, data });
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
