import React, { useState, useEffect, useRef } from "react";
import { LayoutDashboard, ShieldCheck, LogOut, Cpu } from "lucide-react";
import BMSDashboard from "./BMSDashboard.jsx";
import AdminMonitor from "./AdminMonitor.jsx";
import Login from "./Login.jsx";
import HomePage from "./HomePage.jsx";
import { ThemeRoot } from "./components/ThemeRoot.jsx";
import { ThemeProvider } from "./context/ThemeContext.jsx";
import { AuthProvider, useAuth } from "./context/AuthContext.jsx";
import { HubDataProvider, useHubData } from "./context/HubDataContext.jsx";
import { LogoutModal } from "./components/LogoutModal.jsx";
import { VersionCheckModal } from "./components/VersionCheckModal.jsx";
import { FirmwareUpdateToast } from "./components/FirmwareUpdateToast.jsx";
import { FirmwareReleaseModal } from "./components/FirmwareReleaseModal.jsx";
import { api } from "./lib/apiClient.js";

// Per-device "already acted on this exact version" memory for the auto-popup
// below - keyed by device + version (not just device), so publishing a NEWER
// update after this one is acknowledged pops up again on its own, exactly
// like the older global dismissedFirmwareId in HubDataContext.jsx, just
// device-scoped instead of release-id-scoped since the real signal is a
// per-device Firebase node, not a single global row.
function deviceAckKey(hubId, bmsKey) {
  return `bms-firmware-acked-device-${hubId}-${bmsKey ?? "_"}`;
}
function getAckedDeviceVersion(hubId, bmsKey) {
  return localStorage.getItem(deviceAckKey(hubId, bmsKey));
}
function setAckedDeviceVersion(hubId, bmsKey, version) {
  localStorage.setItem(deviceAckKey(hubId, bmsKey), version);
}

// Badge next to the Dashboard pill + its two popups (manual check, and the
// auto "new firmware" notice). A separate component (not inline in
// AuthedApp) because it needs useHubData() for the firmware-release state,
// and AuthedApp itself renders <HubDataProvider> as its OWN output - a
// component can't consume context it provides in the same render, only a
// child of that render can. Same reasoning as BMSDashboard owning the
// weather feature instead of AuthedApp.
function UpdateBadge({ deviceVersions }) {
  const { firmwareRelease, firmwareIsNew, acknowledgeFirmwareRelease } = useHubData();
  const [showVersionModal, setShowVersionModal] = useState(false);
  const [manualUpdateToast, setManualUpdateToast] = useState(null);
  // "เตือนภายหลัง"/close only hides the auto-popup for THIS session on THIS
  // device - reset below whenever the active device changes, and it's never
  // set at all by a real per-device update (that path only stops the popup
  // via setAckedDeviceVersion, which is permanent-until-a-newer-version, not
  // session-only) - see requirement: pop up every time until Update is
  // actually pressed, not just until closed once.
  const [autoPopupDismissedThisSession, setAutoPopupDismissedThisSession] = useState(false);
  // Real per-device OTA trigger state (server/routes/hubs.js's
  // trigger-update route) - separate from the acknowledge-only toast, which
  // fires regardless of whether a real signal was actually sent.
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState(null);
  const [updateSent, setUpdateSent] = useState(false);

  // A new active device (tab switch) starts with a clean slate - closing the
  // popup for BMS 1 shouldn't silence it for BMS 2's own, unrelated update.
  useEffect(() => {
    setAutoPopupDismissedThisSession(false);
  }, [deviceVersions.hubId, deviceVersions.bmsKey]);

  function showUpdateToast(status) {
    setManualUpdateToast({ deviceLabel: deviceVersions.deviceLabel, version: deviceVersions.software, status });
    setTimeout(() => setManualUpdateToast(null), 6000);
  }

  const deviceFirmware = deviceVersions.firmware;
  const realIsNew = !!deviceFirmware?.latest_version && deviceFirmware.latest_version !== deviceVersions.software;
  const ackedVersion = deviceVersions.hubId ? getAckedDeviceVersion(deviceVersions.hubId, deviceVersions.bmsKey) : null;
  const realPending = realIsNew && deviceFirmware?.latest_version !== ackedVersion;
  const badgeIsNew = firmwareIsNew || realIsNew;

  async function handleRealUpdate() {
    acknowledgeFirmwareRelease();
    if (!deviceVersions.hubId) {
      // No live device backing this tab (shouldn't happen - the badge is
      // hidden without a software version - but guards against a stale
      // click racing a tab switch).
      return;
    }
    setUpdating(true);
    setUpdateError(null);
    try {
      await api.triggerFirmwareUpdate(deviceVersions.hubId, deviceVersions.bmsKey);
      setUpdateSent(true);
      if (deviceFirmware?.latest_version) {
        setAckedDeviceVersion(deviceVersions.hubId, deviceVersions.bmsKey, deviceFirmware.latest_version);
      }
      showUpdateToast("sent");
    } catch (err) {
      setUpdateError(err.message || "ส่งคำสั่งไม่สำเร็จ");
      showUpdateToast("error");
    } finally {
      setUpdating(false);
    }
  }

  if (!deviceVersions.software) return null;

  // Prefer the real per-device signal for the auto-popup (it's what admin
  // actually aimed at THIS device); only fall back to the older global
  // SQLite-backed release when this device was never specifically targeted,
  // so there's still something to announce instead of nothing.
  const popupRelease = realPending
    ? {
        isReal: true,
        version: deviceFirmware.latest_version,
        uploadedAt: deviceFirmware.uploaded_at,
        releaseNotes: deviceFirmware.release_notes,
        deviceLabel: deviceVersions.deviceLabel,
      }
    : firmwareIsNew && firmwareRelease
    ? { isReal: false, version: firmwareRelease.version, filename: firmwareRelease.filename, uploadedAt: firmwareRelease.uploadedAt }
    : null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setUpdateError(null);
          setUpdateSent(false);
          setShowVersionModal(true);
        }}
        title="ตรวจสอบอัพเดทเฟิร์มแวร์ ESP32"
        className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold transition-colors ${
          badgeIsNew
            ? "bg-[var(--brand)] text-white shadow-sm hover:opacity-90"
            : "bg-[var(--brand-10)] text-[var(--brand)] hover:opacity-80"
        }`}
      >
        <Cpu className="size-3" />
        Update
        {badgeIsNew && <span className="ml-0.5 size-1.5 animate-pulse rounded-full bg-white" />}
      </button>

      <VersionCheckModal
        open={showVersionModal}
        onClose={() => setShowVersionModal(false)}
        deviceLabel={deviceVersions.deviceLabel}
        softwareVersion={deviceVersions.software}
        hardwareVersion={deviceVersions.hardware}
        deviceFirmware={deviceFirmware}
        fallbackRelease={firmwareRelease}
        updating={updating}
        updateError={updateError}
        updateSent={updateSent}
        onUpdate={handleRealUpdate}
      />
      <FirmwareReleaseModal
        open={!!popupRelease && !autoPopupDismissedThisSession}
        release={popupRelease}
        onUpdate={() => {
          if (popupRelease?.isReal) {
            handleRealUpdate();
          } else {
            acknowledgeFirmwareRelease();
            showUpdateToast();
          }
        }}
        onRemindLater={() => setAutoPopupDismissedThisSession(true)}
      />
      <FirmwareUpdateToast update={manualUpdateToast} />
    </>
  );
}

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
  const [deviceVersions, setDeviceVersions] = useState({
    software: null,
    hardware: null,
    deviceLabel: null,
    hubId: null,
    bmsKey: null,
    firmware: null,
  });
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
          {activePage === "dashboard" && <UpdateBadge deviceVersions={deviceVersions} />}
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
