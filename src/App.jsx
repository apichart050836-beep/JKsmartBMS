import React, { useState, useEffect, useRef } from "react";
import { LayoutDashboard, ShieldCheck, LogOut, Cpu } from "lucide-react";
import BMSDashboard from "./BMSDashboard.jsx";
import AdminMonitor from "./AdminMonitor.jsx";
import Login from "./Login.jsx";
import HomePage from "./HomePage.jsx";
import { ThemeRoot } from "./components/ThemeRoot.jsx";
import { ThemeProvider } from "./context/ThemeContext.jsx";
import { AuthProvider, useAuth } from "./context/AuthContext.jsx";
import { HubDataProvider } from "./context/HubDataContext.jsx";
import { LogoutModal } from "./components/LogoutModal.jsx";
import { VersionCheckModal } from "./components/VersionCheckModal.jsx";
import { FirmwareUpdateToast } from "./components/FirmwareUpdateToast.jsx";

const PAGES = [
  // Dashboard (live per-device telemetry + Configuration) is user-role only -
  // admin sessions only ever get Admin Monitor's fleet view, per explicit
  // instruction. Admin already has full data access to every hub either way
  // (that's what makes them admin) - this is a page-routing choice, not a
  // security boundary, unlike Admin Monitor below.
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, userOnly: true },
  // Admin Monitor is only ever added to this list for role="admin" sessions
  // (see AuthedApp below) - hiding it here is a UX nicety, not the security
  // boundary. The actual boundary is server-side: every /api/admin/* route
  // requires requireRole('admin') regardless of what the frontend renders.
  { id: "admin", label: "Admin Monitor", icon: ShieldCheck, adminOnly: true },
];

function AuthedApp() {
  const { user, logout } = useAuth();
  const defaultPage = user.role === "admin" ? "admin" : "dashboard";
  const [page, setPage] = useState(defaultPage);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  // Versions of whichever device BMSDashboard currently has active - lifted
  // up via a callback since the badge/button it's shown next to lives here,
  // outside BMSDashboard itself.
  const [deviceVersions, setDeviceVersions] = useState({ software: null, hardware: null, deviceLabel: null });
  const [showVersionModal, setShowVersionModal] = useState(false);
  // Reuses FirmwareUpdateToast (already built for the auto-detected
  // version-change case inside BMSDashboard) for a manual "Update" press in
  // the version popup - same component/animation, a separate toast instance
  // since that one's state is local to BMSDashboard.
  const [manualUpdateToast, setManualUpdateToast] = useState(null);
  const pages = PAGES.filter((p) => (p.adminOnly ? user.role === "admin" : !p.userOnly || user.role !== "admin"));
  const activePage = pages.find((p) => p.id === page) ? page : defaultPage;

  return (
    <HubDataProvider>
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-1 px-3 pt-4 sm:px-5 md:px-7">
        <div className="flex items-center gap-1">
          {pages.map((p) => {
            const Icon = p.icon;
            const active = p.id === activePage;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPage(p.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? "bg-[var(--brand-10)] text-[var(--brand)]"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
              >
                <Icon className="size-3.5" />
                {p.label}
              </button>
            );
          })}
          {activePage === "dashboard" && deviceVersions.software && (
            <button
              type="button"
              onClick={() => setShowVersionModal(true)}
              title="ตรวจสอบอัพเดทเฟิร์มแวร์"
              className="inline-flex items-center gap-1 rounded-lg bg-[var(--muted)] px-2 py-1 text-[10px] font-semibold text-[var(--muted-foreground)] transition-colors hover:bg-[var(--border)] hover:text-[var(--foreground)]"
            >
              <Cpu className="size-3" />
              Update
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--muted-foreground)]">{user.email}</span>
          {/* Dashboard renders its own logout button (TopBar.jsx) - this one
              only needs to appear on pages that don't, i.e. Admin Monitor,
              which admin-only sessions land on since they no longer have a
              Dashboard tab at all. */}
          {activePage !== "dashboard" && (
            <button
              type="button"
              onClick={() => setShowLogoutModal(true)}
              title="Logout"
              className="group inline-flex size-8 cursor-pointer items-center justify-center rounded-full bg-[var(--card)] text-[var(--critical)] ring-1 ring-[var(--border)] shadow-sm transition-all duration-200 hover:bg-red-50 hover:ring-red-200 hover:scale-105 active:scale-95"
            >
              <LogOut className="size-4 transition-transform duration-300 group-hover:-translate-x-0.5" />
            </button>
          )}
        </div>
      </div>
      {activePage === "dashboard" ? (
        <BMSDashboard onSoftwareVersionChange={setDeviceVersions} />
      ) : (
        <AdminMonitor />
      )}
      <LogoutModal
        isOpen={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        onConfirm={() => {
          setShowLogoutModal(false);
          logout();
        }}
      />
      <VersionCheckModal
        open={showVersionModal}
        onClose={() => setShowVersionModal(false)}
        deviceLabel={deviceVersions.deviceLabel}
        softwareVersion={deviceVersions.software}
        hardwareVersion={deviceVersions.hardware}
        onUpdate={() => {
          setShowVersionModal(false);
          setManualUpdateToast({ deviceLabel: deviceVersions.deviceLabel, version: deviceVersions.software });
          setTimeout(() => setManualUpdateToast(null), 6000);
        }}
      />
      <FirmwareUpdateToast update={manualUpdateToast} />
    </HubDataProvider>
  );
}

function Gate() {
  const { isAuthenticated, loading } = useAuth();
  // Unauthenticated visitors land on the marketing HomePage first, not
  // straight on the login form - "เข้าสู่ระบบ"/"เริ่มต้นใช้งาน" there switch
  // to Login. Resets to the HomePage on logout (this is state, not a route,
  // so nothing else does this automatically) so signing out always bounces
  // back to the same place a fresh visit would start from.
  const [showLogin, setShowLogin] = useState(false);
  const wasAuthenticated = useRef(isAuthenticated);
  useEffect(() => {
    if (wasAuthenticated.current && !isAuthenticated) setShowLogin(false);
    wasAuthenticated.current = isAuthenticated;
  }, [isAuthenticated]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-[var(--muted-foreground)]" />;
  }
  if (isAuthenticated) return <AuthedApp />;
  return showLogin ? <Login /> : <HomePage onGoToLogin={() => setShowLogin(true)} />;
}

export default function App() {
  return (
    <ThemeProvider>
      <ThemeRoot>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </ThemeRoot>
    </ThemeProvider>
  );
}
