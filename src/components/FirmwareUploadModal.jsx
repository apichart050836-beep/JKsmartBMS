import React, { useEffect, useMemo, useRef, useState } from "react";
import { UploadCloud, CheckCircle2, XCircle } from "lucide-react";
import { api } from "../lib/apiClient.js";

/**
 * Admin's "Firmware Update" panel. Publishing now does two real things (not
 * just the DB-backed web notification described below):
 *   1. Commits the .bin to the GitHub repo (server/gitStorage.js, unchanged)
 *      and gets back its real raw.githubusercontent.com URL.
 *   2. For every device checked below, PUBLISHES {latest_version, url,
 *      update_flag: true, uploaded_at} straight to that device's own MQTT
 *      topic (server/routes/firmware.js -> server/mqttClient.js) -
 *      jk_bms_hub/{hubId}/{bmsKey}/command - which the ESP32's own firmware
 *      subscribes to and self-flashes from instantly, no polling. This app
 *      still never talks to the ESP32 directly or transfers the file
 *      itself; it only publishes the signal.
 * Every connected user-role dashboard also still gets the existing
 * Socket.IO "firmware:release" notification either way, same as before.
 */
export function FirmwareUploadModal({ onClose, currentRelease, devices = [] }) {
  const [file, setFile] = useState(null);
  const [version, setVersion] = useState("");
  const [releaseNotes, setReleaseNotes] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [gitWarning, setGitWarning] = useState(null);
  const [mqttResults, setMqttResults] = useState(null);

  const deviceOptions = useMemo(
    () =>
      devices.map((d) => ({
        hubId: d.hubId,
        bmsKey: d.bmsKey ?? null,
        label: d.label,
        isOnline: d.isOnline,
        firmwareVersion: d.firmwareVersion ?? null,
      })),
    [devices]
  );
  const targetKey = (d) => `${d.hubId}/${d.bmsKey ?? ""}`;
  const allSelected = deviceOptions.length > 0 && selected.size === deviceOptions.length;

  // The real esp_firmware_version an actual connected device is reporting
  // right now (useAdminHubs.js already resolves this field, same source
  // VersionCheckModal reads) - prefers an online device since that's a live
  // read, not a stale one from before the device last disconnected.
  const liveVersion = useMemo(() => {
    const online = deviceOptions.find((d) => d.isOnline && d.firmwareVersion);
    return online?.firmwareVersion ?? deviceOptions.find((d) => d.firmwareVersion)?.firmwareVersion ?? null;
  }, [deviceOptions]);

  // Default to "every known device" the first time the list actually has
  // devices in it (AdminMonitor's live socket data can arrive a beat after
  // this modal opens) - an admin publishing firmware almost always wants it
  // to actually reach devices, and a silently-empty selection previously
  // meant "published to GitHub, but no device ever saw update_flag=true"
  // with no obvious sign anything was missed. Still opt-out, not forced -
  // unchecking a box before submitting is always available.
  const defaultedRef = useRef(false);
  useEffect(() => {
    if (defaultedRef.current || deviceOptions.length === 0) return;
    defaultedRef.current = true;
    setSelected(new Set(deviceOptions.map(targetKey)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceOptions]);

  // Prefills the version field from the live device reading so the admin
  // isn't typing it blind - only while they haven't touched the field
  // themselves (versionTouched), so this never clobbers something they're
  // actively editing once liveVersion arrives a beat later.
  const [versionTouched, setVersionTouched] = useState(false);
  useEffect(() => {
    if (versionTouched || !liveVersion) return;
    setVersion(liveVersion);
  }, [liveVersion, versionTouched]);

  function toggleDevice(d) {
    const key = targetKey(d);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(deviceOptions.map(targetKey)));
  }

  function pickFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".bin")) {
      setError("รองรับเฉพาะไฟล์ .bin");
      return;
    }
    setError(null);
    setFile(f);
  }

  async function upload() {
    if (!file || !version.trim()) return;
    setUploading(true);
    setError(null);
    try {
      const targets = deviceOptions.filter((d) => selected.has(targetKey(d))).map((d) => ({ hubId: d.hubId, bmsKey: d.bmsKey }));
      const result = await api.uploadFirmware(version.trim(), file.name, file, { releaseNotes: releaseNotes.trim(), targets });
      setDone(true);
      setMqttResults(result.mqttResults ?? null);
      if (result.gitError) {
        // Publishing/notifying still fully succeeded (that's DB-backed, see
        // server/routes/firmware.js) - only the git-backed durable copy
        // failed, so this is a warning to fix later, not a failure to retry.
        // MQTT publishes are skipped entirely when this happens (there's no
        // real raw URL to give the device yet).
        setGitWarning(result.gitError);
      } else if (!targets.length) {
        setTimeout(onClose, 900);
      }
    } catch (err) {
      setError(err.message || "อัพโหลดไม่สำเร็จ");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      {currentRelease && (
        <div className="rounded-xl bg-[var(--muted)] p-3 text-xs">
          <p className="text-[var(--muted-foreground)]">เวอร์ชันล่าสุดที่เผยแพร่</p>
          <p className="mt-0.5 font-bold text-[var(--foreground)]">
            v{currentRelease.version} · {currentRelease.filename}
          </p>
        </div>
      )}

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">เวอร์ชัน</p>
          {liveVersion && (
            <span className="text-[10px] text-[var(--muted-foreground)]">อุปกรณ์รายงานปัจจุบัน: v{liveVersion}</span>
          )}
        </div>
        <input
          type="text"
          value={version}
          onChange={(e) => {
            setVersionTouched(true);
            setVersion(e.target.value);
          }}
          placeholder="เช่น 19.31"
          maxLength={40}
          className="w-full rounded-xl border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--brand)]"
        />
      </div>

      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          Release Notes <span className="normal-case text-[var(--muted-foreground)]/70">(ไม่บังคับ)</span>
        </p>
        <textarea
          value={releaseNotes}
          onChange={(e) => setReleaseNotes(e.target.value)}
          placeholder="สิ่งที่แก้ไข/เปลี่ยนแปลงในเวอร์ชันนี้..."
          rows={3}
          maxLength={2000}
          className="w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--brand)]"
        />
      </div>

      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">ไฟล์ .bin</p>
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-[var(--border)] px-4 py-6 text-center transition-colors hover:border-[var(--brand)]">
          <UploadCloud className="size-6 text-[var(--muted-foreground)]" />
          <span className="text-xs font-semibold text-[var(--foreground)]">{file ? file.name : "เลือกไฟล์ .bin"}</span>
          {file && <span className="text-[10px] text-[var(--muted-foreground)]">{(file.size / 1024).toFixed(0)} KB</span>}
          <input type="file" accept=".bin" onChange={pickFile} className="hidden" />
        </label>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            ส่งไปยังอุปกรณ์จริง <span className="normal-case text-[var(--muted-foreground)]/70">(ไม่บังคับ)</span>
          </p>
          {deviceOptions.length > 0 && (
            <button type="button" onClick={toggleAll} className="text-[10px] font-semibold text-[var(--brand)] hover:underline">
              {allSelected ? "ยกเลิกทั้งหมด" : "เลือกทั้งหมด"}
            </button>
          )}
        </div>
        {deviceOptions.length === 0 ? (
          <p className="rounded-xl bg-[var(--muted)] p-3 text-xs text-[var(--muted-foreground)]">ไม่พบอุปกรณ์</p>
        ) : (
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-[var(--border)] p-2">
            {deviceOptions.map((d) => {
              const key = targetKey(d);
              const fbResult = mqttResults?.find((r) => r.hubId === d.hubId && (r.bmsKey ?? null) === d.bmsKey);
              return (
                <label
                  key={key}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-[var(--muted)]"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(key)}
                    onChange={() => toggleDevice(d)}
                    className="size-3.5 accent-[var(--brand)]"
                  />
                  <span className={`size-1.5 shrink-0 rounded-full ${d.isOnline ? "bg-emerald-400" : "bg-[var(--muted-foreground)]/40"}`} />
                  <span className="flex-1 truncate text-[var(--foreground)]">{d.label}</span>
                  {fbResult && (fbResult.ok ? (
                    <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
                  ) : (
                    <span title={fbResult.error}>
                      <XCircle className="size-3.5 shrink-0 text-[var(--critical)]" />
                    </span>
                  ))}
                </label>
              );
            })}
          </div>
        )}
        {done && mqttResults?.some((r) => !r.ok) && (
          <p className="mt-1.5 text-[10px] text-[var(--critical)]">
            บางอุปกรณ์ส่งสัญญาณ MQTT ไม่สำเร็จ - ไฟล์ยังอยู่บน GitHub ปกติ ลองส่งใหม่ให้อุปกรณ์นั้นได้ภายหลัง
          </p>
        )}
      </div>

      {error && <p className="text-xs font-semibold text-[var(--critical)]">{error}</p>}
      {gitWarning && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
          <p className="font-bold">เผยแพร่สำเร็จ แต่ยังไม่ได้บันทึกลง GitHub</p>
          <p className="mt-0.5">{gitWarning}</p>
          <p className="mt-1">ไม่ได้ส่งสัญญาณอัพเดทให้อุปกรณ์ เพราะยังไม่มี URL จริงให้ดาวน์โหลด</p>
        </div>
      )}
      {done && !gitWarning && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-800">
          <p className="font-bold">เผยแพร่สำเร็จ</p>
          {deviceOptions.length > 0 && !mqttResults?.length && (
            <p className="mt-0.5">ยังไม่ได้เลือกอุปกรณ์ - อุปกรณ์จะยังไม่เห็นอัพเดทนี้จนกว่าจะส่งซ้ำพร้อมเลือกเป้าหมาย</p>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl px-4 py-2 text-sm font-semibold text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
        >
          {done ? "ปิด" : "ยกเลิก"}
        </button>
        <button
          type="button"
          onClick={upload}
          disabled={!file || !version.trim() || uploading || done}
          className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <UploadCloud className="size-4" />
          {done ? "อัพโหลดแล้ว" : uploading ? "กำลังอัพโหลด..." : "อัพโหลด & เผยแพร่"}
        </button>
      </div>
    </div>
  );
}
