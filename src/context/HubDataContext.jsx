import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { API_BASE_URL, api } from "../lib/apiClient.js";
import { useAuth } from "./AuthContext.jsx";

const HubDataContext = createContext(null);

// Persisted per-browser so a dismissed announcement stays dismissed across
// reloads/reconnects - without this, the catch-up fetch on every page load
// would just show the same announcement again since it has no memory of
// what was already closed (only a "still recent enough" window server-side).
const DISMISSED_KEY = "bms-dismissed-announcement-id";
const getDismissedId = () => Number(localStorage.getItem(DISMISSED_KEY)) || null;
const setDismissedId = (id) => localStorage.setItem(DISMISSED_KEY, String(id));

// Same per-browser "seen it" pattern as announcements, but firmwareRelease
// itself stays populated even after acknowledging (unlike announcement,
// which just nulls out) - the version-check popup still needs to show
// "latest published: vX" indefinitely, not just while it's still "new".
const DISMISSED_FIRMWARE_KEY = "bms-dismissed-firmware-id";
const getDismissedFirmwareId = () => Number(localStorage.getItem(DISMISSED_FIRMWARE_KEY)) || null;
const setDismissedFirmwareId = (id) => localStorage.setItem(DISMISSED_FIRMWARE_KEY, String(id));

/**
 * Single Socket.IO connection per session, replacing every hook's own
 * direct Firebase client SDK subscription. The backend (realtime.js) has
 * already filtered this to only the hub_id(s) this session's role/email is
 * allowed to see - the frontend never asks Firebase for anything itself
 * anymore, so there is no client-side path to reach another user's hub.
 */
export function HubDataProvider({ children }) {
  const { isAuthenticated } = useAuth();
  const [hubs, setHubs] = useState({});
  const [socketConnected, setSocketConnected] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [announcement, setAnnouncement] = useState(null);
  const [firmwareRelease, setFirmwareRelease] = useState(null);
  const [dismissedFirmwareId, setDismissedFirmwareIdState] = useState(() => getDismissedFirmwareId());
  const socketRef = useRef(null);

  useEffect(() => {
    if (!isAuthenticated) {
      setHubs({});
      setLoaded(false);
      setSocketConnected(false);
      setAnnouncement(null);
      setFirmwareRelease(null);
      return;
    }

    // Catch-up fetch for a dashboard that loads shortly after an admin
    // broadcast rather than being live-connected at send-time (see
    // server/routes/announcements.js's STALE_AFTER_MS window).
    api.latestAnnouncement().then((r) => {
      if (r.announcement && r.announcement.id !== getDismissedId()) setAnnouncement(r.announcement);
    }).catch(() => {});

    // Same catch-up idea for the latest admin-published firmware release
    // (see server/routes/firmware.js) - unlike announcements this has no
    // staleness window, since "what's the latest firmware" doesn't go
    // stale the way a one-off text notice does.
    api.latestFirmware().then((r) => {
      if (r.release) setFirmwareRelease(r.release);
    }).catch(() => {});

    // Empty string means same-origin production build (see apiClient.js) -
    // socket.io-client wants that expressed as "connect with no URL argument
    // at all", not a literal empty string.
    const socket = io(API_BASE_URL || undefined, { withCredentials: true });
    socketRef.current = socket;

    socket.on("connect", () => setSocketConnected(true));
    socket.on("disconnect", () => setSocketConnected(false));

    // Admin broadcast ("แจ้ง Update") - only user-role sockets are in the
    // "role:user" room server-side (see realtime.js), so this only ever
    // fires for sessions that actually render the Dashboard banner.
    socket.on("announcement", (a) => setAnnouncement(a));
    socket.on("firmware:release", (release) => setFirmwareRelease(release));

    // Admin sessions get the whole tree in one shot on every change.
    socket.on("hubs:all", (all) => {
      setHubs(all ?? {});
      setLoaded(true);
    });

    // Non-admin sessions get one hub at a time, upserted into local state -
    // never a full replace, so one hub's update can't clobber another's.
    socket.on("hub:update", ({ hubId, data }) => {
      setHubs((prev) => {
        const next = { ...prev };
        if (data == null) delete next[hubId];
        else next[hubId] = data;
        return next;
      });
      setLoaded(true);
    });

    // Sent immediately on connect so an account with zero linked hubs still
    // flips "loaded" instead of spinning forever waiting for a hub:update
    // that will never come.
    socket.on("hubs:list", () => setLoaded(true));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [isAuthenticated]);

  function dismissAnnouncement() {
    if (announcement) setDismissedId(announcement.id);
    setAnnouncement(null);
  }

  // "Update" on either the auto-popup or the badge's check-for-update
  // modal - acknowledge-only, per explicit instruction: nothing here ever
  // reaches a physical ESP32, there's no OTA transport in this app.
  function acknowledgeFirmwareRelease() {
    if (!firmwareRelease) return;
    setDismissedFirmwareId(firmwareRelease.id);
    setDismissedFirmwareIdState(firmwareRelease.id);
  }
  const firmwareIsNew = firmwareRelease != null && firmwareRelease.id !== dismissedFirmwareId;

  return (
    <HubDataContext.Provider
      value={{
        hubs,
        socketConnected,
        loaded,
        announcement,
        dismissAnnouncement,
        firmwareRelease,
        firmwareIsNew,
        acknowledgeFirmwareRelease,
      }}
    >
      {children}
    </HubDataContext.Provider>
  );
}

export function useHubData() {
  const ctx = useContext(HubDataContext);
  if (!ctx) throw new Error("useHubData must be used inside HubDataProvider");
  return ctx;
}
