// Dev (two separate Vite/Express ports) needs an absolute URL; a production
// build is served from the same origin as the API (see server/index.js's
// express.static), so relative paths just work and "" is correct there.
const API_BASE = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? "" : "http://localhost:10000");

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
  saveHubLocation: (hubId, { name, lat, lng }) =>
    request(`/api/hubs/${encodeURIComponent(hubId)}/location`, {
      method: "PATCH",
      body: JSON.stringify({ name, lat, lng }),
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
  // Raw-body upload, not JSON - can't go through request()'s
  // Content-Type: application/json + JSON.stringify(body) default.
  // `targets` (optional) is the list of {hubId, bmsKey} devices whose own
  // Firebase firmware node should get this release + update_flag=true, for
  // the ESP32-side ota_updater component to pick up - see
  // server/routes/firmware.js.
  uploadFirmware: async (version, filename, file, { releaseNotes, targets } = {}) => {
    const params = new URLSearchParams({ version, filename });
    if (releaseNotes) params.set("releaseNotes", releaseNotes);
    if (targets && targets.length > 0) params.set("targets", JSON.stringify(targets));
    const res = await fetch(`${API_BASE}/api/firmware?${params.toString()}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
  },
  latestFirmware: () => request("/api/firmware/latest"),
  firmwareDownloadUrl: (id) => `${API_BASE}/api/firmware/${id}/download`,
  // Real OTA trigger - PATCHes update_flag=true at this device's own
  // Firebase firmware node (server/routes/hubs.js). This is what the "มี
  // อัปเดตใหม่" button actually does now, distinct from
  // acknowledgeFirmwareRelease() (HubDataContext.jsx), which only dismisses
  // the web notification and touches nothing in Firebase.
  triggerFirmwareUpdate: (hubId, bmsKey) =>
    request(`/api/hubs/${encodeURIComponent(hubId)}/firmware/trigger-update`, {
      method: "PATCH",
      body: JSON.stringify({ bmsKey }),
    }),
  // Self-service sign-ups waiting on admin approval (server/routes/admin.js) -
  // see Login.jsx's "pending" step and AdminMonitor's Pending Sign-ups panel.
  pendingSignups: () => request("/api/admin/pending-signups"),
  approvePendingSignup: (email) =>
    request(`/api/admin/pending-signups/${encodeURIComponent(email)}/approve`, { method: "POST" }),
  rejectPendingSignup: (email) =>
    request(`/api/admin/pending-signups/${encodeURIComponent(email)}`, { method: "DELETE" }),
};

export const API_BASE_URL = API_BASE;
