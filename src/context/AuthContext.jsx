import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "../lib/apiClient.js";

const AuthContext = createContext(null);

// A handful of localStorage keys are session-scoped (which tab was open,
// which announcement/firmware notice was dismissed) but were never keyed by
// account - on a shared browser, logging in as a different person than the
// one who last used it inherited all of that stale state (confirmed live -
// a second account still landed on the previous account's last-viewed BMS
// tab, which is empty/wrong for an account with fewer devices). Only
// cleared on an actual account CHANGE, not on every refresh/relogin of the
// same person, so a normal page reload still remembers your own tab.
const LAST_USER_KEY = "bms-last-user-email";
function clearStaleSessionCacheIfUserChanged(newEmail) {
  if (!newEmail) return; // logout: leave everything as-is in case the same person logs back in shortly
  const lastEmail = localStorage.getItem(LAST_USER_KEY);
  if (lastEmail && lastEmail !== newEmail) {
    localStorage.removeItem("bms-active-tab");
    localStorage.removeItem("bms-dismissed-announcement-id");
    localStorage.removeItem("bms-dismissed-firmware-id");
    Object.keys(localStorage)
      .filter((k) => k.startsWith("bms-fw-ack-"))
      .forEach((k) => localStorage.removeItem(k));
  }
  localStorage.setItem(LAST_USER_KEY, newEmail);
}

// Source of truth for "who is logged in" is always GET /api/auth/me (reads
// the httpOnly cookie server-side) - this context just caches that result
// for the UI, it never invents or trusts a role/email from anywhere else.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // { email, role } | null
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api.me();
      clearStaleSessionCacheIfUserChanged(me?.email ?? null);
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, isAuthenticated: !!user, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
