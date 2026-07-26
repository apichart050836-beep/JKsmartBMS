import { useEffect, useState } from "react";
import { api } from "../lib/apiClient.js";

// Bangkok never observes DST, so this fixed offset always matches the
// server's own day-boundary math (server/routes/history.js) - computed
// client-side rather than trusting the browser's local timezone, since
// "today" must mean the same calendar day on both ends regardless of where
// the browser happens to be.
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
function bangkokDateStr(d = new Date()) {
  const bkk = new Date(d.getTime() + BANGKOK_OFFSET_MS);
  return `${bkk.getUTCFullYear()}-${String(bkk.getUTCMonth() + 1).padStart(2, "0")}-${String(bkk.getUTCDate()).padStart(2, "0")}`;
}

const POLL_MS = 60_000;
const EMPTY = { chargedAh: 0, dischargedAh: 0, chargedWh: 0, dischargedWh: 0 };

// Real today's-so-far charged/discharged Ah & Wh, derived server-side from
// actual telemetry_log rows (V x I x t using the real signed charge_current
// field) - not the Firebase dailyChargeAh/dailyDischargeAh fields, which
// don't exist on any real device and always read 0.
export function useDailyEnergy(hubId, bmsKey) {
  const [totals, setTotals] = useState(EMPTY);

  useEffect(() => {
    if (!hubId) {
      setTotals(EMPTY);
      return;
    }
    let cancelled = false;
    function tick() {
      api
        .historyDaily(hubId, bmsKey, bangkokDateStr())
        .then((r) => {
          if (!cancelled && r.totals) setTotals(r.totals);
        })
        .catch(() => {});
    }
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [hubId, bmsKey]);

  return totals;
}
