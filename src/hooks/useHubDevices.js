import { useMemo } from "react";
import { useHubData } from "../context/HubDataContext.jsx";
import { flattenHubs } from "../lib/flattenHubs.js";

/**
 * Every BMS device visible to this session, across every hub the backend
 * has already filtered in (role=admin -> all hubs, role=user -> only the
 * hub linked to their account) - used by BMSDashboard to build its BMS
 * tabs dynamically instead of a hardcoded per-device/per-hub list. Sorted
 * for a stable order, so "BMS 1" always refers to the same physical unit
 * between reloads rather than whatever order the socket happens to deliver
 * hubs in.
 *
 * `loaded` distinguishes "still waiting on the first snapshot" from
 * "loaded, but genuinely zero devices" - both look like an empty array
 * otherwise, and the dashboard needs to tell them apart (loading spinner
 * vs. "no devices found" message).
 */
export function useHubDevices() {
  const { hubs, loaded } = useHubData();

  const devices = useMemo(() => {
    return flattenHubs(hubs)
      .map(({ hubId, bmsKey }) => ({ hubId, bmsKey }))
      .sort((a, b) => {
        if (a.hubId !== b.hubId) return a.hubId < b.hubId ? -1 : 1;
        return (a.bmsKey ?? "") < (b.bmsKey ?? "") ? -1 : 1;
      });
  }, [hubs]);

  return { devices, loaded };
}
