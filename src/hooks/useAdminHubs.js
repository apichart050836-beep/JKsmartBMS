import { useEffect, useRef, useState } from "react";
import { useHubData } from "../context/HubDataContext.jsx";
import { flattenHubs } from "../lib/flattenHubs.js";

const STALE_AFTER_MS = 90000; // matches BMSDashboard's per-device Online/Offline threshold

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

  // "Fresh" whenever EITHER info.uptime_seconds has increased OR any field
  // in status has changed (same basis as useBmsPackLive.js's per-device
  // Online/Offline check) - checked independently, not one as a fallback
  // for the other.
  useEffect(() => {
    const nowMs = Date.now();
    for (const { hubId, bmsKey, data } of flattenHubs(hubs)) {
      const trackKey = `${hubId}/${bmsKey ?? "_"}`;
      const prev = lastSeenRef.current[trackKey];
      const uptime = data?.info?.uptime_seconds;
      const statusJson = JSON.stringify(data?.status ?? {});

      const uptimeIncreased = typeof uptime === "number" && (!prev || prev.uptime == null || uptime > prev.uptime);
      const statusChanged = !prev || prev.statusJson !== statusJson;
      const isFresh = uptimeIncreased || statusChanged;

      if (isFresh) {
        lastSeenRef.current[trackKey] = {
          t: nowMs,
          uptime: typeof uptime === "number" ? uptime : prev?.uptime,
          statusJson,
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
      // ESP32/ESPHome's own reported version (same source VersionCheckModal
      // labels "ESP32 Software" on the user Dashboard).
      firmwareVersion: data.firmware_version ?? data.info?.software_version ?? null,
      // The physical JK BMS chip's own version, read over BLE - a totally
      // separate piece of hardware from the ESP32, and not something this
      // app's OTA system can ever flash (same source VersionCheckModal
      // labels "BMS Version"). Kept as its own field so the admin table
      // doesn't conflate the two the way a single "Firmware" column would.
      bmsVersion: data.info?.hardware_version ?? null,
      settingsPathBase: isNested ? `JK_BMS_HUB/${hubId}/${bmsKey}` : `JK_BMS_HUB/${hubId}`,
      enabled: admin.enabled ?? true,
    };
  });

  return { rows, firebaseConnected: socketConnected };
}
