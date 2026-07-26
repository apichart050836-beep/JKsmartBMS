
import React, { useState, useEffect, useCallback } from "react";
import { ArrowUpRight, ArrowDownRight, Cable, RefreshCw, WifiOff, Clock, MessageCircleQuestion } from "lucide-react";
import { clamp, statusTone, voltDiffToneWithThreshold } from "./lib/tone.js";
import { useBmsPackLive } from "./hooks/useBmsPackLive.js";
import { useHubDevices } from "./hooks/useHubDevices.js";
import { DetailedLog } from "./components/DetailedLog.jsx";
import { SystemHero } from "./components/SystemHero.jsx";
import { SensorRow } from "./components/SensorRow.jsx";
import { CommunicationPanel } from "./components/CommunicationPanel.jsx";
import { PowerFlowChart } from "./components/PowerFlowChart.jsx";
import { ChargeDischargeChart } from "./components/ChargeDischargeChart.jsx";
import { SettingsPanel } from "./components/SettingsPanel.jsx";
import { TopBar } from "./components/TopBar.jsx";
import { Modal } from "./components/Modal.jsx";
import { api } from "./lib/apiClient.js";
import { useAuth } from "./context/AuthContext.jsx";
import { LogoutModal } from "./components/LogoutModal";
import { computeAlarms } from "./lib/alarms.js";
import { AlarmList } from "./components/AlarmList.jsx";
import { AnnouncementBanner } from "./components/AnnouncementBanner.jsx";
import { useDailyEnergy } from "./hooks/useDailyEnergy.js";
/**
 * Design language cloned from the ThemeWagon "Smart Home" dashboard template:
 * white bg-card tiles (rounded-2xl, ring-1 ring-border, shadow-sm) floating on a
 * muted page canvas, a single --brand accent, icon avatars in brand-tinted
 * rounded-xl chips, and a 270deg arc gauge (see energy-widget.tsx in the kit)
 * reused here for SOC / SOH. Tokens are declared as CSS vars so the file has
 * zero dependency on the kit's tailwind/shadcn setup.
 */

// React hooks must be called an unconditional, fixed number of times per
// render - can't call useBmsPackLive in a loop sized to however many real
// devices Firebase happens to report. This is that fixed ceiling: always
// call the hook this many times, but only ever RENDER tabs/data for slots
// that a real discovered device got assigned to (see `slots` below). Not a
// device-identity hardcode - just headroom past the 3 devices seen live
// today so a 4th doesn't need a code change; bump it if the fleet outgrows it.
const MAX_BMS_SLOTS = 10;

// Applied to every discovered device uniformly - the reference-screenshot
// OVP/UVP numbers (2.70V/1.80V) don't fit this pack's real chemistry (live
// cells sit ~3.0-3.2V, which would trip a false OVP alarm on every cell
// immediately). Standard LiFePO4 protection points instead; edit anytime
// per-pack in Configuration.
const LIFEPO4_VOLTAGE_DEFAULTS = {
  cellOvp: 3.65,
  cellRcv: 3.55,
  socFullVolt: 3.45,
  cellOvpr: 3.4,
  cellUvpr: 2.9,
  soc0Volt: 2.6,
  cellUvp: 2.5,
    pwrOffVolt: 2.2,
};


// Builds the fixed-length slot list useBmsPackLive is called against. Slot
// `id` is positional (`bms-slot-N`) and stable from the very first render,
// deliberately NOT derived from the device key - device discovery is async,
// so an id that changed once real data arrived would silently orphan
// whatever tab/settings the user already had selected.
//
// `devices` is every {hubId, bmsKey} pair the backend has already filtered
// to this session (role=admin -> every hub, role=user -> only their own).
function buildBmsSlots(devices) {
  return Array.from({ length: MAX_BMS_SLOTS }, (_, i) => {
    const device = devices[i] ?? null;
    const hubId = device?.hubId ?? null;
    const bmsKey = device?.bmsKey ?? null;
    return {
      id: `bms-slot-${i}`,
      name: `BMS ${i + 1}`,
      live: !!hubId,
      hubId,
      bmsKey,
      deviceKey: hubId ? (bmsKey ?? hubId) : null,
      path: hubId ? (bmsKey ? `JK_BMS_HUB/${hubId}/${bmsKey}` : `JK_BMS_HUB/${hubId}`) : null,
      ratedCapacityAh: 50, // JK reports nominal_capacity itself; this is just the pre-connect fallback
      cellCount: 4,
      voltageDefaults: LIFEPO4_VOLTAGE_DEFAULTS,
    };
  });
}

// The bridge firmware has gone through more than one settings field-naming
// scheme (snake_case like cell_ovp/cell_count, then camelCase/public names
// like overVoltageProtection/cellCount) - `fb` is the CURRENT name (also
// what saveSetting() writes going forward), `legacy` lists older names to
// still read from if the ESP32 hasn't been reflashed with the latest
// jkbms-bridge.yaml yet. Every key the dashboard actually has a real
// firmware-backed field for needs an entry here - reads only merge in keys
// listed in this map, there's no implicit passthrough for the rest (the
// other Configuration fields - emergency timer, UART protocol, calibration,
// etc - have no corresponding entity in the component at all yet).
// This whole map now treats the exact field-name convention from the
// reference payload (e072a1d6dd18's live data, pasted in chat) as the
// canonical/primary `fb` name throughout - snake_case for nearly
// everything. Names that were previously primary (mostly this dashboard's
// own camelCase guesses, never actually confirmed live on any device) are
// now demoted to `legacy` fallbacks for C847807A5311/A867307A5T&9, which
// still report the older convention.
const REMOTE_SETTINGS_MAP = {
  myCustomName: { fb: "my_custom_name", legacy: ["myBmsCustomName"] },
  cellOvp: { fb: "cell_ovp", legacy: ["overVoltageProtection"] },
  cellOvpr: { fb: "cell_ovpr", legacy: ["overVoltageRecovery"] },
  // The real firmware only tracks one OVP-recovery register; mirror it into
  // both dashboard fields rather than inventing a second one.
  cellRcv: { fb: "cell_ovpr", legacy: ["overVoltageRecovery"] },
  cellUvp: { fb: "cell_uvp", legacy: ["underVoltageProtection"] },
  cellUvpr: { fb: "cell_uvpr", legacy: ["underVoltageRecovery"] },
  cellCount: { fb: "cell_count", legacy: ["cellCount"] },
  capacityAh: { fb: "capacity", legacy: ["capacityAh"] },
  balancer: { fb: "balancer", legacy: ["balancerSwitch"] },
  // "charge"/"discharge" are the canonical write/read names per explicit
  // instruction - match status.charge/status.discharge's own naming too
  // (were "chargingSwitch"/"dischargingSwitch" before).
  charge: { fb: "charge", legacy: ["chargingSwitch"] },
  discharge: { fb: "discharge", legacy: ["dischargingSwitch"] },
  maxBalCurrent: { fb: "max_bal_current", legacy: ["maxBalCurrent", "maxBalanceCurrent"] },
  balStartVolt: { fb: "bal_start_volt", legacy: ["balStartVolt"] },
  // Firmware stores this in volts (e.g. 0.016); dashboard shows/edits mV.
  balDeltaVolt: {
    fb: "bal_delta_volt",
    legacy: ["balDeltaVolt"],
    toDash: (v) => v * 1000,
    toFb: (v) => v / 1000,
  },
  disableTempSensor: { fb: "disable_temp", legacy: ["disableTempSensor"] },
  chargeFloatMode: { fb: "float_mode", legacy: ["chargeFloatMode"] },
  // "timed_stored_data" and older "timed_data" both exist on e072a1d6dd18 -
  // name match to the dashboard's own "timedStoredData" is closer.
  timedStoredData: { fb: "timed_stored_data", legacy: ["timed_data", "timedStoredData"] },
  // "discharge_ocp_2"/"discharge_ocp_3" superseded the older bare "ocp_2".
  dsgOcp2: { fb: "discharge_ocp_2", legacy: ["ocp_2", "dsgOcp2"] },
  dsgOcp3: { fb: "discharge_ocp_3", legacy: ["dsgOcp3"] },
  // Delay/recovery timers, confirmed live on e072a1d6dd18 (charge_ocp_delay:
  // 300, charge_ocpr_time: 400, discharge_ocp_delay: 300,
  // discharge_ocpr_time: 60) - none of these four had any mapping before.
  chgOcpDelay: { fb: "charge_ocp_delay" },
  chgOcprTime: { fb: "charge_ocpr_time" },
  dsgOcpDelay: { fb: "discharge_ocp_delay" },
  dsgOcprTime: { fb: "discharge_ocpr_time" },
  emergency: { fb: "emergency_trigger", legacy: ["emergencyTrigger"] },
  disLimiter: { fb: "disable_pcl", legacy: ["disLimiter"] },
  lcdAlwaysOn: { fb: "display_always_on", legacy: ["lcdAlwaysOn"] },
  socFullVolt: { fb: "cell_soc100_voltage", legacy: ["socFullVolt"] },
  soc0Volt: { fb: "cell_soc0_voltage", legacy: ["soc0Volt"] },
  pwrOffVolt: { fb: "power_off_voltage", legacy: ["pwrOffVolt"] },
  contChgCurr: { fb: "continued_charge_current", legacy: ["contChgCurr"] },
  contDsgCurr: { fb: "max_discharge_current", legacy: ["contDsgCurr"] },
  intermittentAlarm: { fb: "alarm_intermittent", legacy: ["intermittentAlarm"] },
  lcdBuzzerTrigger: { fb: "lcd_buzzer_trigger", legacy: ["lcdBuzzerTrigger"] },
  dry1Trigger: { fb: "dry1_trigger", legacy: ["dry1Trigger"] },
  // Newly confirmed live on e072a1d6dd18 - none of these three had ANY
  // mapping before (Configuration showed local-only defaults, no real sync).
  chgOtp: { fb: "charge_otp" },
  chgUtp: { fb: "charge_utp" },
  dsgOtp: { fb: "discharge_otp" },
  // No plain "discharge_utp" field exists - discharge_undertemperature_
  // protection is the real name for this concept.
  dsgUtp: { fb: "discharge_undertemperature_protection" },
  // Recovery counterparts, confirmed live on e072a1d6dd18 alongside the OTP/
  // UTP fields above (charge_otpr: 59, charge_utpr: 16, discharge_otpr: 60,
  // cmos_otp: 80, cmos_otpr: 70).
  chgOtpr: { fb: "charge_otpr" },
  chgUtpr: { fb: "charge_utpr" },
  dsgOtpr: { fb: "discharge_otpr" },
  cmosOtp: { fb: "cmos_otp" },
  cmosOtpr: { fb: "cmos_otpr" },
  cellRfv: { fb: "cell_rfv" },
  // Confirmed live on e072a1d6dd18 (30) - "Emerg. Timer" had no mapping
  // before, Configuration always showed the local-only default.
  emergTimer: { fb: "emergency_duration" },
  // RCV Time maps by name to cell_rcv_time (even though its value happens
  // to mirror cell_rcv's voltage on this device - per explicit
  // confirmation, that's still the correct field to bind to). RFV Time is
  // a separate new field for cell_rfv_time (the other, distinct time value).
  rcvTime: { fb: "cell_rcv_time" },
  rfvTime: { fb: "cell_rfv_time" },
  // Not live on any of the 3 devices yet (same situation max_bal_current
  // was in before it appeared) - wired as the forward-looking name per
  // explicit instruction, ready the moment firmware starts reporting it.
  currCalibration: { fb: "current_calibration" },
  //
  // Values are the descriptive protocol strings themselves (e.g. "JK BMS
  // RS485 Modbus V1.0"), not a numeric code - confirmed from both the real
  // BMS app's own <select> markup and live Firebase data.
  canProtocol: { fb: "can_protocol", legacy: ["canProtocol"] },
  uart1Protocol: { fb: "uart1_protocol", legacy: ["uart1Protocol"] },
  uart2Protocol: { fb: "uart2_protocol", legacy: ["uart2Protocol"] },
  uart3Protocol: { fb: "uart3_protocol", legacy: ["uart3Protocol"] },
};

function defaultSettings(pack) {
  return {
      // Control & Core
    myCustomName: "",
    charge: true,
    discharge: true,
    emergency: false,
    disLimiter: false,
    lcdAlwaysOn: false,
    cellCount: pack.cellCount ?? 16,
    capacityAh: pack.ratedCapacityAh,
    // Active Balancer
    balancer: true,
    balDeltaVolt: 20,
    balStartVolt: 3.3,
    maxBalCurrent: 1.0,
    // Voltage Protection
    cellOvp: 2.7,
    cellRcv: 2.68,
    socFullVolt: 2.65,
    cellOvpr: 2.64,
    cellUvpr: 1.85,
    soc0Volt: 1.84,
    cellUvp: 1.8,
    pwrOffVolt: 1.7,
    ...pack.voltageDefaults,
    // Current Protection
    contChgCurr: 100,
    contDsgCurr: 100,
    dsgOcp2: true,
    dsgOcp3: true,
    chgOcpDelay: 300,
    chgOcprTime: 400,
    dsgOcpDelay: 300,
    dsgOcprTime: 60,
    // Temperature Protection
    disableTempSensor: false,
    chgOtp: 55,
    chgUtp: 0,
    dsgOtp: 60,
    dsgUtp: -20,
    chgOtpr: 59,
    chgUtpr: 16,
    dsgOtpr: 60,
    cmosOtp: 80,
    cmosOtpr: 70,
    // Data and Communication
    deviceAddress: 1,
    timedStoredData: true,
    dataStoredPeriod: 3600,
    // Real values are the descriptive strings themselves (e.g. "JK BMS
    // RS485 Modbus V1.0"), not numeric codes - CAN and UART1/2/3 have their
    // OWN separate option pools, see CAN_PROTOCOL_LIST/UART_PROTOCOL_LIST.
    canProtocol: "JK BMS CAN Protocol (250K) V2.0",
    uart1Protocol: "JK BMS RS485 Modbus V1.0",
    uart2Protocol: "4G-GPS Remote module Common protocol V4.2",
    uart3Protocol: "4G-GPS Remote module Common protocol V4.2",
    // Alarm and Emergency
    intermittentAlarm: true,
    emergTimer: 10,
    // Real values are the descriptive strings themselves (e.g. "MOSFET Over
    // Temperature"), not numeric codes - see TRIGGER_LIST.
    lcdBuzzerTrigger: "OFF",
    dry1Trigger: "OFF",
    // Charge Control
    chargeFloatMode: false,
    cellRfv: 3.4,
    rcvTime: 30,
    rfvTime: 5,
    // Calibration (Factory Only) - 0 until seeded from the real
    // status.battery_voltage reading (see the one-time seed effect below),
    // not a hardcoded guess. The old 52.58 default was a leftover from the
    // original 16S mock spec and never matched this real 4S (~12.8V) pack.
    voltCalibration: 0,
    currCalibration: 0,
  };
}

function Pill({ tone = "brand", icon: Icon, children }) {
  const t = statusTone(tone);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${t.bg} ${t.fg}`}>
      {Icon && <Icon className="size-3" />}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main dashboard
// ---------------------------------------------------------------------------

export default function BMSDashboard() {
  const { logout } = useAuth();
  const [now, setNow] = useState(new Date());
  const [activeBmsId, setActiveBmsId] = useState("bms-slot-0");
  const [showLog, setShowLog] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showAlarms, setShowAlarms] = useState(false);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [saveError, setSaveError] = useState(null);
  // The only thing that's actually dynamic per render - which devices the
  // backend has reported for this session (already role-filtered
  // server-side). Everything else below (slot count, defaults) is a fixed,
  // uniform structure built around this.
  const { devices, loaded: hubLoaded } = useHubDevices();
  const slots = buildBmsSlots(devices);

  // Each pack keeps its own configuration, edited via the Configuration
  // modal. Every slot uses the same uniform defaults (see buildBmsSlots),
  // so this doesn't need to wait on device discovery to initialize.
  const [settingsByPack, setSettingsByPack] = useState(() =>
    Object.fromEntries(slots.map((b) => [b.id, defaultSettings(b)]))
  );
  const settings = settingsByPack[activeBmsId];

  // Hooks must run an unconditional, fixed number of times per render - see
  // MAX_BMS_SLOTS. Slots with no device assigned yet just get `path: null`,
  // which useBmsPackLive treats as "nothing to subscribe to" rather than
  // erroring.
  const bms0 = useBmsPackLive(slots[0]);
  const bms1 = useBmsPackLive(slots[1]);
  const bms2 = useBmsPackLive(slots[2]);
  const bms3 = useBmsPackLive(slots[3]);
  const bms4 = useBmsPackLive(slots[4]);
  const bms5 = useBmsPackLive(slots[5]);
  const bms6 = useBmsPackLive(slots[6]);
  const bms7 = useBmsPackLive(slots[7]);
  const bms8 = useBmsPackLive(slots[8]);
  const bms9 = useBmsPackLive(slots[9]);

  const packs = [bms0, bms1, bms2, bms3, bms4, bms5,bms6,bms7,bms8,bms9];
  const active = packs.find((p) => p.id === activeBmsId) ?? packs[0];
  const activeConfig = slots.find((b) => b.id === activeBmsId) ?? slots[0];

  // Real today-so-far charged/discharged Ah & Wh, computed server-side from
  // actual telemetry_log rows (V x I x t via the real signed charge_current
  // field) - not Firebase's dailyChargeAh/dailyDischargeAh, which don't
  // exist on any real device and always read 0.
  const dailyEnergy = useDailyEnergy(activeConfig.hubId, activeConfig.bmsKey);
  const activeEnergy = { chargedAh: dailyEnergy.chargedAh, dischargedAh: dailyEnergy.dischargedAh };
  const activeAlarms = computeAlarms(active, settings);
  // Prefer the custom name synced from settings.my_custom_name, then the
  // raw ESP32/device id itself - always shows *something* identifiable
  // rather than falling back to a MAC that's no longer meaningfully
  // available per-slot now that devices are discovered, not individually
  // hardcoded.
  const activeDeviceLabel = settings.myCustomName || activeConfig.deviceKey;

  // Pull real Configuration values back from Firebase for every live pack,
  // in real time - `.../settings` is the same node saveSetting() writes to,
  // so whatever's actually stored there (from the BMS itself, or a previous
  // save from this app) overrides that pack's local defaults the instant it
  // loads or changes. Any key Firebase doesn't have yet keeps its local
  // default. Dependency array is fixed-length (one entry per hook-call
  // slot) same as the hook calls above - reacts to any slot's remoteSettings
  // changing, not just one.
  useEffect(() => {
    setSettingsByPack((s) => {
      const next = { ...s };
      for (const pack of packs) {
        if (!pack.remoteSettings) continue;
        const patch = {};
        for (const [dashKey, m] of Object.entries(REMOTE_SETTINGS_MAP)) {
          const rawKey = [m.fb, ...(m.legacy ?? [])].find((k) => pack.remoteSettings[k] !== undefined);
          if (rawKey === undefined) continue;
          const raw = pack.remoteSettings[rawKey];
          patch[dashKey] = m.toDash ? m.toDash(raw) : raw;
        }
        next[pack.id] = { ...next[pack.id], ...patch };
      }
      return next;
    });
  }, [
    bms0.remoteSettings,
    bms1.remoteSettings,
    bms2.remoteSettings,
    bms3.remoteSettings,
    bms4.remoteSettings,
    bms5.remoteSettings,
    bms6.remoteSettings,
    bms7.remoteSettings,
    bms8.remoteSettings,
    bms9.remoteSettings,
  ]);

  // Volt Calibration has no real settings field of its own yet - seed its
  // local value from the real status.battery_voltage reading ONCE per pack
  // (only while still at the untouched 0 default), so Configuration opens
  // showing a real starting point instead of 0/a guessed constant. Doesn't
  // continuously rebind after that - that would fight anyone actively
  // typing a new value (the "pull" button in Configuration covers on-demand
  // re-sync instead).
  useEffect(() => {
    setSettingsByPack((s) => {
      let changed = false;
      const next = { ...s };
      for (const pack of packs) {
        const raw = pack.batteryVoltageRaw;
        if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
        if (next[pack.id]?.voltCalibration !== 0) continue;
        next[pack.id] = { ...next[pack.id], voltCalibration: raw };
        changed = true;
      }
      return changed ? next : s;
    });
  }, [
    bms0.batteryVoltageRaw,
    bms1.batteryVoltageRaw,
    bms2.batteryVoltageRaw,
    bms3.batteryVoltageRaw,
    bms4.batteryVoltageRaw,
    bms5.batteryVoltageRaw,
    bms6.batteryVoltageRaw,
    bms7.batteryVoltageRaw,
    bms8.batteryVoltageRaw,
    bms9.batteryVoltageRaw,
  ]);

  // Single write-path for every Configuration row (toggle, input+OK, or
  // dropdown+OK). Updates local state immediately; for the live pack it also
  // pushes to `${path}/settings/${key}` in Firebase. NOTE: that sub-path is a
  // guess - confirm it's actually what your ESP32 firmware listens to for
  // remote config writes (vs. e.g. a structured "cmd" node), and adjust here
  // if not.
  //
  // Blocked entirely (no local state change, no Firebase write) when Admin
  // Monitor has disabled this device - the Configuration button is also
  // disabled below so the panel shouldn't normally even be open in this
  // state, but this guard covers it regardless of how saveSetting gets
  // called (e.g. a modal left open from before the toggle flipped).
  const saveSetting = (key, value) => {
    if (active.isLive && active.adminDisabled) return;
    setSettingsByPack((s) => ({
      ...s,
      [activeBmsId]: { ...s[activeBmsId], [key]: value },
    }));
    if (activeConfig.live && activeConfig.hubId) {
      const m = REMOTE_SETTINGS_MAP[key];
      const fbKey = m?.fb ?? key;
      const fbValue = m?.toFb ? m.toFb(value) : value;
      api
        .saveSetting(activeConfig.hubId, activeConfig.bmsKey, fbKey, fbValue)
        .then(() => setSaveError(null))
        .catch((err) => {
          console.error(`Failed to save "${key}"`, err);
          setSaveError(err.message || "Failed to save setting");
        });
    }
  };

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // --- Config-driven derived values (the "State Driven" / "Auto-Calc" requirements) ---
  // Capacity is a settings value now, not a fixed constant: remaining Ah is the
  // physical ground truth from the simulation, so SOC% recalculates instantly
  // whenever Capacity changes. Cell Count is surfaced in labels only - it isn't
  // folded into the SOC formula, since series cell count doesn't change how much
  // charge (Ah) a pack holds.
  const effectiveCapacityAh = settings.capacityAh;
  const displaySoc = clamp((active.remainingAh / effectiveCapacityAh) * 100, 0, 100);

  const balDeltaVolt = settings.balDeltaVolt;
  const vd = voltDiffToneWithThreshold(active.voltDiffMv, balDeltaVolt);

  // Live packs have no write-back path yet, so their MOS/Balancer status
  // lights reflect real hardware telemetry, not the Settings toggles. Every
  // pack is live now, so the `: settings.x` side of these never actually
  // runs - kept as a fallback in case a non-live pack shape returns.
  const chargeMOS = active.isLive ? active.chargeMOS : settings.charge;
  const dischargeMOS = active.isLive ? active.dischargeMOS : settings.discharge;
  const balancerOn = active.isLive ? active.balancerOn : settings.balancer;

  // Charging uses the (typically stricter) Charge OTP limit, otherwise the
  // Discharge OTP limit - matches which protection would actually trip.
  const otpLimit = active.status === "Charging" ? settings.chgOtp : settings.dsgOtp;

  // Fill bar is scaled against the actual UVP-OVP protection window, not the
  // pack's own min/max spread - a healthy 4S LiFePO4 pack sitting at ~3.1V
  // (UVP 2.50V / OVP 3.65V) should read as roughly half-full, not "nearly
  // empty to nearly full" just because all 4 cells happen to be within a
  // few mV of each other.
  const cellFillPct = useCallback(
    (v) => {
      const span = settings.cellOvp - settings.cellUvp || 0.02;
      return clamp(((v - settings.cellUvp) / span) * 100, 4, 100);
    },
    [settings.cellOvp, settings.cellUvp]
  );

  // Every pack is live now and needs BOTH signals to count as Online:
  // - firebaseConnected: Firebase's own ".info/connected" presence path,
  //   which flips false the moment the SDK's websocket actually times out
  //   or drops (this is the "does Firebase respond" check).
  // - fresh data: a status snapshot within the last few push cycles
  //   (jkbms-bridge.yaml pushes every 5s - 3x that gives room for normal
  //   jitter). Firebase itself can be reachable while the ESP32/BLE link
  //   is dead, so connectivity to Firebase alone isn't enough to call the
  //   device Online.
  const STALE_AFTER_MS = 15000;
  const isOnline = active.isLive
    ? !!active.firebaseConnected &&
      !!active.lastUpdateAt &&
      now.getTime() - active.lastUpdateAt < STALE_AFTER_MS
    : true;

  // Auto-pops when the active pack goes offline, asking the user to
  // refresh - but only after 5s of SUSTAINED offline, not the instant
  // isOnline flips false. A brief blip that recovers on its own shouldn't
  // interrupt anyone; the effect's cleanup cancels the pending timer the
  // moment isOnline goes back true before it fires, so nothing shows at all
  // for a quick reconnect.
  const [confirmedOffline, setConfirmedOffline] = useState(false);
  useEffect(() => {
    if (isOnline) {
      setConfirmedOffline(false);
      return;
    }
    const timer = setTimeout(() => setConfirmedOffline(true), 5000);
    return () => clearTimeout(timer);
  }, [isOnline]);

  // Dismissible (closing it shouldn't force it back open every render while
  // still offline), but resets once we're back online - so a fresh
  // disconnect later pops it again instead of staying silenced forever.
  // Debounced the same 5s as confirmedOffline (not the instant isOnline
  // flips true): a flapping connection that reconnects only to drop again
  // moments later used to re-arm the dismissal instantly, popping the modal
  // right back up - annoying, reported live as "alerts too often". Requiring
  // 5s of SUSTAINED online before resetting the dismissal fixes that.
  const [offlineDismissed, setOfflineDismissed] = useState(false);
  useEffect(() => {
    if (!isOnline) return;
    const timer = setTimeout(() => setOfflineDismissed(false), 5000);
    return () => clearTimeout(timer);
  }, [isOnline]);
  const showOfflineModal = active.isLive && confirmedOffline && !offlineDismissed;

  return (
      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-5 sm:py-6 md:px-7">
      {!hubLoaded ? (
        <div className="flex items-center justify-center p-16 text-sm text-[var(--muted-foreground)]">
          กำลังโหลดข้อมูลอุปกรณ์...
        </div>
      ) : devices.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-3xl bg-[var(--card)] p-16 text-center shadow-sm ring-1 ring-[var(--border)]">
          <p className="text-lg font-bold text-[var(--foreground)]">ยังไม่พบอุปกรณ์ BMS ที่เชื่อมกับบัญชีนี้</p>
        </div>
      ) : (
        <>
        {/* Top Bar: BMS 1-N (left) + System Log / Configuration (right) */}
        <TopBar
          tabs={slots.filter((s) => s.live).map((s) => ({ id: s.id, name: s.name, mac: s.deviceKey }))}
          activeBmsId={activeBmsId}
          onSelectBms={setActiveBmsId}
          onOpenLog={() => setShowLog(true)}
          onOpenConfig={() => setShowConfig(true)}
          configDisabled={active.isLive && active.adminDisabled}
          onLogout={() => setIsLogoutModalOpen(true)}
        />
        <AnnouncementBanner />
        <LogoutModal
            isOpen={isLogoutModalOpen}
            onClose={() => setIsLogoutModalOpen(false)}
            onConfirm={logout}
        />
        {active.isLive && active.adminDisabled ? (
          <div className="mt-5 flex flex-col items-center justify-center gap-2 rounded-3xl bg-[var(--card)] p-16 text-center shadow-sm ring-1 ring-[var(--border)]">
            <p className="text-lg font-bold text-[var(--foreground)]">ถูกปิดโดย Admin</p>
            <p className="max-w-sm text-sm text-[var(--muted-foreground)]">
              หากติดปัญหา กรุณาติดต่อ ID Line: Poote3105
            </p>
          </div>
        ) : (
          <>
            {/* JK BMS Control Center - Main Console Panel (Power & Energy + Remaining & Health) */}
            <SystemHero
              deviceLabel={activeDeviceLabel}
              hubAccount={active.isLive ? activeConfig.hubId : undefined}
              isOnline={isOnline}
              onRefresh={() => window.location.reload()}
              cellCount={settings.cellCount}
              batteryType={active.info?.battery_type}
              maxBalancerCurrentA={settings.maxBalCurrent}
              power={active.power}
              status={active.status}
              current={active.current}
              packVoltage={active.packVoltage}
              ratedCapacityAh={effectiveCapacityAh}
              remainingAh={active.remainingAh}
              socPercent={displaySoc}
              cellAvgVoltage={active.cells.length ? active.cells.reduce((a, b) => a + b, 0) / active.cells.length : 0}
              soh={active.soh}
              chargedAh={activeEnergy.chargedAh}
              dischargedAh={activeEnergy.dischargedAh}
              chargeMOS={chargeMOS}
              dischargeMOS={dischargeMOS}
              balancerOn={balancerOn}
              balancerCurrentA={active.balancerCurrent}
              voltDiffMv={active.voltDiffMv}
              voltDiffTone={vd.tone}
              now={now}
              alarms={activeAlarms}
              onOpenAlarms={() => setShowAlarms(true)}
                                      />

           {/* Power Flow: charge/discharge current over time, 0-baseline split */}
            <div className="mt-3 space-y-5">
             <PowerFlowChart
               packVoltage={active.packVoltage}
               current={active.current}
               chargedAh={activeEnergy.chargedAh}
               dischargedAh={activeEnergy.dischargedAh}
               chargedWh={dailyEnergy.chargedWh}
               dischargedWh={dailyEnergy.dischargedWh}
               socPercent={displaySoc}
               history={active.powerHistory}
             />
                                      </div>

        <div className="mt-3 space-y-5">
          {/* Sensor Row: Temperature / Cycle Information (Capacity + Count combined) */}
          <SensorRow
            channels={active.tempChannels}
            temps={active.temps}
            maxTemp={active.maxTemp}
            otpLimit={otpLimit}
            cycleAh={active.cycleAh}
            cycleCount={active.cycleCount}
          />

                                          {/* Section 2: Cell Voltage Monitoring - wire/connector resistance
              (wiring/busbar connection quality per cell tap, NOT the cell's
              own internal resistance) is folded into each cell tile below,
              labeled "Wire" with a plug icon so it can't be mistaken for the
              cell's IR. */}
                                          <section className="rounded-2xl bg-[var(--card)] p-5 shadow-sm ring-1 ring-[var(--border)] md:p-6">
                                              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                                                  <div>
                                                      <h2 className="text-sm font-semibold text-[var(--foreground)]">
                                                          Cell Voltage Monitoring · {settings.cellCount}S
                                                      </h2>
                                                      {active.wireResistances?.some((r) => typeof r === "number" && r > 0) && (
                                                          <p className="mt-0.5 flex items-center gap-1 text-[10px] text-[var(--muted-foreground)]">
                                                              <Cable className="size-3" />
                                                              "Wire" = wiring/busbar connection resistance per cell tap, not the cell's own internal resistance (IR)
                                                          </p>
                                                      )}
                                                  </div>
                                                  <div className="flex flex-wrap items-center gap-2">
                                                      <Pill tone="warning" icon={ArrowUpRight}>
                                                          Max C{active.maxIdx + 1} · {active.maxV.toFixed(3)}V
                                                      </Pill>
                                                      <Pill tone="info" icon={ArrowDownRight}>
                                                          Min C{active.minIdx + 1} · {active.minV.toFixed(3)}V
                                                      </Pill>
                                                      <Pill tone={vd.tone}>ΔV {active.voltDiffMv}mV</Pill>
                                                  </div>
                                              </div>

                                              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
                                                  {active.cells.map((v, i) => {
                                                      const isMax = i === active.maxIdx;
                                                      const isMin = i === active.minIdx;
                                                      const pct = cellFillPct(v);
                                                      const isOverVoltage = v > settings.cellOvp;
                                                      const isUnderVoltage = v < settings.cellUvp;
                                                      const isBreach = isOverVoltage || isUnderVoltage;
                                                      const tone = isBreach ? "critical" : isMax ? "warning" : isMin ? "info" : null;
                                                      const t = tone ? statusTone(tone) : null;
                                                      const fillColor = t ? t.stroke : "var(--brand)";
                                                      const ohm = active.wireResistances?.[i];
                                                      const hasWireValue = typeof ohm === "number" && ohm > 0;
                                                      const badge = isBreach ? (isOverVoltage ? "OVP" : "UVP") : isMax ? "MAX" : isMin ? "MIN" : null;

                                                      return (
                                                          <div
                                                              key={i}
                                                              className={`relative rounded-lg p-1 text-center ring-1 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${t ? `${t.bg} ring-[var(--border)]` : "bg-[var(--card)] ring-[var(--border)]"
                                                                  }`}
                                                          >
                                                              {badge && (
                                                                  <span
                                                                      className={`absolute -right-1 -top-1 rounded-full px-1 py-0.5 text-[7px] font-bold text-white shadow-sm ${isBreach ? "animate-pulse" : ""}`}
                                                                      style={{ backgroundColor: isBreach ? "var(--critical)" : isMax ? "var(--warning)" : "var(--info)" }}
                                                                  >
                                                                      {badge}
                                                                  </span>
                                                              )}

                                                              <div className={`text-[9px] font-semibold ${t ? t.fg : "text-[var(--muted-foreground)]"}`}>
                                                                  C{i + 1}
                                                              </div>

                                                              <div className="text-xs font-bold text-[var(--foreground)] tabular-nums">{v.toFixed(3)}</div>

                                                              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[var(--border)]">
                                                                  <div
                                                                      className="h-full rounded-full transition-all duration-500"
                                                                      style={{ width: `${pct}%`, backgroundColor: fillColor }}
                                                                  />
                                                              </div>

                                                              {hasWireValue && (
                                                                  <div className="mt-0.5 flex items-center justify-center gap-0.5 text-[8px] text-[var(--muted-foreground)]">
                                                                      <Cable className="size-2" />
                                                                      {Math.round(ohm * 1000)}mΩ
                                                                  </div>
                                                              )}
                                                          </div>
                                                      );
                                                  })}
                                              </div>
                                          </section>

          <ChargeDischargeChart history={active.powerHistory} hubId={activeConfig.hubId} bmsKey={activeConfig.bmsKey} />

          {/* Communication: CAN / UART1-3 protocol status */}
          <CommunicationPanel remoteSettings={active.remoteSettings} />
        </div>

        <p className="mt-5 text-center text-[11px] text-[var(--muted-foreground)]">
          Live telemetry from Firebase RTDB · viewing {active.name}
        </p>
          </>
        )}

      <Modal open={showLog} onClose={() => setShowLog(false)} title={`System Log · ${active.name}`}>
        <DetailedLog entries={active.log} />
      </Modal>

      <Modal open={showAlarms} onClose={() => setShowAlarms(false)} title={`Alarms · ${active.name}`} maxWidthClass="max-w-md">
        <AlarmList alarms={activeAlarms} />
      </Modal>

      <Modal open={showConfig} onClose={() => setShowConfig(false)} title={`Configuration · ${active.name}`} maxWidthClass="max-w-4xl">
        <SettingsPanel
          settings={settings}
          onSaveSetting={saveSetting}
          liveBatteryVoltage={active.isLive ? active.batteryVoltageRaw : undefined}
          disabled={active.isLive && active.adminDisabled}
          customName={settings.myCustomName}
          onSaveDeviceName={(name) => saveSetting("myCustomName", name)}
          batteryType={active.info?.battery_type}
          saveError={saveError}
          onDismissSaveError={() => setSaveError(null)}
        />
      </Modal>

      <Modal open={showOfflineModal} onClose={() => setOfflineDismissed(true)} title="อุปกรณ์หลุดการเชื่อมต่อ">
        <div className="flex flex-col items-center gap-1 py-2 text-center">
          <div className="relative mb-2 flex size-16 items-center justify-center">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--critical)]/30" />
            <span className="relative flex size-16 items-center justify-center rounded-full bg-[var(--critical-10)] ring-1 ring-[var(--critical)]/30">
              <WifiOff className="size-7 text-[var(--critical)]" />
            </span>
          </div>

          <p className="text-sm font-bold text-[var(--foreground)]">{active.name} ไม่ตอบสนอง</p>
          <p className="max-w-xs text-xs text-[var(--muted-foreground)]">
            สัญญาณจาก ESP32/BLE หายไป อาจจะไฟดับ, wifi หลุด, หรือแบตอยู่นอกระยะ - ข้อมูลที่เห็นตอนนี้เป็นค่าล่าสุดก่อนหลุด ไม่ใช่ real-time แล้วนะ
          </p>

          {active.lastUpdateAt && (
            <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[var(--muted)] px-3 py-1 text-[11px] font-medium text-[var(--muted-foreground)]">
              <Clock className="size-3" />
              อัปเดตล่าสุด {new Date(active.lastUpdateAt).toLocaleTimeString()}
            </span>
          )}

          <div className="mt-5 flex w-full items-center gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--brand)] py-2.5 text-xs font-semibold text-white shadow-sm transition-transform hover:opacity-90 active:scale-95"
            >
              <RefreshCw className="size-3.5" />
              รีเฟรชเลย
            </button>
            <button
              type="button"
              onClick={() => setOfflineDismissed(true)}
              className="inline-flex items-center justify-center rounded-xl px-3 py-2.5 text-xs font-semibold text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--muted)]"
            >
              รอเดี๋ยว
            </button>
          </div>

          <p className="mt-3 flex items-center gap-1 text-[10px] text-[var(--muted-foreground)]">
            <MessageCircleQuestion className="size-3" />
            ยังไม่กลับมา? ทัก Line: Poote3105
          </p>
        </div>
      </Modal>
        </>
      )}
      </div>
  );
}
