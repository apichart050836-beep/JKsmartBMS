import React, { useState } from "react";
import { UploadCloud } from "lucide-react";
import { api } from "../lib/apiClient.js";

// Admin's "Firmware Update" panel - publishes a .bin so every connected
// user-role dashboard gets notified (Socket.IO "firmware:release", see
// server/routes/firmware.js). Purely a publish + notify workflow: nothing
// here flashes a physical ESP32, there's no OTA transport in this app -
// "Update" on the dashboard side is acknowledge-only.
export function FirmwareUploadModal({ onClose, currentRelease }) {
  const [file, setFile] = useState(null);
  const [version, setVersion] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

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
      await api.uploadFirmware(version.trim(), file.name, file);
      setDone(true);
      setTimeout(onClose, 900);
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
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">เวอร์ชัน</p>
        <input
          type="text"
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          placeholder="เช่น 19.31"
          maxLength={40}
          className="w-full rounded-xl border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--brand)]"
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

      {error && <p className="text-xs font-semibold text-[var(--critical)]">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl px-4 py-2 text-sm font-semibold text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
        >
          ยกเลิก
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
