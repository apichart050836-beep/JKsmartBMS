import React, { useState, useEffect } from "react";
import * as geo from "../lib/geolocation.js";
import { searchLocations, reverseGeocode } from "../lib/weatherService.js";

const GPS_ERROR_MESSAGES = {
  PERMISSION_DENIED: "กรุณาเปิด Location เพื่อใช้งานฟังก์ชันนี้",
  UNSUPPORTED: "เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง",
  POSITION_UNAVAILABLE: "ไม่สามารถระบุตำแหน่งได้",
};

/**
 * Set/change the BMS/solar installation's fixed location - shown on first
 * weather open (no saved location yet) or from Settings > Change
 * Installation Location. Two ways to pick a point: one-shot GPS capture, or
 * search a place name (OpenWeatherMap Geocoding API) - deliberately no
 * live/interactive map, a text search is faster for this and needs no extra
 * mapping dependency. Saving always goes through onSave (Firebase, one per
 * hub) - nothing here is written to this device's own storage.
 */
export function InstallationLocationModal({ open, initialLocation, onSave, onClose, saving }) {
  const [name, setName] = useState("");
  const [lat, setLat] = useState(null);
  const [lng, setLng] = useState(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Start each open from whatever's currently saved (editing) or blank
  // (first-time setup) - not whatever was left over from the last time this
  // modal happened to be open.
  useEffect(() => {
    if (!open) return;
    setName(initialLocation?.name ?? "");
    setLat(initialLocation?.lat ?? null);
    setLng(initialLocation?.lng ?? null);
    setQuery("");
    setResults([]);
    setError(null);
  }, [open, initialLocation]);

  if (!open) return null;

  async function handleUseGps() {
    setGpsLoading(true);
    setError(null);
    try {
      const pos = await geo.getCurrentPosition();
      setLat(pos.latitude);
      setLng(pos.longitude);
      const placeName = await reverseGeocode(pos.latitude, pos.longitude).catch(() => null);
      setName(placeName ?? `${pos.latitude.toFixed(4)}, ${pos.longitude.toFixed(4)}`);
      setResults([]);
    } catch (err) {
      setError(GPS_ERROR_MESSAGES[err.message] ?? GPS_ERROR_MESSAGES.POSITION_UNAVAILABLE);
    } finally {
      setGpsLoading(false);
    }
  }

  async function handleSearch() {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const r = await searchLocations(query);
      setResults(r);
      if (r.length === 0) setError("ไม่พบสถานที่นี้ ลองพิมพ์ชื่อจังหวัด/เมืองอื่น");
    } catch {
      setError("ค้นหาไม่สำเร็จ");
    } finally {
      setSearching(false);
    }
  }

  function pickResult(r) {
    setName(r.name);
    setLat(r.lat);
    setLng(r.lng);
    setResults([]);
    setQuery("");
    setError(null);
  }

  async function handleSave() {
    if (lat == null || lng == null || !name.trim()) {
      setError("กรุณาระบุตำแหน่งก่อนบันทึก");
      return;
    }
    const ok = await onSave({ name: name.trim(), lat, lng });
    if (!ok) setError("บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง");
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm animate-[weather-modal-in_0.3s_ease] rounded-3xl bg-[var(--card)] p-6 shadow-2xl ring-1 ring-[var(--border)]">
        <div className="mb-4 text-center">
          <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-full bg-[var(--brand-10)] text-2xl">📍</div>
          <h3 className="text-base font-bold text-[var(--foreground)]">ตำแหน่งติดตั้งระบบ</h3>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            ใช้แสดงสภาพอากาศของจุดติดตั้งแบตเตอรี่/โซล่าเซลล์ - ไม่ใช่ตำแหน่งมือถือของคุณ
          </p>
        </div>

        <button
          type="button"
          onClick={handleUseGps}
          disabled={gpsLoading}
          className="mb-3 w-full rounded-xl bg-[var(--brand)] py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {gpsLoading ? "กำลังระบุตำแหน่ง..." : "📡 ใช้ GPS ปัจจุบัน"}
        </button>

        <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          <span className="h-px flex-1 bg-[var(--border)]" /> หรือค้นหาชื่อสถานที่{" "}
          <span className="h-px flex-1 bg-[var(--border)]" />
        </div>

        <div className="mb-2 flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="เช่น เชียงใหม่"
            className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--brand)]"
          />
          <button
            type="button"
            onClick={handleSearch}
            disabled={searching}
            className="rounded-lg bg-[var(--muted)] px-3 py-2 text-sm font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--border)] disabled:opacity-50"
          >
            {searching ? "..." : "ค้นหา"}
          </button>
        </div>

        {results.length > 0 && (
          <div className="mb-3 max-h-32 overflow-y-auto rounded-lg border border-[var(--border)]">
            {results.map((r, i) => (
              <button
                key={`${r.lat}-${r.lng}-${i}`}
                type="button"
                onClick={() => pickResult(r)}
                className="block w-full px-3 py-2 text-left text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
              >
                {r.name}
              </button>
            ))}
          </div>
        )}

        {lat != null && lng != null && (
          <div className="mb-3 rounded-xl bg-[var(--muted)] px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">ตำแหน่งที่เลือก</p>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full bg-transparent text-sm font-semibold text-[var(--foreground)] outline-none"
            />
            <p className="mt-0.5 text-[10px] tabular-nums text-[var(--muted-foreground)]">
              {lat.toFixed(4)}, {lng.toFixed(4)}
            </p>
          </div>
        )}

        {error && <p className="mb-3 text-center text-xs text-[var(--critical)]">{error}</p>}

        <div className="flex gap-2">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)]"
            >
              ยกเลิก
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || lat == null}
            className="flex-1 rounded-xl bg-[var(--brand)] py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        </div>
      </div>
      <style>{`
        @keyframes weather-modal-in {
          0% { opacity: 0; transform: scale(0.95) translateY(8px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}
