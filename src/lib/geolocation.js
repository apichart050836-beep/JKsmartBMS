// One-shot GPS capture for the Installation Location setup modal - used
// only when the user explicitly presses "ใช้ GPS ปัจจุบัน" during first-time
// setup or Settings > Change Installation Location. Never runs
// automatically and nothing here persists anything - the coordinate the
// user confirms is written straight to the saved installation location
// (Firebase, one per hub), not to this device's local storage. That's the
// whole point: the dashboard must show the same installation weather
// regardless of which device/browser opens it, never "wherever the current
// viewer happens to be standing."
export function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("UNSUPPORTED"));
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
        if (err.code === err.PERMISSION_DENIED) reject(new Error("PERMISSION_DENIED"));
        else reject(new Error("POSITION_UNAVAILABLE"));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}
