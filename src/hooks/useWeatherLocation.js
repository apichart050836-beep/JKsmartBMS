import { useState, useCallback, useEffect } from "react";
import * as geo from "../lib/geolocation.js";
import { fetchWeather } from "../lib/weatherService.js";

const ERROR_MESSAGES = {
  PERMISSION_DENIED: "กรุณาเปิด Location เพื่อใช้งานฟังก์ชันนี้",
  POSITION_UNAVAILABLE: "ไม่สามารถระบุตำแหน่งได้",
  UNSUPPORTED: "เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง",
  NO_API_KEY: "ยังไม่ได้ตั้งค่า Weather API key",
  API_ERROR: "โหลดข้อมูลสภาพอากาศไม่สำเร็จ",
};

/**
 * Combines geolocation.js (permission/position/storage) and
 * weatherService.js (the actual API call) into the state a weather button +
 * modal need: first-visit permission prompt, silent auto-detect once
 * already granted, "you've moved" notice, loading/error states.
 */
export function useWeatherLocation() {
  const [showPermissionPrompt, setShowPermissionPrompt] = useState(false);
  const [location, setLocation] = useState(() => geo.getStoredLocation());
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [movedNotice, setMovedNotice] = useState(false);

  const detectLocation = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pos = await geo.getCurrentPosition();
      const previous = geo.getStoredLocation();
      if (geo.hasMovedSignificantly(previous, pos)) {
        setMovedNotice(true);
      }
      const stored = geo.storeLocation(pos);
      setLocation(stored);
      geo.markAsked();
      setShowPermissionPrompt(false);
      return stored;
    } catch (err) {
      setError(ERROR_MESSAGES[err.message] ?? ERROR_MESSAGES.POSITION_UNAVAILABLE);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const loadWeather = useCallback(async (targetLocation) => {
    const loc = targetLocation ?? geo.getStoredLocation();
    if (!loc) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchWeather(loc.latitude, loc.longitude);
      setWeather(data);
    } catch (err) {
      setError(ERROR_MESSAGES[err.message] ?? ERROR_MESSAGES.API_ERROR);
    } finally {
      setLoading(false);
    }
  }, []);

  // On mount: already granted -> detect silently, no prompt. Never asked
  // before -> show the permission prompt once. Previously denied/dismissed
  // -> do nothing until the user opens the weather button themselves.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const state = await geo.getPermissionState();
      if (cancelled) return;
      if (state === "granted") {
        detectLocation().catch(() => {});
      } else if (state === "prompt" && !geo.hasAskedBefore()) {
        setShowPermissionPrompt(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function dismissPermissionPrompt() {
    geo.markAsked();
    setShowPermissionPrompt(false);
  }

  function dismissMovedNotice() {
    setMovedNotice(false);
  }

  async function openWeather() {
    let loc = location;
    if (!loc) {
      try {
        loc = await detectLocation();
      } catch {
        return;
      }
    }
    loadWeather(loc);
  }

  async function updateLocationNow() {
    setMovedNotice(false);
    try {
      const loc = await detectLocation();
      loadWeather(loc);
    } catch {
      // error state already set by detectLocation
    }
  }

  return {
    showPermissionPrompt,
    detectLocation,
    dismissPermissionPrompt,
    location,
    weather,
    loading,
    error,
    openWeather,
    movedNotice,
    dismissMovedNotice,
    updateLocationNow,
  };
}
