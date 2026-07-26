import React from "react";

const CHANNELS = [
  { key: "can_protocol", label: "CAN" },
  { key: "uart1_protocol", label: "UART1" },
  { key: "uart2_protocol", label: "UART2" },
  { key: "uart3_protocol", label: "UART3" },
];

function CommRow({ label, value }) {
  const connected = typeof value === "string" && value.trim().length > 0;
  return (
    <div className="flex items-center justify-between rounded-xl bg-[var(--muted)]/60 px-3 py-2.5 ring-1 ring-[var(--border)]">
      <span className="text-sm font-medium text-[var(--foreground)]">{label}</span>
      <span className="flex items-center gap-1.5">
        <span className={`size-2 shrink-0 rounded-full ${connected ? "bg-emerald-500" : "bg-rose-400"}`} />
        <span
          className={`max-w-[160px] truncate text-xs font-semibold ${connected ? "text-emerald-600" : "text-rose-500"}`}
          title={connected ? value : undefined}
        >
          {connected ? value : "N/A"}
        </span>
      </span>
    </div>
  );
}

/**
 * CAN/UART1-3 protocol status. Field names (can_protocol, uart1_protocol,
 * uart2_protocol, uart3_protocol) confirmed from the live Firebase payload -
 * e.g. can_protocol: "Victron_CANbus_BMS_protocol_20170717". There's no
 * separate "is this port currently connected" field anywhere in the data -
 * a configured, non-empty protocol string is the closest real signal this
 * data actually offers for "Connected"; missing/empty shows N/A rather
 * than guessing at a dedicated status field that doesn't exist.
 */
export function CommunicationPanel({ remoteSettings }) {
  const settings = remoteSettings ?? {};
  return (
    <section className="rounded-2xl bg-[var(--card)] p-5 shadow-sm ring-1 ring-[var(--border)] md:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--foreground)]">Communication</h2>
        <span className="text-[10px] text-[var(--muted-foreground)]">CAN / UART protocol status</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {CHANNELS.map((c) => (
          <CommRow key={c.key} label={c.label} value={settings[c.key]} />
        ))}
      </div>
    </section>
  );
}
