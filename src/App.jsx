import React, { useState, lazy, Suspense } from "react";
import {
  LayoutDashboard,
  ShieldCheck,
  LogOut,
  Download,
  PlusCircle
} from "lucide-react";
import { BrowserRouter } from "react-router-dom";

import BMSDashboard from "./BMSDashboard.jsx";
import AdminMonitor from "./AdminMonitor.jsx";
import Login from "./Login.jsx";
import HomePage from "./HomePage.jsx";
import BmsManager from "./components/BmsManager.jsx";
import { ThemeRoot } from "./components/ThemeRoot.jsx";
import { ThemeProvider } from "./context/ThemeContext.jsx";
import { AuthProvider, useAuth } from "./context/AuthContext.jsx";
import { HubDataProvider, useHubData } from "./context/HubDataContext.jsx";
import { LogoutModal } from "./components/LogoutModal.jsx";

// esptool-js (Web Serial firmware flashing) only matters on this one page -
// lazy-loaded into its own chunk so regular Dashboard users never download
// it at all, per explicit request to cut Render bandwidth (see
// ESPFirmwareInstaller.jsx's own comment for the rest of the story).
const ESPFirmwareInstaller = lazy(() => import("./ESPFirmwareInstaller.jsx"));

// Collapsed to just the role by default ("user"/"admin") - tap/click to
// reveal the email + this account's expiration date. Needs useHubData()
// (for the expiration lookup) so it's a separate component rendered inside
// <HubDataProvider>, same reasoning as UpdateBadge above.
function UserMenu({ user }) {
  const { hubs } = useHubData();
  const [expanded, setExpanded] = useState(false);

  // A 'user' session owns exactly one hub (its own hubId, from /api/auth/me
  // - see hubAccess.js); admin sessions have hubId: null and no personal
  // expiration to show. Matches the same admin.expirationDate/expire_date
  // precedence AdminMonitor's useAdminHubs.js already uses.
  const hubData = user.hubId ? hubs[user.hubId] : null;
  const expirationDate = hubData?.admin?.expirationDate ?? hubData?.expire_date ?? null;

  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      title="แตะเพื่อดูอีเมลและวันหมดอายุ"
      className="rounded-lg px-2 py-1 text-right text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)]"
    >
      {expanded ? (
        <span className="flex flex-col leading-tight">
          <span className="text-[var(--foreground)]">{user.email}</span>
          <span className="text-[10px]">
            {user.hubId
              ? expirationDate
                ? `หมดอายุ: ${expirationDate}`
                : "ไม่ได้กำหนดวันหมดอายุ"
              : user.role}
          </span>
        </span>
      ) : (
        <span className="font-semibold text-[var(--foreground)]">{user.role}</span>
      )}
    </button>
  );
}

// ==========================================
// Main Router Container
// ==========================================
const PAGES = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, userOnly: true },
  { id: "admin", label: "Admin Monitor", icon: ShieldCheck, adminOnly: true },
  { id: "install-firmware", label: "ติดตั้ง Firmware", icon: Download },
  { id: "bms-manager", label: "เพิ่มอุปกรณ์", icon: PlusCircle },

];

function AuthedApp() {
  const { user, logout } = useAuth();
  const defaultPage = user.role === "admin" ? "admin" : "dashboard";
  const [page, setPage] = useState(defaultPage);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showDeviceMenu, setShowDeviceMenu] = useState(false); // State สำหรับควบคุมการเปิด/ปิด Dropdown

  const pages = PAGES.filter(
    (p) => (p.adminOnly ? user.role === "admin" : !p.userOnly || user.role !== "admin")
  );

  // แยกหน้าปกติทั่วไปออกจากกลุ่มเมนูจัดการอุปกรณ์
  const mainPages = pages.filter(
    (p) => p.id !== "bms-manager" && p.id !== "install-firmware"
  );

  const isDevicePage = page === "bms-manager" || page === "install-firmware";
  const activePage = pages.find((p) => p.id === page) ? page : defaultPage;

  return (
    <HubDataProvider>
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-1 px-3 pt-4 sm:px-5 md:px-7">
        <div className="flex items-center gap-1">
          {/* เรนเดอร์เมนูหลักปกติ */}
          {mainPages.map((p) => {
            const Icon = p.icon;
            const active = p.id === activePage;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setPage(p.id);
                  setShowDeviceMenu(false);
                }}
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

          {/* เมนูดรอปดาวน์ "ติดตั้งและเพิ่มอุปกรณ์" */}
          {pages.some((p) => p.id === "bms-manager" || p.id === "install-firmware") && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowDeviceMenu(!showDeviceMenu)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  isDevicePage
                    ? "bg-[var(--brand-10)] text-[var(--brand)]"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
              >
                {/* คุณสามารถเปลี่ยน Icon ตามต้องการ ตรงนี้ใช้ตัวอย่างแทน */}
                <span className="size-3.5 flex items-center justify-center">+</span>
                ติดตั้งและเพิ่มอุปกรณ์
                <svg
                  className={`size-3 transition-transform duration-200 ${showDeviceMenu ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* รายการ List เมนูดรอปดาวน์ย่อย */}
              {showDeviceMenu && (
                <div className="absolute left-0 mt-1 w-48 rounded-xl bg-[var(--card)] p-1 shadow-lg ring-1 ring-[var(--border)] z-50">
                  {pages.find((p) => p.id === "bms-manager") && (
                    <button
                      type="button"
                      onClick={() => {
                        setPage("bms-manager");
                        setShowDeviceMenu(false);
                      }}
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                        page === "bms-manager"
                          ? "bg-[var(--brand-10)] text-[var(--brand)]"
                          : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                      }`}
                    >
                      จัดการอุปกรณ์
                    </button>
                  )}
                  {pages.find((p) => p.id === "install-firmware") && (
                    <button
                      type="button"
                      onClick={() => {
                        setPage("install-firmware");
                        setShowDeviceMenu(false);
                      }}
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                        page === "install-firmware"
                          ? "bg-[var(--brand-10)] text-[var(--brand)]"
                          : "text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                      }`}
                    >
                      ติดตั้งเฟิร์มแวร์
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <UserMenu user={user} />
          <button
            type="button"
            onClick={() => setShowLogoutModal(true)}
            title="Logout"
            className="group inline-flex size-8 cursor-pointer items-center justify-center rounded-full bg-[var(--card)] text-[var(--critical)] ring-1 ring-[var(--border)] shadow-sm transition-all duration-200 hover:bg-red-50 hover:ring-red-200 hover:scale-105 active:scale-95"
          >
            <LogOut className="size-4 transition-transform duration-300 group-hover:-translate-x-0.5" />
          </button>
        </div>
      </div>

      {activePage === "dashboard" && <BMSDashboard />}
      {activePage === "admin" && <AdminMonitor />}

      {activePage === "bms-manager" && (
        <div className="mx-auto max-w-7xl px-3 py-6 sm:px-5 md:px-7">
          <BmsManager />
        </div>
      )}

      {activePage === "install-firmware" && (
        <div className="mx-auto max-w-7xl px-3 py-6 sm:px-5 md:px-7">
          <Suspense
            fallback={
              <div className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-8 text-sm text-[var(--muted-foreground)]">
                <span className="size-4 animate-spin rounded-full border-2 border-[var(--muted-foreground)] border-t-transparent" />
                กำลังโหลดเครื่องมือติดตั้ง Firmware...
              </div>
            }
          >
            <ESPFirmwareInstaller />
          </Suspense>
        </div>
      )}

      <LogoutModal
        isOpen={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        onConfirm={() => {
          setShowLogoutModal(false);
          logout();
        }}
      />
    </HubDataProvider>
  );
}

function Gate() {
  const { isAuthenticated, loading } = useAuth();
  const [view, setView] = useState("home");

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center">Loading...</div>;
  }

  if (isAuthenticated) return <AuthedApp />;

  if (view === "login") {
    return <Login onBackToHome={() => setView("home")} />;
  }

  return <HomePage onGoToLogin={() => setView("login")} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <ThemeRoot>
          <AuthProvider>
            <Gate />
          </AuthProvider>
        </ThemeRoot>
      </ThemeProvider>
    </BrowserRouter>
  );
}
