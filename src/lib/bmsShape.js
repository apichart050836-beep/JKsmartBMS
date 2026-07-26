// A child node under a hub counts as a nested BMS sub-device if it looks
// like either known shape:
// - Real telemetry (confirmed live 2026-07-24, e.g. hub
//   "Suntreehouse287@gmail_com" containing device keys like "C847807A5311"):
//   full {info, status, settings} per device, status/settings are OBJECTS.
// - The simplified shape floated earlier: { status: "online"/"offline",
//   expire_date: "..." } - status is a STRING there instead.
// Shared by useAdminHubs.js (fleet-wide, every hub) and useHubDevices.js
// (one specific hub, for the main Dashboard's BMS tabs) so both agree on
// what counts as a device - a mismatch here previously caused Admin
// Monitor's enabled-toggle to write/read different paths than the Dashboard.
export function isBmsShaped(value) {
  if (!value || typeof value !== "object") return false;
  if (value.status && typeof value.status === "object" && value.settings && typeof value.settings === "object") {
    return true;
  }
  return typeof value.status === "string" || value.expire_date !== undefined;
}
