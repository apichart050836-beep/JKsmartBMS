import { useEffect, useRef, useState } from "react";
import { api } from "../lib/apiClient.js";

const POLL_MS = 15_000;
const EMPTY = { peakCharge: null, peakDischarge: null };

function mergePeaks(current, incoming) {
  const charge = [current.peakCharge, incoming.peakCharge]
    .filter(Boolean)
    .reduce((best, peak) => (!best || peak.power > best.power ? peak : best), null);
  const discharge = [current.peakDischarge, incoming.peakDischarge]
    .filter(Boolean)
    .reduce((best, peak) => (!best || peak.power < best.power ? peak : best), null);
  return { peakCharge: charge, peakDischarge: discharge };
}

function bangkokDayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// Real fleet-wide (every device under this hub) peak charge/discharge power
// today, derived server-side from actual telemetry_log rows - see
// server/routes/history.js's /history/peak-today. Each of peakCharge/
// peakDischarge is either null (nothing in that direction yet today) or
// { power, ts }.
export function usePeakToday(hubId, livePower, liveCurrent) {
  const [peaks, setPeaks] = useState(EMPTY);
  const dayKeyRef = useRef(bangkokDayKey());

  useEffect(() => {
    if (!hubId) {
      setPeaks(EMPTY);
      return;
    }
    let cancelled = false;
    function tick() {
      api
        .historyPeakToday(hubId)
        .then((r) => {
          if (cancelled) return;
          const next = { peakCharge: r.peakCharge ?? null, peakDischarge: r.peakDischarge ?? null };
          setPeaks((current) => mergePeaks(current, next));
        })
        .catch(() => {});
    }
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [hubId]);

  // The page already receives BMS data live through the socket. Record a
  // new high immediately from that value instead of waiting for the next
  // telemetry-log snapshot/API poll. The server history remains the durable
  // source after a refresh; this is the zero-delay layer for an open page.
  useEffect(() => {
    if (!hubId || !Number.isFinite(livePower) || livePower === 0) return;

    const today = bangkokDayKey();
    if (dayKeyRef.current !== today) {
      dayKeyRef.current = today;
      setPeaks(EMPTY);
    }

    // Sum of all BMS currents at exactly the same live moment as the power
    // high-water mark, so the card never pairs a peak wattage with a current
    // from another pack or another time.
    const livePeak = { power: livePower, current: liveCurrent, ts: Date.now() };
    setPeaks((current) =>
      livePower > 0
        ? mergePeaks(current, { peakCharge: livePeak, peakDischarge: null })
        : mergePeaks(current, { peakCharge: null, peakDischarge: livePeak })
    );
  }, [hubId, livePower]);

  return peaks;
}
