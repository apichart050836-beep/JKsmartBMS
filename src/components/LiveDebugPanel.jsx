import React from "react";
import { useHubData } from "../context/HubDataContext.jsx";
import { resolveHubPath } from "../lib/flattenHubs.js";

/**
 * Raw data dump for a device, for the Admin Monitor "eye" button. Reads out
 * of HubDataContext's already-fetched, backend-filtered tree (no separate
 * Firebase subscription of its own) - only reachable by an admin session in
 * the first place, since this panel only ever renders inside AdminMonitor.
 */
export function LiveDebugPanel({ path }) {
  const { hubs, loaded } = useHubData();
  const data = resolveHubPath(hubs, path);

  return (
    <div>
      <p className="mb-3 text-xs text-[var(--muted-foreground)]">
        Raw data at <code className="rounded bg-[var(--muted)] px-1 py-0.5">{path}</code>
      </p>
      {!loaded && <p className="text-sm text-[var(--muted-foreground)]">Connecting...</p>}
      {loaded && data == null && (
        <p className="text-sm text-[var(--warning)]">
          Connected, but this path returned nothing. Double-check the path matches what the ESP32 writes to.
        </p>
      )}
      {data != null && (
        <pre className="max-h-[60vh] overflow-auto rounded-xl bg-[var(--muted)] p-4 text-xs text-[var(--foreground)]">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}
