import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "../lib/apiClient.js";

const AuthContext = createContext(null);

// Source of truth for "who is logged in" is always GET /api/auth/me (reads
// the httpOnly cookie server-side) - this context just caches that result
// for the UI, it never invents or trusts a role/email from anywhere else.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // { email, role } | null
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api.me();
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
