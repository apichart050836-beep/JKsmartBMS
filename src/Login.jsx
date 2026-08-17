import React, { useState, useEffect } from "react";
import { Mail, Lock, ShieldCheck, ArrowLeft, KeyRound } from "lucide-react";
import { api } from "./lib/apiClient.js";
import { useAuth } from "./context/AuthContext.jsx";
import { ThemeToggle } from "./components/ThemeToggle.jsx";

// Two-step form (Gmail first, then password) per the requested flow - not
// real Google OAuth, this app owns and hashes the password itself
// server-side, so there is no Google sign-in popup here.
export default function Login() {
  const { refresh } = useAuth();
  const [step, setStep] = useState("email"); // "email" | "password" | "pending" | "admin-setup" | "admin-password"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Whether an admin account already exists - decides what the always-
  // visible "Admin" shortcut does: register-admin (first ever click) if
  // false, password-only admin-login if true. The backend re-checks this
  // itself on submit too, so a stale client read here can't skip the real
  // gate.
  const [adminExists, setAdminExists] = useState(true);
  useEffect(() => {
    api
      .adminExists()
      .then(({ exists }) => setAdminExists(exists))
      .catch(() => setAdminExists(true));
  }, []);

  async function handleEmailSubmit(e) {
    e.preventDefault();
    setError("");
    const trimmed = email.trim();
    if (!trimmed) return;
    // Login shortcut for this one real account - typing "poote" here
    // resolves to monggwkp@gmail.com before ever reaching checkEmail/login,
    // so it's a client-side alias only, not a new backend concept. Distinct
    // from the separate "Admin" button below, which logs into a completely
    // different, dedicated Admin-only account via api.adminLogin.
    const resolved = trimmed.toLowerCase() === "poote" ? "monggwkp@gmail.com" : trimmed;
    if (resolved !== email) setEmail(resolved);
    setBusy(true);
    try {
      const { exists, needsPassword } = await api.checkEmail(resolved);
      if (!exists) {
        // Same generic message login itself uses - don't confirm/deny an
        // email's existence any more precisely than that.
        setError("ไม่พบบัญชีนี้ในระบบ");
      } else if (needsPassword === false) {
        // Approved account (explicit request, 2026-08-01) - the email
        // itself is the credential now, log straight in without ever
        // showing a password field. Password body is unused server-side
        // for this branch (server/routes/auth.js), sent empty here.
        try {
          await api.login(resolved, "");
          await refresh();
        } catch {
          setError("เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่");
        }
      } else {
        setStep("password");
      }
    } catch {
      setError("เชื่อมต่อระบบไม่ได้ กรุณาลองใหม่");
    } finally {
      setBusy(false);
    }
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await api.login(email.trim(), password);
      if (result?.pending) {
        // Brand-new email + correct access code - queued for admin
        // approval (server/routes/admin.js), not logged in yet.
        setStep("pending");
      } else {
        await refresh();
      }
    } catch {
      setError("อีเมลหรือรหัสผ่านไม่ถูกต้อง");
    } finally {
      setBusy(false);
    }
  }

  async function handleAdminSetupSubmit(e) {
    e.preventDefault();
    setError("");
    if (!email.trim()) return;
    setBusy(true);
    try {
      await api.registerAdmin(email.trim(), password);
      await refresh();
    } catch (err) {
      setError(err.message === "An admin account already exists" ? "มี Admin ในระบบแล้ว" : "ตั้งค่าไม่สำเร็จ ตรวจสอบรหัสผ่านตั้งต้น");
    } finally {
      setBusy(false);
    }
  }

  async function handleAdminPasswordSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api.adminLogin(password);
      await refresh();
    } catch {
      setError("รหัสผ่านไม่ถูกต้อง");
    } finally {
      setBusy(false);
    }
  }

  function openAdminShortcut() {
    setError("");
    setPassword("");
    setStep(adminExists ? "admin-password" : "admin-setup");
  }

  function backToEmail() {
    setStep("email");
    setPassword("");
    setError("");
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[var(--background)] px-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm rounded-3xl bg-[var(--card)] p-8 shadow-sm ring-1 ring-[var(--border)]">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 grid size-12 place-items-center rounded-2xl bg-[var(--brand-10)]">
            <ShieldCheck className="size-6 text-[var(--brand)]" />
          </span>
          <h1 className="text-lg font-bold text-[var(--foreground)]">JK BMS Dashboard</h1>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            {step === "admin-setup"
              ? "ตั้งค่า Admin ครั้งแรก"
              : step === "admin-password"
                ? "เข้าสู่ระบบ Admin"
                : step === "password"
                  ? "สมัครใช้งานครั้งแรก"
                  : step === "pending"
                    ? "รอแอดมินอนุมัติ"
                    : "เข้าสู่ระบบด้วยอีเมล"}
          </p>
        </div>

        {step === "email" && (
          <form onSubmit={handleEmailSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-[var(--muted-foreground)]">Email</label>
              <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--muted)] px-3 py-2.5">
                <Mail className="size-4 text-[var(--muted-foreground)]" />
                <input
                  type="text"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@gmail.com"
                  className="w-full bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
                />
              </div>
            </div>
            {error && <p className="text-xs font-medium text-[var(--critical)]">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-[var(--brand)] py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "กำลังตรวจสอบ..." : "ถัดไป"}
            </button>
            <button
              type="button"
              onClick={openAdminShortcut}
              className="flex w-full items-center justify-center gap-1.5 pt-1 text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              <KeyRound className="size-3.5" />
              Admin
            </button>
          </form>
        )}

        {step === "password" && (
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <button
              type="button"
              onClick={backToEmail}
              className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              <ArrowLeft className="size-3.5" />
              {email}
            </button>
            <p className="text-xs text-[var(--muted-foreground)]">
              ยังไม่เคยใช้อีเมลนี้เข้าระบบมาก่อน - กรอกรหัสเข้าใช้งานเพื่อส่งคำขอให้แอดมินอนุมัติ
            </p>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-[var(--muted-foreground)]">รหัสเข้าใช้งาน</label>
              <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--muted)] px-3 py-2.5">
                <Lock className="size-4 text-[var(--muted-foreground)]" />
                <input
                  type="password"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
                />
              </div>
            </div>
            {error && <p className="text-xs font-medium text-[var(--critical)]">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-[var(--brand)] py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "กำลังส่งคำขอ..." : "ส่งคำขอเข้าใช้งาน"}
            </button>
          </form>
        )}

        {step === "pending" && (
          <div className="space-y-4 text-center">
            <p className="text-sm text-[var(--foreground)]">
              ส่งคำขอเข้าใช้งานสำหรับ <span className="font-semibold">{email}</span> แล้ว
            </p>
            <p className="text-xs text-[var(--muted-foreground)]">
              รอแอดมินอนุมัติคำขอนี้ก่อน จึงจะเข้าสู่ระบบด้วยอีเมลนี้ได้ (ครั้งต่อไปไม่ต้องกรอกรหัสอีก)
            </p>
            <button
              type="button"
              onClick={backToEmail}
              className="w-full rounded-xl py-2.5 text-sm font-semibold text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)]"
            >
              กลับหน้าแรก
            </button>
          </div>
        )}

        {step === "admin-setup" && (
          <form onSubmit={handleAdminSetupSubmit} className="space-y-4">
            <button
              type="button"
              onClick={backToEmail}
              className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              <ArrowLeft className="size-3.5" />
              กลับ
            </button>
            <p className="text-xs text-[var(--muted-foreground)]">
              ใช้ได้ครั้งเดียวตอนยังไม่มี Admin ในระบบ - อีเมลนี้จะกลายเป็นบัญชี Admin ถาวร ครั้งต่อไปกดปุ่ม Admin แล้วกรอกแค่รหัสผ่านพอ
            </p>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-[var(--muted-foreground)]">Admin Email</label>
              <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--muted)] px-3 py-2.5">
                <Mail className="size-4 text-[var(--muted-foreground)]" />
                <input
                  type="email"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@gmail.com"
                  className="w-full bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
                />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-[var(--muted-foreground)]">รหัสผ่านตั้งต้น</label>
              <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--muted)] px-3 py-2.5">
                <Lock className="size-4 text-[var(--muted-foreground)]" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
                />
              </div>
            </div>
            {error && <p className="text-xs font-medium text-[var(--critical)]">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-[var(--brand)] py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "กำลังตั้งค่า..." : "ตั้งค่า Admin"}
            </button>
          </form>
        )}

        {step === "admin-password" && (
          <form onSubmit={handleAdminPasswordSubmit} className="space-y-4">
            <button
              type="button"
              onClick={backToEmail}
              className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              <ArrowLeft className="size-3.5" />
              กลับ
            </button>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-[var(--muted-foreground)]">Admin Password</label>
              <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--muted)] px-3 py-2.5">
                <Lock className="size-4 text-[var(--muted-foreground)]" />
                <input
                  type="password"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
                />
              </div>
            </div>
            {error && <p className="text-xs font-medium text-[var(--critical)]">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-[var(--brand)] py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
