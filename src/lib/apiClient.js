// Dev (two separate Vite/Express ports) needs an absolute URL; a production
// build is served from the same origin as the API (see server/index.js's
// express.static), so relative paths just work and "" is correct there.
const API_BASE = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? "" : "http://localhost:4000");

// credentials: "include" on every call - the session lives in an httpOnly
// cookie set by the backend, never in JS-readable storage (no localStorage
// token to steal via XSS).
async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return body;
}

export const api = {
  checkEmail: (email) => request("/api/auth/check-email", { method: "POST", body: JSON.stringify({ email }) }),
  login: (email, password) => request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  adminExists: () => request("/api/auth/admin-exists"),
  adminLogin: (password) => request("/api/auth/admin-login", { method: "POST", body: JSON.stringify({ password }) }),
  registerAdmin: (email, password) =>
    request("/api/auth/register-admin", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  me: () => request("/api/auth/me"),
  hubs: () => request("/api/hubs"),
  saveSetting: (hubId, bmsKey, key, value) =>
    request(`/api/hubs/${encodeURIComponent(hubId)}/settings`, {
      method: "PATCH",
      body: JSON.stringify({ bmsKey, key, value }),
    }),
  saveDeviceName: (hubId, bmsKey, name) =>
    request(`/api/hubs/${encodeURIComponent(hubId)}/device-name`, {
      method: "PATCH",
      body: JSON.stringify({ bmsKey, name }),
    }),
  setDeviceEnabled: (hubId, bmsKey, enabled) =>
    request("/api/admin/hub-device/enabled", { method: "PATCH", body: JSON.stringify({ hubId, bmsKey, enabled }) }),
  setDeviceExpiration: (hubId, bmsKey, expirationDate) =>
    request("/api/admin/hub-device/expiration", {
      method: "PATCH",
      body: JSON.stringify({ hubId, bmsKey, expirationDate }),
    }),
  historyDaily: (hubId, bmsKey, date) =>
    request(`/api/hubs/${encodeURIComponent(hubId)}/history/daily?date=${date}&bmsKey=${encodeURIComponent(bmsKey ?? "")}`),
  historyMonthly: (hubId, bmsKey, month) =>
    request(`/api/hubs/${encodeURIComponent(hubId)}/history/monthly?month=${month}&bmsKey=${encodeURIComponent(bmsKey ?? "")}`),
  historyYearly: (hubId, bmsKey, year) =>
    request(`/api/hubs/${encodeURIComponent(hubId)}/history/yearly?year=${year}&bmsKey=${encodeURIComponent(bmsKey ?? "")}`),
  sendAnnouncement: (message, category) =>
    request("/api/announcements", { method: "POST", body: JSON.stringify({ message, category }) }),
  latestAnnouncement: () => request("/api/announcements/latest"),
};

export const API_BASE_URL = API_BASE;
