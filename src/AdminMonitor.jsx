import React, { useState, useEffect } from "react";
import {
  Search,
  Eye,
  Activity,
  Pencil,
  Check,
  X as XIcon,
  Server,
  Radio,
  WifiOff,
  ChevronDown,
  ChevronRight,
  Megaphone,
  UploadCloud,
} from "lucide-react";
import { api } from "./lib/apiClient.js";
import { useAdminHubs } from "./hooks/useAdminHubs.js";
import { Toggle } from "./components/settings/primitives.jsx";
import { Modal } from "./components/Modal.jsx";
import { LiveDebugPanel } from "./components/LiveDebugPanel.jsx";
import { AdminStatusPreview } from "./components/AdminStatusPreview.jsx";
import { AnnounceModal } from "./components/AnnounceModal.jsx";
import { FirmwareUploadModal } from "./components/FirmwareUploadModal.jsx";

const EXPIRING_WITHIN_DAYS = 14;
const FILTERS = [
  { id: "all", label: "ทั้งหมด" },
  { id: "online", label: "Online" },
  { id: "offline", label: "Offline" },
  { id: "expiring", label: "ใกล้หมดอายุ" },
];

// Days remaining until an "YYYY-MM-DD" expiration date, or null if unset/invalid.
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  return Math.ceil((target.getTime() - Date.now()) / 86_400_000);
}

function KpiCard({ icon: Icon, label, value, tone = "zinc" }) {
  const toneClasses = {
    zinc: "bg-[var(--muted)] text-[var(--muted-foreground)]",
    emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400",
    rose: "bg-rose-50 text-rose-500 dark:bg-rose-950/40 dark:text-rose-400",
  }[tone];
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-[var(--card)] p-4 shadow-sm ring-1 ring-[var(--border)]">
      <span className={`flex size-9 items-center justify-center rounded-xl ${toneClasses}`}>
        <Icon className="size-4" />
      </span>
      <div>
        <p className="text-lg font-bold leading-tight text-[var(--foreground)]">{value}</p>
        <p className="text-[11px] text-[var(--muted-foreground)]">{label}</p>
      </div>
    </div>
  );
}

function StatusDot({ isOnline }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`size-2.5 rounded-full ${isOnline ? "animate-pulse bg-emerald-500" : "bg-[var(--muted-foreground)]/40"}`} />
      <span className={`text-xs font-medium ${isOnline ? "text-emerald-600 dark:text-emerald-400" : "text-[var(--muted-foreground)]"}`}>
        {isOnline ? "Online" : "Offline"}
      </span>
    </span>
  );
}

// Inline "Edit/Save" cell for the admin-editable expiration date, plus the
// orange (expiring soon) / red (already expired) warning badge.
function ExpirationCell({ hubId, bmsKey, value }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const days = daysUntil(value);

  function save() {
    api
      .setDeviceExpiration(hubId, bmsKey, draft || null)
      .catch((err) => console.error(`Failed to save expiration date for ${hubId}/${bmsKey}`, err));
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          type="date"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="rounded-lg border border-[var(--border)] bg-[var(--muted)] px-2 py-1 text-xs text-[var(--foreground)] outline-none focus:border-blue-400"
        />
        <button type="button" onClick={save} className="rounded-md p-1 text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40" title="Save">
          <Check className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(value ?? "");
            setEditing(false);
          }}
          className="rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
          title="Cancel"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-[var(--foreground)]">{value || "—"}</span>
      {days !== null && days < 0 && (
        <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-600 dark:bg-red-950/40 dark:text-red-400">Expired</span>
      )}
      {days !== null && days >= 0 && days <= EXPIRING_WITHIN_DAYS && (
        <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-semibold text-orange-600 dark:bg-orange-950/40 dark:text-orange-400">
          {days}d left
        </span>
      )}
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
        title="Edit expiration date"
      >
        <Pencil className="size-3.5" />
      </button>
    </div>
  );
}

// Admin kill switch for the Dashboard, NOT charge/discharge control (that
// stays in BMSDashboard's Configuration panel, wired separately). Flipping
// this off writes admin/enabled = false, which useBmsPackLive.js checks on
// every snapshot and, when off, stops absorbing new telemetry into the
// dashboard entirely - not just a badge while data keeps flowing underneath.
function EnabledToggle({ hubId, bmsKey, enabled }) {
  function toggle(next) {
    api.setDeviceEnabled(hubId, bmsKey, next).catch((err) => console.error(`Failed to set enabled for ${hubId}/${bmsKey}`, err));
  }

  // useAdminHubs always resolves this to true/false (defaults to enabled)
  // for both hub shapes - null is just a defensive fallback in case some
  // future shape genuinely has no admin/enabled field to read at all.
  // Disabled + honest beats a control that silently does nothing.
  if (enabled === null) {
    return (
      <span title="No enabled/disabled field defined for this device shape yet">
        <Toggle checked={false} onChange={() => {}} disabled />
      </span>
    );
  }

  return <Toggle checked={enabled} onChange={toggle} />;
}

// One row per hub/account, collapsed by default - shows the device count
// and an aggregate online tally instead of every device inline. Click to
// expand and see the actual per-device rows underneath.
function HubSummaryRow({ hubId, devices, expanded, onToggle }) {
  const onlineCount = devices.filter((d) => d.isOnline).length;
  return (
    <tr
      className="cursor-pointer border-b border-[var(--border)] bg-[var(--muted)]/40 hover:bg-[var(--muted)]/70"
      onClick={onToggle}
    >
      <td className="py-3 pl-5 pr-3" colSpan={6}>
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="size-4 shrink-0 text-[var(--muted-foreground)]" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-[var(--muted-foreground)]" />
          )}
          <span className="font-mono text-xs text-[var(--muted-foreground)]">{hubId}</span>
          <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-[10px] font-semibold text-[var(--foreground)]">
            {devices.length} device{devices.length === 1 ? "" : "s"}
          </span>
          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{onlineCount} Online</span>
          {onlineCount < devices.length && (
            <span className="text-xs font-medium text-[var(--muted-foreground)]">{devices.length - onlineCount} Offline</span>
          )}
        </div>
      </td>
      <td className="py-3 pl-3 pr-5" />
    </tr>
  );
}

function DeviceRow({ row, onViewDetails, onViewStatus }) {
  return (
    <tr className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--muted)]/50">
      <td className="py-3 pl-9 pr-3 font-mono text-xs text-[var(--muted-foreground)]">↳</td>
      <td className="px-3 py-3 text-sm font-bold text-[var(--foreground)]">{row.label}</td>
      <td className="px-3 py-3">
        <StatusDot isOnline={row.isOnline} />
      </td>
      <td className="px-3 py-3 text-sm text-[var(--muted-foreground)]">
        {row.firmwareVersion || "—"}
        {/* No OTA-availability signal exists anywhere in Firebase yet - not
            fabricating one, this column just shows the reported version. */}
      </td>
      <td className="px-3 py-3 text-sm text-[var(--muted-foreground)]">{row.buildDate || "—"}</td>
      <td className="px-3 py-3">
        <ExpirationCell hubId={row.hubId} bmsKey={row.bmsKey} value={row.expireDate} />
      </td>
      <td className="py-3 pl-3 pr-5">
        <div className="flex items-center justify-end gap-3">
          <EnabledToggle hubId={row.hubId} bmsKey={row.bmsKey} enabled={row.enabled} />
          <button
            type="button"
            onClick={() => onViewStatus(row.settingsPathBase, row.label)}
            className="rounded-lg border border-[var(--border)] p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
            title="View status summary"
          >
            <Activity className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => onViewDetails(row.settingsPathBase)}
            className="rounded-lg border border-[var(--border)] p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
            title="View configuration / raw data"
          >
            <Eye className="size-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

/**
 * Admin Monitor / Fleet Management: dynamic view across every hub (and every
 * BMS nested under it) found live under JK_BMS_HUB - see useAdminHubs.js for
 * how flat hubs (what's real today) and nested multi-BMS hubs (the shape
 * described for future fleets, HUB_ID possibly an email) are both detected
 * and rendered as rows, no hardcoded device list.
 *
 * "Configuration" opens a raw JSON viewer (LiveDebugPanel) scoped to that
 * exact row's node rather than the full editable Settings UI - that panel's
 * write path is hardcoded to BMS_FLEET's one configured hub in
 * BMSDashboard.jsx today, so it can't yet target an arbitrary hub/bms pair.
 */
export default function AdminMonitor() {
  const { rows } = useAdminHubs();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [detailPath, setDetailPath] = useState(null);
  const [statusView, setStatusView] = useState(null); // { path, label }
  const [expandedHubs, setExpandedHubs] = useState(() => new Set());
  const [showAnnounce, setShowAnnounce] = useState(false);
  const [showFirmwareUpload, setShowFirmwareUpload] = useState(false);
  const [latestRelease, setLatestRelease] = useState(null);

  useEffect(() => {
    api.latestFirmware().then((r) => setLatestRelease(r.release)).catch(() => {});
    // Re-check after the upload modal closes, in case a new one just went out.
  }, [showFirmwareUpload]);

  const filteredRows = rows.filter((row) => {
    const needle = search.trim().toLowerCase();
    if (needle) {
      const matches = row.hubId.toLowerCase().includes(needle) || row.label.toLowerCase().includes(needle);
      if (!matches) return false;
    }
    if (filter === "online") return row.isOnline;
    if (filter === "offline") return !row.isOnline;
    if (filter === "expiring") {
      const days = daysUntil(row.expireDate);
      return days !== null && days <= EXPIRING_WITHIN_DAYS;
    }
    return true;
  });

  // One summary row per hub, with its matching devices nested underneath -
  // order preserved from the filtered list so search/filter results stay
  // grouped sensibly rather than re-sorted.
  const hubGroups = [];
  const hubIndex = new Map();
  for (const row of filteredRows) {
    if (!hubIndex.has(row.hubId)) {
      hubIndex.set(row.hubId, { hubId: row.hubId, devices: [] });
      hubGroups.push(hubIndex.get(row.hubId));
    }
    hubIndex.get(row.hubId).devices.push(row);
  }

  function toggleHub(hubId) {
    setExpandedHubs((prev) => {
      const next = new Set(prev);
      if (next.has(hubId)) next.delete(hubId);
      else next.add(hubId);
      return next;
    });
  }

  const totalHubs = new Set(rows.map((r) => r.hubId)).size;
  const totalBms = rows.length;
  const onlineCount = rows.filter((r) => r.isOnline).length;

  return (
    <div className="mx-auto max-w-6xl px-3 py-4 sm:px-5 sm:py-6 md:px-7">
      <div className="mb-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setShowFirmwareUpload(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-[var(--card)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] shadow-sm ring-1 ring-[var(--border)] transition-all hover:bg-[var(--muted)] active:scale-95"
        >
          <UploadCloud className="size-4" />
          ESP32 Firmware Update
        </button>
        <button
          type="button"
          onClick={() => setShowAnnounce(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:opacity-90 active:scale-95"
        >
          <Megaphone className="size-4" />
          แจ้ง Update
        </button>
      </div>

      {/* Fleet Overview KPI cards */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard icon={Server} label="Total HUBs" value={totalHubs} />
        <KpiCard icon={Server} label="Total BMS" value={totalBms} />
        <KpiCard icon={Radio} label="Online" value={onlineCount} tone="emerald" />
        <KpiCard icon={WifiOff} label="Offline" value={totalBms - onlineCount} tone="rose" />
      </div>

      <div className="overflow-hidden rounded-2xl bg-[var(--card)] shadow-sm ring-1 ring-[var(--border)]">
        {/* Search + filter toolbar */}
        <div className="flex flex-col gap-3 border-b border-[var(--border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--muted)] px-3 py-2 sm:max-w-xs">
            <Search className="size-4 text-[var(--muted-foreground)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหา HUB ID, Email หรือ BMS ID..."
              className="w-full bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
            />
          </div>
          <div className="inline-flex items-center gap-1 rounded-xl bg-[var(--muted)] p-1">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  filter === f.id ? "bg-[var(--card)] text-blue-600 shadow-sm dark:text-blue-400" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Device list */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                <th className="py-2.5 pl-5 pr-3">HUB / Account ID</th>
                <th className="px-3 py-2.5">BMS Device</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">ESP Firmware</th>
                <th className="px-3 py-2.5">Build Date</th>
                <th className="px-3 py-2.5">Expiration Date</th>
                <th className="py-2.5 pl-3 pr-5 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {hubGroups.map(({ hubId, devices }) => {
                const expanded = expandedHubs.has(hubId);
                return (
                  <React.Fragment key={hubId}>
                    <HubSummaryRow hubId={hubId} devices={devices} expanded={expanded} onToggle={() => toggleHub(hubId)} />
                    {expanded &&
                      devices.map((row) => (
                        <DeviceRow
                          key={`${row.hubId}/${row.bmsKey ?? "_"}`}
                          row={row}
                          onViewDetails={setDetailPath}
                          onViewStatus={(path, label) => setStatusView({ path, label })}
                        />
                      ))}
                  </React.Fragment>
                );
              })}
              {hubGroups.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-sm text-[var(--muted-foreground)]">
                    {rows.length === 0 ? "ยังไม่พบอุปกรณ์ใต้ JK_BMS_HUB" : "ไม่พบอุปกรณ์ที่ตรงกับการค้นหา/ตัวกรอง"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={!!detailPath} onClose={() => setDetailPath(null)} title={`Device Details · ${detailPath}`} maxWidthClass="max-w-2xl">
        {detailPath && <LiveDebugPanel path={detailPath} />}
      </Modal>

      <Modal open={!!statusView} onClose={() => setStatusView(null)} title={`Status · ${statusView?.label ?? ""}`} maxWidthClass="max-w-md">
        {statusView && <AdminStatusPreview path={statusView.path} />}
      </Modal>

      <Modal open={showAnnounce} onClose={() => setShowAnnounce(false)} title="แจ้ง Update" maxWidthClass="max-w-md">
        <AnnounceModal onClose={() => setShowAnnounce(false)} />
      </Modal>

      <Modal open={showFirmwareUpload} onClose={() => setShowFirmwareUpload(false)} title="ESP32 Firmware Update" maxWidthClass="max-w-md">
        <FirmwareUploadModal onClose={() => setShowFirmwareUpload(false)} currentRelease={latestRelease} />
      </Modal>
    </div>
  );
}
