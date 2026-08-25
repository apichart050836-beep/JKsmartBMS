import React, { useEffect, useState } from "react";
import { Link2Off, Send } from "lucide-react";
import { Modal } from "./Modal.jsx";
import { LineIcon } from "./icons/LineIcon.jsx";
import { api } from "../lib/apiClient.js";

// Personal LINE push notifications (explicit request) - lets this hub's
// owner link their own LINE account (via LINE Login OAuth, server/
// lineAuth.js) so lineAlertWatchdog.js has somewhere to push the 9 battery
// condition alerts to (cell imbalance, SOC thresholds, charge/discharge
// current thresholds - see that file's CONDITIONS list for the exact
// wording/thresholds).
export function LineNotifySettings({ open, onClose }) {
  const [status, setStatus] = useState(null); // { linked, linkedAt } | null while loading
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Separate from `busy`/`error` above (connect/unlink) so a test push
  // doesn't disable/clash with those, and its own result reads as "test
  // sent" rather than a generic connection error.
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState(null); // "ok" | "error" | null
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
    } catch {
      setTestResult("error");
    } finally {
      setTestBusy(false);
    }
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
          รับแจ้งเตือนส่วนตัวผ่าน LINE เมื่อเซลล์แรงดันต่างกันเกิน 50mV, แบตใกล้เต็ม/เต็ม, แบตใกล้หมด/หมด, กระแสชาร์จ/ใช้ไฟเกินค่าที่แนะนำ,
          หรืออุปกรณ์ขาดการเชื่อมต่อ/เชื่อมต่อกลับมา (พร้อมเวลา)
        </p>

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
            {testResult === "error" && (
              <p className="text-center text-[11px] font-semibold text-[var(--critical)]">
                ส่งไม่สำเร็จ - ตรวจสอบว่าได้เพิ่มบัญชี LINE ทางการเป็นเพื่อนแล้ว
              </p>
            )}
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
