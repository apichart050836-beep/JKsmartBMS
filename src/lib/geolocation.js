// Browser Geolocation wrapper: high-accuracy position requests, localStorage
// persistence (lat/lng/accuracy/timestamp), and "have we moved to a
// meaningfully different place" detection via a plain Haversine distance -
// no third-party geolocation service, just navigator.geolocation.

const LOCATION_KEY = "weather-location";
const ASKED_KEY = "weather-location-asked";
const SIGNIFICANT_DISTANCE_KM = 20;

export function getStoredLocation() {
  try {
    const raw = localStorage.getItem(LOCATION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function storeLocation({ latitude, longitude, accuracy }) {
  const record = { latitude, longitude, accuracy, timestamp: Date.now() };
  try {
    localStorage.setItem(LOCATION_KEY, JSON.stringify(record));
  } catch {
    // Storage unavailable (private mode, quota) - the session still works,
    // it just re-detects location every visit instead of remembering it.
  }
  return record;
}

export function hasAskedBefore() {
  try {
    return localStorage.getItem(ASKED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markAsked() {
  try {
    localStorage.setItem(ASKED_KEY, "1");
  } catch {
    // no-op
  }
}

// "granted" | "denied" | "prompt" - falls back to "prompt" on browsers
// without the Permissions API (still fully functional, just can't
// pre-check silently before asking).
export async function getPermissionState() {
  if (navigator.permissions?.query) {
    try {
      const status = await navigator.permissions.query({ name: "geolocation" });
      return status.state;
    } catch {
      return "prompt";
    }
  }
  return "prompt";
}

const ERROR_CODES = {
  PERMISSION_DENIED: "PERMISSION_DENIED",
  POSITION_UNAVAILABLE: "POSITION_UNAVAILABLE",
  TIMEOUT: "POSITION_UNAVAILABLE",
  UNSUPPORTED: "UNSUPPORTED",
};

export function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error(ERROR_CODES.UNSUPPORTED));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) reject(new Error(ERROR_CODES.PERMISSION_DENIED));
        else reject(new Error(ERROR_CODES.POSITION_UNAVAILABLE));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}

// Haversine great-circle distance in km.
export function distanceKm(a, b) {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function hasMovedSignificantly(previous, current) {
  if (!previous || !current) return false;
  return distanceKm(previous, current) > SIGNIFICANT_DISTANCE_KM;
}
