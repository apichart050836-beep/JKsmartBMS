import React, { useEffect, useState } from "react";
import { Link2Off, Send, UserPlus } from "lucide-react";
import { Modal } from "./Modal.jsx";
import { LineIcon } from "./icons/LineIcon.jsx";
import { api } from "../lib/apiClient.js";

// Personal LINE push notifications (explicit request) - lets this hub's
// owner link their own LINE account (via LINE Login OAuth, server/
// lineAuth.js) so lineAlertWatchdog.js has somewhere to push alerts to.
// Trimmed down (2026-08-29) from 9 per-device conditions to 4 (near-full
// 95%, battery remaining 15%, charge/discharge over recommended - explicit
// follow-up kept these two after an initial over-trim), plus fleet-average
// step 20%, weather (rain/sun only), and the two user-set numeric limits -
// see that file's CONDITIONS list and DEFAULT_PREFS for the exact wording.
// Defaults mirror lineAlertWatchdog.js's DEFAULT_PREFS exactly - shown here
// before the real saved value has loaded (or for a hub that's never saved
// any prefs yet) so the checklist doesn't flash as all-unchecked first.
// wattLimit/chargeAmpLimit have no default (0 = that alert is off) - each
// is a number the hub owner has to set themselves, not a checkbox, so
// they're kept out of PREFS_KEYS/"เลือกทั้งหมด" below.
const DEFAULT_PREFS = {
  remind3h: true,
  step20: true,
  fleetLow15: true,
  fleetNearFull95: true,
  weatherEnabled: false,
  wattLimit: 0,
  chargeAmpLimit: 0,
};
const PREFS_KEYS = ["remind3h", "step20", "fleetLow15", "fleetNearFull95", "weatherEnabled"];

export function LineNotifySettings({ open, onClose }) {
  const [status, setStatus] = useState(null); // { linked, linkedAt } | null while loading
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [prefsSaving, setPrefsSaving] = useState(false);
  // Confirmed real-world failure (2026-08-26): a second hub-owner completed
  // the LINE Login link and even got "sent successfully" from /test, but no
  // message ever arrived - because that LINE account had never added this
  // Official Account as a friend, which OAuth linking alone doesn't require
  // or guarantee. A direct "add friend" link removes the "search for the
  // bot yourself" step that was silently blocking delivery.
  const [addFriendUrl, setAddFriendUrl] = useState(null);
  // Separate from `busy`/`error` above (connect/unlink) so a test push
  // doesn't disable/clash with those, and its own result reads as "test
  // sent" rather than a generic connection error.
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState(null); // "ok" | {status:"error", message} | null
  // Pre-fetched the moment the modal opens (not inside handleConnect's own
  // click handler) - on iOS Safari especially, an `await` between a tap and
  // window.location.href breaks the "trusted user gesture" Universal Links
  // need to auto-open the LINE app; without a value ready here already,
  // the button's own click handler would have to await the network call
  // itself, and the resulting navigation would just load LINE's page in
  // the browser instead of jumping into the app.
  const [loginUrl, setLoginUrl] = useState(null);
  // Set once, from the URL LINE redirected back to (see routes/line.js's
  // /callback) - "linked" | "error" | null. Read here rather than at the
  // dashboard's top level since this modal is the only place it's ever
  // meaningful to show.
  const [returnResult] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("line");
  });

  function refresh() {
    setError(null);
    api
      .lineStatus()
      .then(setStatus)
      .catch((err) => setError(err.message || "โหลดสถานะไม่สำเร็จ"));
  }

  useEffect(() => {
    if (!open) return;
    refresh();
    setLoginUrl(null);
    api
      .lineLoginUrl()
      .then(({ url }) => setLoginUrl(url))
      .catch(() => {}); // handleConnect falls back to fetching it itself if this hasn't resolved yet
    api
      .linePrefs()
      .then((saved) => setPrefs({ ...DEFAULT_PREFS, ...saved }))
      .catch(() => {}); // stays on DEFAULT_PREFS - matches the watchdog's own fallback
    api
      .lineBotInfo()
      .then(({ addFriendUrl: url }) => setAddFriendUrl(url))
      .catch(() => {}); // button just doesn't render - not fatal to the rest of this modal
    // The ?line=linked/error param has done its job the moment this modal
    // has read it - strip it so a page refresh doesn't keep re-showing a
    // stale result banner.
    if (returnResult) {
      const url = new URL(window.location.href);
      url.searchParams.delete("line");
      window.history.replaceState({}, "", url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleConnect() {
    // Synchronous path (the whole point - see loginUrl's comment above):
    // already have the URL, so this tap navigates immediately with no
    // await in between, keeping the "trusted user gesture" Universal Links
    // need to jump straight into the LINE app.
    if (loginUrl) {
      window.location.href = loginUrl;
      return;
    }
    // Fallback only - the prefetch above hasn't resolved yet (opened and
    // tapped within the same instant). Still works, just loses the
    // guaranteed-synchronous navigation.
    setBusy(true);
    setError(null);
    api
      .lineLoginUrl()
      .then(({ url }) => {
        window.location.href = url;
      })
      .catch((err) => {
        setError(err.message || "เริ่มการเชื่อมต่อไม่สำเร็จ");
        setBusy(false);
      });
  }

  async function handleTest() {
    setTestBusy(true);
    setTestResult(null);
    try {
      await api.lineTest();
      setTestResult("ok");
    } catch (err) {
      // Was previously swallowed entirely (bare `catch {}`), so every real
      // failure - wrong token, invalid lineUserId, LINE API outage, actual
      // not-a-friend rejection - all rendered the exact same generic
      // "add friend" hint below, with no way to tell them apart. Now shows
      // whatever routes/line.js's /test actually reported (which already
      // forwards LINE's own error text - see lineNotify.js's pushLineMessage).
      setTestResult({ status: "error", message: err.message || "ส่งไม่สำเร็จ" });
    } finally {
      setTestBusy(false);
    }
  }

  // Auto-saves on every toggle (no separate Save button) - matches how the
  // rest of this modal already behaves (connect/unlink/test all fire
  // immediately on click).
  async function savePrefs(next) {
    setPrefs(next);
    setPrefsSaving(true);
    try {
      await api.saveLinePrefs(next);
    } catch {
      // Best-effort - the checklist stays visually toggled either way, and
      // the next open re-loads whatever actually made it to Firebase.
    } finally {
      setPrefsSaving(false);
    }
  }

  function togglePref(key) {
    savePrefs({ ...prefs, [key]: !prefs[key] });
  }

  const allChecked = PREFS_KEYS.every((key) => prefs[key]);
  function toggleAll() {
    const next = !allChecked;
    // Preserve wattLimit - it's a number the owner set themselves, not part
    // of this boolean group, so "select all" must never wipe it out.
    savePrefs({ ...prefs, ...Object.fromEntries(PREFS_KEYS.map((key) => [key, next])) });
  }

  // wattLimit/chargeAmpLimit each get their own save path (debounced-on-
  // blur, not on every keystroke like the checkboxes) since typing a number
  // fires many more change events than a click ever would.
  const [wattInput, setWattInput] = useState("");
  useEffect(() => {
    setWattInput(prefs.wattLimit ? String(prefs.wattLimit) : "");
  }, [prefs.wattLimit]);
  function saveWattLimit() {
    const n = Number(wattInput);
    savePrefs({ ...prefs, wattLimit: Number.isFinite(n) && n > 0 ? n : 0 });
  }

  const [chargeAmpInput, setChargeAmpInput] = useState("");
  useEffect(() => {
    setChargeAmpInput(prefs.chargeAmpLimit ? String(prefs.chargeAmpLimit) : "");
  }, [prefs.chargeAmpLimit]);
  function saveChargeAmpLimit() {
    const n = Number(chargeAmpInput);
    savePrefs({ ...prefs, chargeAmpLimit: Number.isFinite(n) && n > 0 ? n : 0 });
  }

  async function handleUnlink() {
    setBusy(true);
    setError(null);
    try {
      await api.lineUnlink();
      refresh();
    } catch (err) {
      setError(err.message || "ยกเลิกการเชื่อมต่อไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="แจ้งเตือนผ่าน LINE" maxWidthClass="max-w-md">
      <div className="space-y-4">
        {returnResult === "linked" && (
          <div className="rounded-xl bg-emerald-50 p-3 text-xs font-semibold text-emerald-700">
            เชื่อมต่อบัญชี LINE สำเร็จแล้ว
          </div>
        )}
        {returnResult === "error" && (
          <div className="rounded-xl bg-[var(--critical-10)] p-3 text-xs font-semibold text-[var(--critical)]">
            เชื่อมต่อบัญชี LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง
          </div>
        )}

        <p className="text-xs text-[var(--muted-foreground)]">
          รับแจ้งเตือนส่วนตัวผ่าน LINE เมื่อแบตใกล้เต็ม 95%, แบตเหลือ 15%, หรือกระแสชาร์จ/ใช้ไฟเกินค่าที่แนะนำ - เลือกแจ้งเตือนเพิ่มเติมได้ด้านล่าง
        </p>

        {addFriendUrl && (
          <a
            href={addFriendUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-800 hover:bg-amber-100"
          >
            <UserPlus className="size-4 shrink-0" />
            <span>
              ต้องเพิ่มเพื่อน LINE ก่อน ไม่งั้นจะไม่ได้รับข้อความแจ้งเตือน — <span className="underline">กดที่นี่เพื่อเพิ่มเพื่อน</span>
            </span>
          </a>
        )}

        {status === null ? (
          <p className="text-xs text-[var(--muted-foreground)]">กำลังโหลด...</p>
        ) : status.linked ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-xl bg-[var(--muted)] p-3">
              <div className="flex items-center gap-2">
                <LineIcon className="size-8" />
                <div>
                  <p className="text-xs font-semibold text-[var(--foreground)]">เชื่อมต่อ LINE แล้ว</p>
                  {status.linkedAt && (
                    <p className="text-[10px] text-[var(--muted-foreground)]">
                      ตั้งแต่ {new Date(status.linkedAt).toLocaleString("th-TH")}
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={handleUnlink}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-[var(--critical)] hover:bg-[var(--critical-10)] disabled:opacity-50"
              >
                <Link2Off className="size-3.5" />
                ยกเลิก
              </button>
            </div>

            <button
              type="button"
              onClick={handleTest}
              disabled={testBusy}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[#06C755] px-4 py-2 text-xs font-semibold text-[#06C755] transition-all hover:bg-[#06C755]/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="size-3.5" />
              {testBusy ? "กำลังส่ง..." : "ทดสอบแจ้งเตือน"}
            </button>
            {testResult === "ok" && (
              <p className="text-center text-[11px] font-semibold text-emerald-600">
                ส่งข้อความทดสอบแล้ว ตรวจสอบแอป LINE ของคุณ
              </p>
            )}
            {testResult?.status === "error" && (
              <div className="rounded-lg bg-[var(--critical-10)] p-2 text-center text-[11px] font-semibold text-[var(--critical)]">
                <p>ส่งไม่สำเร็จ</p>
                <p className="mt-0.5 font-mono text-[10px] font-normal">{testResult.message}</p>
              </div>
            )}

            <div className="space-y-1.5 rounded-xl border border-[var(--border)] p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-[var(--foreground)]">แจ้งเตือนแบตเฉลี่ยทั้งระบบ</p>
                {prefsSaving && <span className="text-[10px] text-[var(--muted-foreground)]">กำลังบันทึก...</span>}
              </div>
              <label className="flex items-center gap-2 border-b border-[var(--border)] pb-1.5 text-xs text-[var(--foreground)]">
                <input type="checkbox" checked={allChecked} onChange={toggleAll} className="size-3.5" />
                เลือกทั้งหมด
              </label>
              <label className="flex items-center gap-2 text-xs text-[var(--foreground)]">
                <input type="checkbox" checked={prefs.remind3h} onChange={() => togglePref("remind3h")} className="size-3.5" />
                แจ้งเตือนซ้ำทุก 3 ชม.
              </label>
              <label className="flex items-center gap-2 text-xs text-[var(--foreground)]">
                <input type="checkbox" checked={prefs.step20} onChange={() => togglePref("step20")} className="size-3.5" />
                แจ้งเตือนเพิ่มหรือลดทุก 20%
              </label>
              <label className="flex items-center gap-2 text-xs text-[var(--foreground)]">
                <input
                  type="checkbox"
                  checked={prefs.fleetLow15}
                  onChange={() => togglePref("fleetLow15")}
                  className="size-3.5"
                />
                แจ้งเตือนแบตเฉลี่ยเหลือน้อย 15%
              </label>
              <label className="flex items-center gap-2 text-xs text-[var(--foreground)]">
                <input
                  type="checkbox"
                  checked={prefs.fleetNearFull95}
                  onChange={() => togglePref("fleetNearFull95")}
                  className="size-3.5"
                />
                แจ้งเตือนแบตเฉลี่ยใกล้เต็ม 95%
              </label>
              <label className="flex items-center gap-2 text-xs text-[var(--foreground)]">
                <input
                  type="checkbox"
                  checked={prefs.weatherEnabled}
                  onChange={() => togglePref("weatherEnabled")}
                  className="size-3.5"
                />
                แจ้งเตือนสภาพอากาศ (ฝนตกหรือแดดออกเท่านั้น)
              </label>
              <p className="pt-0.5 text-[10px] text-[var(--muted-foreground)]">
                ต้องตั้งค่าตำแหน่งติดตั้ง (สภาพอากาศ) ไว้ก่อน ถึงจะแจ้งเตือนได้
              </p>

              <div className="flex items-center gap-2 border-t border-[var(--border)] pt-1.5 text-xs text-[var(--foreground)]">
                <span className="shrink-0">แจ้งเตือนเมื่อใช้พลังงานเกิน</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={wattInput}
                  onChange={(e) => setWattInput(e.target.value)}
                  onBlur={saveWattLimit}
                  placeholder="ไม่ตั้งค่า"
                  className="w-20 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs"
                />
                <span className="shrink-0">W</span>
              </div>
              <p className="text-[10px] text-[var(--muted-foreground)]">
                ปล่อยว่างไว้ = ปิดการแจ้งเตือนนี้ (เฉพาะตอนใช้พลังงาน/จ่ายไฟออก ไม่นับตอนชาร์จ)
              </p>

              <div className="flex items-center gap-2 pt-1 text-xs text-[var(--foreground)]">
                <span className="shrink-0">แจ้งเตือนเมื่อชาร์จเกิน</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={chargeAmpInput}
                  onChange={(e) => setChargeAmpInput(e.target.value)}
                  onBlur={saveChargeAmpLimit}
                  placeholder="ไม่ตั้งค่า"
                  className="w-20 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs"
                />
                <span className="shrink-0">A</span>
              </div>
              <p className="text-[10px] text-[var(--muted-foreground)]">
                ปล่อยว่างไว้ = ปิดการแจ้งเตือนนี้ (เฉพาะตอนชาร์จ ไม่นับตอนใช้งาน)
              </p>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleConnect}
            disabled={busy}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-[#06C755] bg-[var(--card)] px-4 py-2.5 text-sm font-semibold text-[#06C755] shadow-sm transition-all hover:bg-[#06C755]/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <LineIcon className="size-5" />
            {busy ? "กำลังเชื่อมต่อ..." : "เชื่อมต่อบัญชี LINE"}
          </button>
        )}

        {error && <p className="text-xs font-semibold text-[var(--critical)]">{error}</p>}
      </div>
    </Modal>
  );
}
