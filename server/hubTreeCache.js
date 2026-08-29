import { readPath } from "./firebaseRead.js";

// Every part of this backend that needs the live JK_BMS_HUB tree used to
// poll Firebase completely independently (per explicit request to cut
// Firebase bandwidth, 2026-08-29): chargeWatchdog.js every 5s,
// telemetryLogger.js every 5s, lineAlertWatchdog.js every 15s, routes/
// hubs.js's GET / once per HTTP request, AND - the biggest multiplier -
// realtime.js ran its OWN separate 1s poll PER CONNECTED SOCKET, so N open
// dashboard tabs meant N independent readers all re-fetching the exact same
// whole tree every second. None of that data actually needs to be fresher
// than 1s (the live dashboard's own tightest tolerance), so this
// consolidates all of it into ONE shared poll at that same 1s cadence -
// Firebase read volume for this path is now flat (exactly 1 read/s)
// regardless of how many watchdogs or connected sockets exist, instead of
// scaling with both.
const POLL_MS = 1000;

let cachedTree = null;
let cachedAt = 0;
let pollTimer = null;
const listeners = new Set();

async function pollOnce() {
  let fresh;
  try {
    fresh = await readPath("JK_BMS_HUB");
  } catch (err) {
    console.error(`[hubTreeCache] poll failed: ${err.message}`);
    return; // keep serving the last-known-good tree rather than clearing it
  }
  cachedTree = fresh;
  cachedAt = Date.now();
  for (const fn of listeners) {
    try {
      fn(cachedTree);
    } catch (err) {
      console.error(`[hubTreeCache] listener failed: ${err.message}`);
    }
  }
}

// Called once at boot (index.js, alongside the other startXWatchdog calls) -
// idempotent so a stray second call (e.g. in a test) doesn't double the poll
// rate.
export function startHubTreeCache() {
  if (pollTimer) return;
  pollOnce();
  pollTimer = setInterval(pollOnce, POLL_MS);
  console.log(`[hubTreeCache] started - polling every ${POLL_MS / 1000}s (shared by every consumer)`);
}

// Synchronous - every consumer that used to `await readPath("JK_BMS_HUB")`
// on its own schedule now reads this instead. Null until the very first
// poll resolves (at most ~1s after boot) - callers already handle a falsy
// tree the same way a failed/empty readPath result was handled before.
export function getCachedHubTree() {
  return cachedTree;
}

export function getCachedHubTreeAt() {
  return cachedAt;
}

// For realtime.js's per-socket watch loop - calls fn(tree) on every fresh
// poll (not just changes; the per-socket diffing stays the caller's own
// job, same as before). Delivers whatever's already cached immediately on
// subscribe too, so a socket connecting between polls doesn't wait up to 1s
// for its first frame. Returns an unsubscribe function.
export function onHubTreeUpdate(fn) {
  listeners.add(fn);
  if (cachedTree !== null) fn(cachedTree);
  return () => listeners.delete(fn);
}
