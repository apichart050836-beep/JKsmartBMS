import React, { useState } from "react";
import { Send } from "lucide-react";
import { api } from "../lib/apiClient.js";

const PRESETS = ["ปรับปรุงระบบ", "อัพเดทระบบ", "ระบบขัดข้อง"];

// Admin broadcast ("แจ้ง Update") - sends a message to every connected
// user-role dashboard via Socket.IO (see server/routes/announcements.js +
// realtime.js's "role:user" room). Preset chips just prefill the textarea;
// the message is always freely editable before sending.
export function AnnounceModal({ onClose }) {
  const [category, setCategory] = useState(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  function pickPreset(preset) {
    setCategory(preset);
    setMessage((prev) => (prev.trim() ? prev : preset));
  }

  async function send() {
    if (!message.trim()) return;
    setSending(true);
    setError(null);
    try {
      await api.sendAnnouncement(message.trim(), category);
      setSent(true);
      setTimeout(onClose, 900);
    } catch (err) {
      setError(err.message || "Failed to send");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">หัวข้อ</p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => pickPreset(preset)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                category === preset
                  ? "bg-[var(--brand)] text-white"
                  : "bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
            >
              {preset}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">ข้อความ</p>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          maxLength={500}
          placeholder="พิมพ์ข้อความที่จะแจ้งผู้ใช้ทุกคน..."
          className="w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--brand)]"
        />
        <p className="mt-1 text-right text-[10px] text-[var(--muted-foreground)]">{message.length}/500</p>
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
          onClick={send}
          disabled={!message.trim() || sending || sent}
          className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="size-4" />
          {sent ? "ส่งแล้ว" : sending ? "กำลังส่ง..." : "ส่ง"}
        </button>
      </div>
    </div>
  );
}
