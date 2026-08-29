import { Server } from "socket.io";
import { parse as parseCookie } from "cookie";
import { COOKIE_NAME, verifySession } from "./auth.js";
import { allowedHubIds } from "./hubAccess.js";
import { onHubTreeUpdate } from "./hubTreeCache.js";
import { isAllowedOrigin } from "./corsOrigin.js";

// Watches a single hub's sub-path by subscribing to the shared
// hubTreeCache's ticks instead of polling
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
    const data = tree?.[hubId] ?? null;
    const json = JSON.stringify(data);
    if (json === lastJson) return;
    lastJson = json;
    try {
      emit(data);
    } catch (err) {
      console.error(`watchPath emit failed for ${hubId}: ${err.message}`);
    }
  });
}

// Admin sessions ("hubs:all") used to get the WHOLE tree re-sent as one
// blob on every change anywhere in it - per explicit bandwidth-reduction
// follow-up (2026-08-29), with several hubs actively reporting telemetry,
// SOMETHING changes almost every 1s tick, so that whole-tree diff almost
// never actually matched two ticks in a row: an admin session was
// effectively getting the full tree pushed over the socket roughly once a
// second regardless of how much of it actually changed. This instead
// dynamically watches each hub INDIVIDUALLY (same per-hub diffing the
// non-admin branch below already had) and emits granular "hub:update"
// events - HubDataContext.jsx's handler for that event already does an
// incremental upsert, not a replace (see its own comment), so this needed
// zero frontend changes. The hub ID SET itself can grow (a new account
// signs up) or shrink over the life of a long-lived admin session, so this
// re-diffs that set on every cache tick (cheap - just comparing a handful
// of string keys) and starts/stops a `watchPath` per hub as needed.
function watchAllHubs(socket) {
  const hubWatchers = new Map(); // hubId -> its watchPath cleanup fn
  const unsubscribeFromTree = onHubTreeUpdate((tree) => {
    const currentIds = new Set(Object.keys(tree ?? {}));
    for (const hubId of currentIds) {
      if (hubWatchers.has(hubId)) continue;
      hubWatchers.set(
        hubId,
        watchPath(hubId, (data) => {
          socket.emit("hub:update", { hubId, data });
        })
      );
    }
    for (const [hubId, stopWatching] of hubWatchers) {
      if (currentIds.has(hubId)) continue;
      stopWatching();
      hubWatchers.delete(hubId);
      socket.emit("hub:update", { hubId, data: null }); // tells the client this hub is gone
    }
  });
  return () => {
    unsubscribeFromTree();
    for (const stopWatching of hubWatchers.values()) stopWatching();
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
      // "hubs:list" itself is content-ignored by the frontend (see
      // HubDataContext.jsx) - only used to flip `loaded` true immediately,
      // same as the non-admin branch below, instead of waiting on the
      // first per-hub "hub:update" (or forever, for an admin whose Firebase
      // project happens to have zero hubs).
      socket.emit("hubs:list", []);
      cleanup.push(watchAllHubs(socket));
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
