import { isBmsShaped } from "./bmsShape.js";

// Walks a "JK_BMS_HUB/{hubId}[/{bmsKey}]" path string against the already
// role-filtered `hubs` tree from HubDataContext - lets read-only debug/status
// views (LiveDebugPanel, AdminStatusPreview) resolve a specific device's data
// without opening their own Firebase subscription.
export function resolveHubPath(hubs, path) {
  const parts = String(path ?? "")
    .split("/")
    .filter(Boolean);
  if (parts[0] !== "JK_BMS_HUB") return undefined;
  let node = hubs;
  for (const part of parts.slice(1)) {
    if (node == null) return undefined;
    node = node[part];
  }
  return node;
}

// Turns the { [hubId]: hubData } tree (as delivered by the backend's
// role-filtered hub payload) into a flat list of individual BMS devices -
// handles both real shapes seen live: nested (hubId is an account, each
// child key is one physical BMS with its own {info,status,settings}) and
// flat (hubId itself IS the one device, no nesting - the shape "BMS 1" used
// before the account-hub existed). Shared by every hook that needs to walk
// hub data so they all agree on device discovery.
export function flattenHubs(hubs) {
  const out = [];
  for (const [hubId, hubData] of Object.entries(hubs ?? {})) {
    const bmsEntries = Object.entries(hubData ?? {}).filter(([, v]) => isBmsShaped(v));
    if (bmsEntries.length > 0) {
      for (const [bmsKey, bmsData] of bmsEntries) {
        out.push({ hubId, bmsKey, path: `JK_BMS_HUB/${hubId}/${bmsKey}`, data: bmsData });
      }
    } else if (isBmsShaped(hubData)) {
      out.push({ hubId, bmsKey: null, path: `JK_BMS_HUB/${hubId}`, data: hubData });
    }
  }
  return out;
}
