import { Server } from "socket.io";
import { parse as parseCookie } from "cookie";
import { COOKIE_NAME, verifySession } from "./auth.js";
import { allowedHubIds } from "./hubAccess.js";
import { onHubTreeUpdate } from "./hubTreeCache.js";
import { isAllowedOrigin } from "./corsOrigin.js";

// Watches a hub sub-path (or the whole tree if hubId is null/undefined) by
// subscribing to the shared hubTreeCache's ticks instead of polling
// Firebase itself. Per explicit bandwidth-reduction request (2026-08-29):
// this used to run its OWN independent 1s Firebase poll PER CALL - so N
// connected sockets (N open dashboard tabs) meant N independent reads of
// the same whole tree every second. Now every socket just slices its own
// piece out of the ONE tree hubTreeCache already refreshes once a second
// (see that module's own comment on why 1s and why .once()-polling rather
// than a persistent listener - same constraints as before, just centralized
// instead of duplicated per socket).
//
// Diffed against the last-sent snapshot per socket+path (unchanged from
// before this refactor) - a real device's status barely changes between two
// 1s ticks most of the time, so re-emitting the exact same JSON every tick
// is still pure waste even though the read itself is now free. `lastJson`
// starts as a Symbol (never equal to any real JSON.stringify output,
// including "undefined" itself) so the first tick after subscribing always
// emits regardless of what the path resolves to - onHubTreeUpdate delivers
// an immediate tick with whatever's already cached, so a socket that
// connects between polls doesn't wait up to 1s for its first frame either.
function watchPath(hubId, emit) {
  let lastJson = Symbol("unset");

  return onHubTreeUpdate((tree) => {
    const data = hubId ? (tree?.[hubId] ?? null) : tree;
    const json = JSON.stringify(data);
    if (json === lastJson) return;
    lastJson = json;
    try {
      emit(data);
    } catch (err) {
      console.error(`watchPath emit failed for ${hubId ?? "(whole tree)"}: ${err.message}`);
    }
  });
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
        watchPath(null, (data) => {
          socket.emit("hubs:all", data ?? {});
        })
      );
    } else {
      socket.emit("hubs:list", allowed);
      for (const hubId of allowed) {
        cleanup.push(
          watchPath(hubId, (data) => {
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
