import { useEffect, useRef, useState } from "react";
import { useHubData } from "../context/HubDataContext.jsx";
import { flattenHubs } from "../lib/flattenHubs.js";

const STALE_AFTER_MS = 15000; // matches BMSDashboard's per-device Online/Offline threshold

/**
 * Fleet-wide view of every hub (and every BMS nested under it) visible to
 * this session, for the Admin Monitor page - sourced from the same
 * HubDataContext socket every other hook uses now, not a direct Firebase
 * subscription of its own. Only ever populated for an admin session (the
 * backend only sends the "hubs:all" event to admin sockets - see
 * realtime.js), so a non-admin session's `hubs` here is always empty even if
 * this hook were mistakenly rendered for them.
 */
export function useAdminHubs() {
  const { hubs, socketConnected } = useHubData();
  const [now, setNow] = useState(Date.now());
  const lastSeenRef = useRef({}); // "hubId/bmsKey" -> { t: ms, statusJson: string }

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // "Fresh" is keyed off info.uptime_seconds actually increasing (same
  // basis as useBmsPackLive.js's per-device Online/Offline check) - a live
  // device's own seconds-since-boot counter only ever climbs, so it's a
  // direct signal rather than an indirect one. Falls back to the previous
  // whole-status-JSON diff for a device that isn't reporting
  // uptime_seconds at all.
  useEffect(() => {
    const nowMs = Date.now();
    for (const { hubId, bmsKey, data } of flattenHubs(hubs)) {
      const trackKey = `${hubId}/${bmsKey ?? "_"}`;
      const prev = lastSeenRef.current[trackKey];
      const uptime = data?.info?.uptime_seconds;

      let isFresh;
      if (typeof uptime === "number") {
        isFresh = !prev || prev.uptime == null || uptime > prev.uptime;
      } else {
        const statusJson = JSON.stringify(data?.status ?? {});
        isFresh = !prev || prev.statusJson !== statusJson;
      }

      if (isFresh) {
        lastSeenRef.current[trackKey] = {
          t: nowMs,
          uptime: typeof uptime === "number" ? uptime : prev?.uptime,
          statusJson: JSON.stringify(data?.status ?? {}),
        };
      }
    }
  }, [hubs]);

  const rows = flattenHubs(hubs).map(({ hubId, bmsKey, data }) => {
    const statusIsString = typeof data.status === "string";
    const trackKey = `${hubId}/${bmsKey ?? "_"}`;
    const lastSeenAt = lastSeenRef.current[trackKey]?.t ?? null;
    const admin = data.admin ?? {};
    const isNested = bmsKey !== null;

    return {
      hubId,
      bmsKey,
      label: isNested ? bmsKey : admin.deviceId || hubId,
      shape: isNested ? "nested" : "flat",
      isOnline: statusIsString
        ? data.status === "online"
        : socketConnected && !!lastSeenAt && now - lastSeenAt < STALE_AFTER_MS,
      expireDate: admin.expirationDate ?? data.expire_date ?? null,
      buildDate: isNested ? (hubs[hubId]?.build_date ?? null) : admin.espBuildDate ?? null,
      firmwareVersion: data.firmware_version ?? data.info?.software_version ?? null,
      settingsPathBase: isNested ? `JK_BMS_HUB/${hubId}/${bmsKey}` : `JK_BMS_HUB/${hubId}`,
      enabled: admin.enabled ?? true,
    };
  });

  return { rows, firebaseConnected: socketConnected };
}
