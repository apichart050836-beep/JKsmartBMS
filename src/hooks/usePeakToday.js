import { useEffect, useState } from "react";
import { api } from "../lib/apiClient.js";

const POLL_MS = 60_000;
const EMPTY = { peakCharge: null, peakDischarge: null };

// Real fleet-wide (every device under this hub) peak charge/discharge power
// today, derived server-side from actual telemetry_log rows - see
// server/routes/history.js's /history/peak-today. Each of peakCharge/
// peakDischarge is either null (nothing in that direction yet today) or
// { power, ts }.
export function usePeakToday(hubId) {
  const [peaks, setPeaks] = useState(EMPTY);

  useEffect(() => {
    if (!hubId) {
      setPeaks(EMPTY);
      return;
    }
    let cancelled = false;
    function tick() {
      api
        .historyPeakToday(hubId)
        .then((r) => !cancelled && setPeaks({ peakCharge: r.peakCharge ?? null, peakDischarge: r.peakDischarge ?? null }))
        .catch(() => {});
    }
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [hubId]);

  return peaks;
}
