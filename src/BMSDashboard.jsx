import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { ArrowUpRight, ArrowDownRight, Cable, RefreshCw, WifiOff, Clock, MessageCircleQuestion, Zap } from "lucide-react";
import { clamp, statusTone, voltDiffToneWithThreshold } from "./lib/tone.js";
import { useBmsPackLive } from "./hooks/useBmsPackLive.js";
import { useHubDevices } from "./hooks/useHubDevices.js";
import { useHubData } from "./context/HubDataContext.jsx";
import { useWeatherLocation } from "./hooks/useWeatherLocation.js";
import { InstallationLocationModal } from "./components/InstallationLocationModal.jsx";
import { WeatherModal } from "./components/WeatherModal.jsx";
import { DetailedLog } from "./components/DetailedLog.jsx";
import { SystemHero } from "./components/SystemHero.jsx";
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
import { computeBatteryHealthScore } from "./lib/batteryHealthScore.js";
import { AlarmList } from "./components/AlarmList.jsx";
import { AnnouncementBanner } from "./components/AnnouncementBanner.jsx";
import { FirmwareUpdateToast } from "./components/FirmwareUpdateToast.jsx";
import { useDailyEnergy } from "./hooks/useDailyEnergy.js";
 

const MAX_BMS_SLOTS = 10;
const ACTIVE_BMS_STORAGE_KEY = "bms-active-tab";

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
      ratedCapacityAh: 0,
      cellCount: 4,
      voltageDefaults: LIFEPO4_VOLTAGE_DEFAULTS,
    };
  });
}

const REMOTE_SETTINGS_MAP = {
  myCustomName: { fb: "my_custom_name", legacy: ["myBmsCustomName"] },
  cellOvp: { fb: "cell_ovp", legacy: ["overVoltageProtection"] },
  cellOvpr: { fb: "cell_ovpr", legacy: ["overVoltageRecovery"] },
  cellRcv: { fb: "cell_rcv" },
  cellUvp: { fb: "cell_uvp", legacy: ["underVoltageProtection"] },
  cellUvpr: { fb: "cell_uvpr", legacy: ["underVoltageRecovery"] },
  cellCount: { fb: "cell_count", legacy: ["cellCount"] },
  capacityAh: { fb: "capacity", legacy: ["capacityAh"] },
  balancer: { fb: "balancer", legacy: ["balancerSwitch"] },
  charge: { fb: "charge", legacy: ["chargingSwitch"] },
  discharge: { fb: "discharge", legacy: ["dischargingSwitch"] },
  maxBalCurrent: { fb: "max_bal_current", legacy: ["maxBalCurrent", "maxBalanceCurrent"] },
  balStartVolt: { fb: "bal_start_volt", legacy: ["balStartVolt"] },
  balDeltaVolt: {
    fb: "bal_delta_volt",
    legacy: ["balDeltaVolt"],
    toDash: (v) => v * 1000,
    toFb: (v) => v / 1000,
  },
  disableTempSensor: { fb: "disable_temp", legacy: ["disableTempSensor"] },
  chargeFloatMode: { fb: "float_mode", legacy: ["chargeFloatMode"] },
  timedStoredData: { fb: "timed_stored_data", legacy: ["timed_data", "timedStoredData"] },
  dsgOcp2: { fb: "discharge_ocp_2", legacy: ["ocp_2", "dsgOcp2"] },
  dsgOcp3: { fb: "discharge_ocp_3", legacy: ["dsgOcp3"] },
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
  chgOtp: { fb: "charge_otp" },
  chgUtp: { fb: "charge_utp" },
  dsgOtp: { fb: "discharge_otp" },
  dsgUtp: { fb: "discharge_undertemperature_protection" },
  chgOtpr: { fb: "charge_otpr" },
  chgUtpr: { fb: "charge_utpr" },
  dsgOtpr: { fb: "discharge_otpr" },
  cmosOtp: { fb: "cmos_otp" },
  cmosOtpr: { fb: "cmos_otpr" },
  cellRfv: { fb: "cell_rfv" },
  emergTimer: { fb: "emergency_duration" },
  rcvTime: { fb: "cell_rcv_time" },
  rfvTime: { fb: "cell_rfv_time" },
  currCalibration: { fb: "current_calibration" },
  canProtocol: { fb: "can_protocol", legacy: ["canProtocol"] },
  uart1Protocol: { fb: "uart1_protocol", legacy: ["uart1Protocol"] },
  uart2Protocol: { fb: "uart2_protocol", legacy: ["uart2Protocol"] },
  uart3Protocol: { fb: "uart3_protocol", legacy: ["uart3Protocol"] },
};

function logSwitchChange(dashKey, reason, value) {
  const tag = dashKey === "charge" ? "[ChargeSwitch]" : "[DischargeSwitch]";
  console.log(`${tag} ${reason}`, value);
}

function defaultSettings(pack) {
  return {
    myCustomName: "",
    charge: true,
    discharge: true,
    emergency: false,
    disLimiter: false,
    lcdAlwaysOn: false,
    cellCount: pack.cellCount ?? 16,
    capacityAh: pack.ratedCapacityAh,
    balancer: true,
    balDeltaVolt: 20,
    balStartVolt: 3.3,
    maxBalCurrent: 1.0,
    cellOvp: 2.7,
    cellRcv: 2.68,
    socFullVolt: 2.65,
    cellOvpr: 2.64,
    cellUvpr: 1.85,
    soc0Volt: 1.84,
    cellUvp: 1.8,
    pwrOffVolt: 1.7,
    ...pack.voltageDefaults,
    contChgCurr: 100,
    contDsgCurr: 100,
    dsgOcp2: true,
    dsgOcp3: true,
    chgOcpDelay: 300,
    chgOcprTime: 400,
    dsgOcpDelay: 300,
    dsgOcprTime: 60,
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
    deviceAddress: 1,
    timedStoredData: true,
    dataStoredPeriod: 3600,
    canProtocol: "JK BMS CAN Protocol (250K) V2.0",
    uart1Protocol: "JK BMS RS485 Modbus V1.0",
    uart2Protocol: "4G-GPS Remote module Common protocol V4.2",
    uart3Protocol: "4G-GPS Remote module Common protocol V4.2",
    intermittentAlarm: true,
    emergTimer: 10,
    lcdBuzzerTrigger: "OFF",
    dry1Trigger: "OFF",
    chargeFloatMode: false,
    cellRfv: 3.4,
    rcvTime: 30,
    rfvTime: 5,
    voltCalibration: 0,
    currCalibration: 0,
  };
}

function Pill({ tone = "brand", icon: Icon, children }) {
  const t = statusTone(tone);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold shadow-sm ${t.bg} ${t.fg}`}>
      {Icon && <Icon className="size-3.5" />}
      {children}
    </span>
  );
}

export default function BMSDashboard({ onSoftwareVersionChange }) {
  const { logout } = useAuth();
  const { hubs } = useHubData();
  const [now, setNow] = useState(new Date());
  const [showWeatherModal, setShowWeatherModal] = useState(false);
  const [activeBmsId, setActiveBmsId] = useState(() => {
    try {
      return localStorage.getItem(ACTIVE_BMS_STORAGE_KEY) || "bms-slot-0";
    } catch {
      return "bms-slot-0";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_BMS_STORAGE_KEY, activeBmsId);
    } catch {}
  }, [activeBmsId]);

  const [showLog, setShowLog] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showAlarms, setShowAlarms] = useState(false);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const { devices, loaded: hubLoaded } = useHubDevices();
  const slots = buildBmsSlots(devices);

  const weatherHubId = devices[0]?.hubId ?? null;
  const rawSavedLocation = weatherHubId ? hubs[weatherHubId]?.location ?? null : null;
  const savedLocation = useMemo(
    () => (rawSavedLocation ? { name: rawSavedLocation.name, lat: rawSavedLocation.lat, lng: rawSavedLocation.lng } : null),
    [rawSavedLocation?.name, rawSavedLocation?.lat, rawSavedLocation?.lng]
  );
  const weatherLoc = useWeatherLocation(weatherHubId, savedLocation);

  const [settingsByPack, setSettingsByPack] = useState(() =>
    Object.fromEntries(slots.map((b) => [b.id, defaultSettings(b)]))
  );
  const settings = settingsByPack[activeBmsId];
  const chargeSwitchGuardRef = useRef({});

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

  const packs = [bms0, bms1, bms2, bms3, bms4, bms5, bms6, bms7, bms8, bms9];
  const totalAggregatedCurrent = packs.reduce((acc, p) => acc + (p.current || 0), 0);
  const totalAggregatedPower = packs.reduce((acc, p) => acc + (p.power || 0), 0);
  const totalRemainingAh = packs.reduce((acc, p) => acc + (p.remainingAh || 0), 0);
  const totalCapacityAh = packs.reduce((acc, p) => {
    // เช็คว่ามีสล็อตนี้อยู่จริง และเปิดใช้งานอยู่ (ปรับเงื่อนไขตามโครงสร้างสล็อตของคุณ เช่น s.enabled หรือ s.id)
  
      return acc + (p.ratedCapacityAh  || 0);
    
    return acc;
  }, 0);
  const aggregatedSoc = clamp((totalRemainingAh / totalCapacityAh) * 100, 0, 100);

  // กรองเอาเฉพาะแพ็คที่ออนไลน์อยู่ (isLive)
  const livePacks = packs.filter(p => p.isLive && p.packVoltage > 0);

  // หา Pack Voltage โดยดึงค่าจากแพ็คแรกที่ออนไลน์อยู่ (เพราะต่อขนานกัน แรงดันจะเท่ากันหมด)
  // หรือถ้าต้องการความแม่นยำขึ้น สามารถหาค่าเฉลี่ยเฉพาะแพ็คที่ออนไลน์ได้ครับ
  const avgPackVoltage = livePacks.length > 0 
    ? livePacks[0].packVoltage 
    : 0;
  const solarGenPower = Math.abs(totalAggregatedPower > 0 ? totalAggregatedPower : 0); 
  const solarCurrent =  solarGenPower ;
  let loadConsumptionPower = 0;

  if (totalAggregatedPower < 0) {
    // แบตเตอรี่กำลังจ่ายไฟ (Discharging): โหลดจะได้พลังงานจากทั้งโซล่าเซลล์และแบตเตอรี่
    loadConsumptionPower = solarGenPower + Math.abs(totalAggregatedPower);
  } else {
    // แบตเตอรี่กำลังชาร์จ (Charging): โหลดจะได้พลังงานเฉพาะส่วนที่เหลือจากโซล่าเซลล์หลังหักชาร์จแบตแล้ว
    loadConsumptionPower = Math.max(0, solarGenPower - totalAggregatedPower);
  }

  // สมมติว่ามีพลังงานรวมที่เหลืออยู่ (Wh) หรือคำนวณจาก Ah คงเหลือ คูณด้วย แรงดันแพ็ค
  const totalRemainingWh = totalRemainingAh * avgPackVoltage;

  // คำนวณชั่วโมงที่ใช้งานได้ (ป้องกันการหารด้วย 0)
  const remainingHours = loadConsumptionPower > 0 
    ? totalRemainingWh / loadConsumptionPower 
    : 0;

  // แปลงเป็น ชั่วโมง และ นาที (เพื่อให้แสดงผลเข้าใจง่าย เช่น "2 ชม. 30 นาที")
  const remHoursInt = Math.floor(remainingHours);
  const remMinutesInt = Math.round((remainingHours - remHoursInt) * 60);

  const active = packs.find((p) => p.id === activeBmsId) ?? packs[0];
  const activeConfig = slots.find((b) => b.id === activeBmsId) ?? slots[0];

  useEffect(() => {
    onSoftwareVersionChange?.({
      software: active.info?.software_version ?? null,
      hardware: active.info?.hardware_version ?? null,
      deviceLabel: active.name,
      hubId: activeConfig.hubId ?? null,
      bmsKey: activeConfig.bmsKey ?? null,
      firmware: active.firmware ?? null,
    });
  }, [
    active.info?.software_version,
    active.info?.hardware_version,
    active.name,
    active.firmware,
    activeConfig.hubId,
    activeConfig.bmsKey,
    onSoftwareVersionChange,
  ]);

  const prevVersionsRef = useRef({});
  const [firmwareUpdate, setFirmwareUpdate] = useState(null);
  useEffect(() => {
    for (const pack of packs) {
      const version = pack.info?.software_version;
      if (!version) continue;
      const prev = prevVersionsRef.current[pack.id];
      if (prev !== undefined && prev !== version) {
        setFirmwareUpdate({ deviceLabel: pack.name, version });
        setTimeout(() => setFirmwareUpdate((cur) => (cur?.version === version ? null : cur)), 6000);
      }
      prevVersionsRef.current[pack.id] = version;
    }
  }, [bms0.info, bms1.info, bms2.info, bms3.info, bms4.info, bms5.info, bms6.info, bms7.info, bms8.info, bms9.info]);

  const dailyEnergy = useDailyEnergy(activeConfig.hubId, activeConfig.bmsKey);
  const activeEnergy = { chargedAh: dailyEnergy.chargedAh, dischargedAh: dailyEnergy.dischargedAh };

  // Same unrolled-per-slot pattern as bms0..bms9 above (hooks can't be
  // called in a loop) - fleet-wide today's charged Ah/Wh across every real
  // device, for the Solar Hybrid Energy Flow panel's "Net Battery Power"
  // readout, per explicit request ("คำนวนการชาร์จลงแบตทั้งหมด"). Empty
  // slots (hubId null) resolve to EMPTY immediately inside the hook itself,
  // so this doesn't add real fetch load beyond however many devices exist.
  const dailyEnergy0 = useDailyEnergy(slots[0].hubId, slots[0].bmsKey);
  const dailyEnergy1 = useDailyEnergy(slots[1].hubId, slots[1].bmsKey);
  const dailyEnergy2 = useDailyEnergy(slots[2].hubId, slots[2].bmsKey);
  const dailyEnergy3 = useDailyEnergy(slots[3].hubId, slots[3].bmsKey);
  const dailyEnergy4 = useDailyEnergy(slots[4].hubId, slots[4].bmsKey);
  const dailyEnergy5 = useDailyEnergy(slots[5].hubId, slots[5].bmsKey);
  const dailyEnergy6 = useDailyEnergy(slots[6].hubId, slots[6].bmsKey);
  const dailyEnergy7 = useDailyEnergy(slots[7].hubId, slots[7].bmsKey);
  const dailyEnergy8 = useDailyEnergy(slots[8].hubId, slots[8].bmsKey);
  const dailyEnergy9 = useDailyEnergy(slots[9].hubId, slots[9].bmsKey);
  const fleetDailyEnergies = [
    dailyEnergy0, dailyEnergy1, dailyEnergy2, dailyEnergy3, dailyEnergy4,
    dailyEnergy5, dailyEnergy6, dailyEnergy7, dailyEnergy8, dailyEnergy9,
  ];
  const fleetChargedAhToday = fleetDailyEnergies.reduce((sum, e) => sum + (e.chargedAh || 0), 0);
  const fleetChargedWhToday = fleetDailyEnergies.reduce((sum, e) => sum + (e.chargedWh || 0), 0);
  const fleetDischargedAhToday = fleetDailyEnergies.reduce((sum, e) => sum + (e.dischargedAh || 0), 0);
  const fleetDischargedWhToday = fleetDailyEnergies.reduce((sum, e) => sum + (e.dischargedWh || 0), 0);
  const activeAlarms = computeAlarms(active, settings);
  const activeDeviceMac = active.info?.jk_mac_address || activeConfig.deviceKey;
  const activeDeviceLabel = settings.myCustomName || activeDeviceMac;

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
          const value = m.toDash ? m.toDash(raw) : raw;

          if (dashKey === "charge" || dashKey === "discharge") {
            if (!chargeSwitchGuardRef.current[pack.id]) chargeSwitchGuardRef.current[pack.id] = {};
            if (!chargeSwitchGuardRef.current[pack.id][dashKey]) {
              chargeSwitchGuardRef.current[pack.id][dashKey] = { pending: undefined, seeded: false };
            }
            const guard = chargeSwitchGuardRef.current[pack.id][dashKey];
            if (guard.pending !== undefined) {
              if (value === guard.pending) {
                guard.pending = undefined;
              } else {
                logSwitchChange(dashKey, "Ignored invalid overwrite", value);
                continue;
              }
            } else if (!guard.seeded) {
              guard.seeded = true;
            }
          }
          patch[dashKey] = value;
        }
        next[pack.id] = { ...next[pack.id], ...patch };
      }
      return next;
    });
  }, [bms0.remoteSettings, bms1.remoteSettings, bms2.remoteSettings, bms3.remoteSettings, bms4.remoteSettings, bms5.remoteSettings, bms6.remoteSettings, bms7.remoteSettings, bms8.remoteSettings, bms9.remoteSettings]);

  const saveSetting = (key, value) => {
    if (active.isLive && active.adminDisabled) return;
    if (key === "charge" || key === "discharge") {
      if (!chargeSwitchGuardRef.current[activeBmsId]) chargeSwitchGuardRef.current[activeBmsId] = {};
      if (!chargeSwitchGuardRef.current[activeBmsId][key]) {
        chargeSwitchGuardRef.current[activeBmsId][key] = { pending: undefined, seeded: true };
      }
      chargeSwitchGuardRef.current[activeBmsId][key].pending = value;
      chargeSwitchGuardRef.current[activeBmsId][key].seeded = true;
      logSwitchChange(key, "Changed by USER", value);
    }
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
          setSaveError(err.message || "Failed to save setting");
        });
    }
  };

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const effectiveCapacityAh = settings.capacityAh;
  const displaySoc = clamp((active.remainingAh / effectiveCapacityAh) * 100, 0, 100);
  const recommendedChargeCurrentA = effectiveCapacityAh * 0.25;
  const recommendedDischargeCurrentA = effectiveCapacityAh * 0.5;
  const balDeltaVolt = settings.balDeltaVolt;
  const vd = voltDiffToneWithThreshold(active.voltDiffMv, balDeltaVolt);

  const chargeMOS = active.isLive ? active.chargeMOS : settings.charge;
  const dischargeMOS = active.isLive ? active.dischargeMOS : settings.discharge;
  const chargeStatus = active.isLive ? active.chargeStatus : null;
  const balancerOn = active.isLive ? active.balancerOn : settings.balancer;
  const otpLimit = active.status === "Charging" ? settings.chgOtp : settings.dsgOtp;

  const healthScore = computeBatteryHealthScore({
    soc: displaySoc,
    voltDiffMv: active.voltDiffMv,
    maxTemp: active.maxTemp,
    alarms: activeAlarms,
    current: active.current,
    contChgCurr: settings.contChgCurr,
    contDsgCurr: settings.contDsgCurr,
  });

  const cellFillPct = useCallback(
    (v) => {
      const span = settings.cellOvp - settings.cellUvp || 0.02;
      return clamp(((v - settings.cellUvp) / span) * 100, 4, 100);
    },
    [settings.cellOvp, settings.cellUvp]
  );

  const STALE_AFTER_MS = 15000;
  const isOnline = active.isLive
    ? !!active.firebaseConnected && !!active.lastUpdateAt && (now.getTime() - active.lastUpdateAt < STALE_AFTER_MS)
    : false;

  const [confirmedOffline, setConfirmedOffline] = useState(false);
  useEffect(() => {
    if (isOnline) {
      setConfirmedOffline(false);
      return;
    }
    const timer = setTimeout(() => setConfirmedOffline(true), 5000);
    return () => clearTimeout(timer);
  }, [isOnline]);

  const [offlineDismissed, setOfflineDismissed] = useState(false);
  const showOfflineModal = active.isLive && confirmedOffline && !offlineDismissed;
  const [isOpen, setIsOpen] = React.useState(false);
  
  return (
      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-5 sm:py-6 md:px-7 font-sans">
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
            <FirmwareUpdateToast update={firmwareUpdate} />
            <TopBar
              tabs={slots
                .filter((s) => s.live)
                .map((s) => {
                  const pack = packs.find((p) => p.id === s.id);
                  return { id: s.id, name: s.name, mac: pack?.info?.jk_mac_address || s.deviceKey };
                })}
              activeBmsId={activeBmsId}
              onSelectBms={setActiveBmsId}
              onOpenWeather={() => {
                setShowWeatherModal(true);
                weatherLoc.openWeather();
              }}
              onOpenConfig={() => setShowConfig(true)}
              configDisabled={active.isLive && active.adminDisabled}
              onLogout={() => setIsLogoutModalOpen(true)}
            />
            <AnnouncementBanner />
            <LogoutModal isOpen={isLogoutModalOpen} onClose={() => setIsLogoutModalOpen(false)} onConfirm={logout} />

            {active.isLive && active.adminDisabled ? (
              <div className="mt-5 flex flex-col items-center justify-center gap-2 rounded-3xl bg-[var(--card)] p-16 text-center shadow-sm ring-1 ring-[var(--border)]">
                <p className="text-lg font-bold text-[var(--foreground)]">ถูกปิดโดย Admin</p>
                <p className="max-w-sm text-sm text-[var(--muted-foreground)]">หากติดปัญหา กรุณาติดต่อ ID Line: Poote3105</p>
              </div>
            ) : (
              <>
            {/* 🌟 Background Flow Diagram Container (Pro Control Room Edition พร้อมปุ่มพับซ่อน) */}
              <div className="flow-diagram-font my-6 relative w-full mx-auto overflow-hidden bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 rounded-3xl border border-slate-800/80 shadow-2xl p-5 md:p-6 ring-1 ring-slate-800/50">
                
                {/* Ambient Glow Background Accents */}
                <div className="absolute -top-24 -left-24 w-72 h-72 bg-sky-500/10 rounded-full blur-3xl pointer-events-none"></div>
                <div className="absolute -bottom-24 -right-24 w-72 h-72 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"></div>

                {/* Header Section (คลิกเพื่อแสดง/ซ่อนได้) */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4 relative z-10">
                  <button 
                    onClick={() => setIsOpen(!isOpen)}
                    className="group inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900/90 border border-slate-700/60 text-amber-400 text-xs font-semibold shadow-inner hover:border-amber-500/50 transition-all cursor-pointer"
                  >
                    <Zap className="size-3.5 text-amber-400 animate-pulse" /> 
                    <span>Solar Hybrid Energy Flow</span>
                    <span className={`text-[10px] text-slate-400 ml-1 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}>▼</span>
                  </button>

                  <div className="flex items-center gap-2.5 bg-slate-900/80 border border-slate-800/90 px-3.5 py-1.5 rounded-xl shadow-sm">
                    <span className="size-2.5 rounded-full bg-emerald-400 animate-ping"></span>
                    <span className="text-xs text-slate-300 font-medium">System Bus: <strong className="text-white font-mono">{avgPackVoltage.toFixed(2)}V</strong></span>
                  </div>
                </div>

                {/* Content Wrapper (ซ่อน/แสดงตามสถานะ isOpen) */}
                <div className={`transition-all duration-500 ease-in-out overflow-hidden ${isOpen ? 'max-h-[1000px] opacity-100' : 'max-h-0 opacity-0'}`}>
                  
                  {/* Background Schematic Image Wrapper */}
                  <div className="relative w-full aspect-[16/9] sm:aspect-[2/1] max-h-[500px] rounded-2xl overflow-hidden bg-slate-950 border border-slate-800/60 shadow-inner">
                    
                    {/* Background Schematic Image with High-Tech Filter */}
                    <div 
                      className="absolute inset-0 bg-cover bg-center opacity-40 mix-blend-luminosity filter contrast-125 scale-105 transition-transform duration-700"
                      style={{ backgroundImage: `url('/images/flow-main.jpg')` }}
                    ></div>
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent"></div>

                    {/* ประเมินทิศทางและการไหลจากค่ากำลังไฟฟ้าและกระแสจริง */}
                    {(() => {
                      const now = new Date();
                      const currentHour = now.getHours();
                      const currentMinute = now.getMinutes();
                      const currentTimeNumber = currentHour * 60 + currentMinute; 

                      const isDaytime = currentTimeNumber >= 420 && currentTimeNumber <= 1079;
                      
                      const rawPower = totalAggregatedPower;
                      const rawCurrent = totalAggregatedCurrent;

                      // เช็คสถานะจากการไหลของพลังงานจริงโดยตรง (ไม่ต้องพึ่งตัวแปรภายนอกที่อาจไม่ได้ประกาศ)
                      const isChargingActive = rawPower > 0 || rawCurrent > 0;
                      const isDischargingActive = rawPower < 0 || rawCurrent < 0;

                      const isSolarFlowing = isDaytime && isChargingActive;
                      const isLoadFlowing = true; // โหลดทำงานและวิ่งออกจากอินเวอร์เตอร์ตลอด

                      // สีและแอนิเมชันของเส้นแบตเตอรี่ <-> อินเวอร์เตอร์
                      let batteryAnimationValue = "none";
                      let batteryStrokeColor = "#2dd4bf";

                      if (isChargingActive) {
                        // กำลังชาร์จเข้า (วิ่งย้อนเข้าแบต)
                        batteryAnimationValue = "dash_reverse 2.2s linear infinite";
                        batteryStrokeColor = "#38bdf8";
                      } else if (isDischargingActive || !isChargingActive) {
                        // กำลังจ่ายออก (วิ่งออกจากแบตมาอินเวอร์เตอร์)
                        batteryAnimationValue = "dash_forward 2.2s linear infinite";
                        batteryStrokeColor = "#2dd4bf";
                      }

                      // Three distinct ports on the Inverter box (top, right,
                      // bottom) instead of all three routes converging on the
                      // same single point - that was making the Solar-in and
                      // Loads-out lines visually overlap right at the
                      // Inverter. 45-degree chamfered corners (not rounded
                      // curves) for a crisper, more deliberate "circuit
                      // trace" look, per explicit request for something more
                      // high-tech - the round traveling dots already carry
                      // the "smooth" part.
                      const SOLAR_PATH = "M 480 130 L 480 185 L 460 205 L 250 205";
                      const BATTERY_PATH = "M 310 520 L 250 520 L 220 490 L 220 285";
                      const LOADS_PATH = "M 250 260 L 420 260 L 450 290 L 650 300";

                      return (
                        <svg className="absolute inset-0 w-full h-full pointer-events-none z-10 filter drop-shadow-[0_0_8px_rgba(56,189,248,0.4)]" viewBox="0 0 1000 600" preserveAspectRatio="none">
                          {/* Faint solid guide line under the dots so each
                              route still reads clearly in the gaps between
                              dots, not just wherever a dot happens to be. */}
                          <path d={SOLAR_PATH} fill="none" stroke="#fbbf24" strokeWidth="1.5" strokeLinejoin="round" opacity={isSolarFlowing ? 0.25 : 0.08} />
                          <path d={BATTERY_PATH} fill="none" stroke={batteryStrokeColor} strokeWidth="1.5" strokeLinejoin="round" opacity={0.25} />
                          <path d={LOADS_PATH} fill="none" stroke="#fb923c" strokeWidth="1.5" strokeLinejoin="round" opacity={0.25} />

                          {/* 1. Solar PV Array -> Hybrid Inverter - round
                              marching dots (near-zero dash + round linecap)
                              instead of dash segments, per explicit request. */}
                          <path
                            d={SOLAR_PATH}
                            fill="none"
                            stroke="#fbbf24"
                            strokeWidth="7"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeDasharray="0.1 20"
                            style={{ animation: isSolarFlowing ? "dash_forward 2.2s linear infinite" : "none", opacity: isSolarFlowing ? 0.95 : 0.15 }}
                          />

                          {/* 2. Battery Bank <-> Inverter */}
                          <path
                            d={BATTERY_PATH}
                            fill="none"
                            stroke={batteryStrokeColor}
                            strokeWidth="7"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeDasharray="0.1 20"
                            style={{ animation: batteryAnimationValue, opacity: 0.95 }}
                          />

                          {/* 3. Inverter -> Home Load - same round-dot
                              treatment as path 1. */}
                          <path
                            d={LOADS_PATH}
                            fill="none"
                            stroke="#fb923c"
                            strokeWidth="7"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeDasharray="0.1 20"
                            style={{ animation: isLoadFlowing ? "dash_forward 2.2s linear infinite" : "none", opacity: 0.95 }}
                          />
                        </svg>
                      );
                    })()}

                   {/* Absolute Modern Glassmorphism Cards Overlays (Responsive Mobile Optimized) */}
                    {(() => {
                      const now = new Date();
                      const currentHour = now.getHours();
                      const currentMinute = now.getMinutes();
                      const currentTimeNumber = currentHour * 60 + currentMinute; 
                      const isDaytime = currentTimeNumber >= 420 && currentTimeNumber <= 1079;
                      const rawPower = Math.abs(totalAggregatedPower > 0 ? totalAggregatedPower : 0);
                      
                      let solarCurrent = isDaytime ? rawPower : 0.0;
                     const totalPower = totalAggregatedPower; // กำลังจากแบตเตอรี่ (ถ้าชาร์จเป็นบวก, ถ้าจ่ายออกเป็นลบ)
// สมมติว่ามีตัวแปร solarPower หรือคำนวณจากช่วงเวลา
const currentSolarPower = isDaytime ? Math.abs(totalPower > 0 ? totalPower : 0) : 0;

// คำนวณโหลดที่บ้านกำลังดึงไปใช้งาน (W)
const loadConsumptionPower = totalPower < 0 ? Math.abs(totalPower) : 0;

                      return (
                        <>
                          {/* 1. PV Array Box */}
                          <div className="absolute top-[15%] left-[48%] -translate-x-1/2 bg-slate-900/90 backdrop-blur-xl border border-amber-500/30 px-2.5 py-1 sm:px-3.5 sm:py-1.5 rounded-lg sm:rounded-xl text-center z-20 shadow-xl shadow-amber-950/20">
                            <div className="text-[8px] sm:text-[9px] uppercase tracking-widest font-bold text-amber-400">Solar PV</div>
                            <div className="text-xs sm:text-sm font-extrabold text-white font-mono">{solarCurrent.toFixed(1)} W</div>
                          </div>

                          {/* 2. Hybrid Inverter Box */}
                          <div className="absolute top-[41%] left-[20%] -translate-x-1/2 -translate-y-1/2 bg-slate-900/90 backdrop-blur-xl border border-sky-500/30 px-3 py-1 sm:px-5 sm:py-1.5 rounded-lg sm:rounded-xl text-center z-20 shadow-xl shadow-sky-950/20 min-w-[90px] sm:min-w-[110px]">
                            <div className="text-[8px] sm:text-[9px] uppercase tracking-widest font-bold text-sky-400">Inverter</div>
                            <div className="text-xs sm:text-sm font-extrabold text-white font-mono">{totalAggregatedPower.toFixed(0)} W</div>
                          </div>

                          {/* 3. Critical Loads Panel */}
                          <div className="absolute top-[50%] right-[32%] -translate-y-1/2 bg-slate-900/90 backdrop-blur-xl border border-indigo-500/30 px-2.5 py-1 sm:px-3.5 sm:py-1.5 rounded-lg sm:rounded-xl text-center z-20 shadow-xl shadow-indigo-950/20">
                            <div className="text-[8px] sm:text-[9px] uppercase tracking-widest font-bold text-indigo-400">Loads</div>
                            <div className="text-xs sm:text-sm font-extrabold text-white font-mono">{loadConsumptionPower.toFixed(1)} W</div>
                          </div>

                          {/* 4. Battery Bank Box */}
                          <div className="absolute bottom-[8%] left-[33%] -translate-x-1/2 bg-slate-900/95 backdrop-blur-xl border border-teal-500/40 px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl sm:rounded-2xl text-center z-20 shadow-xl shadow-teal-950/30 min-w-[140px] sm:min-w-[180px] ring-1 ring-teal-500/20">
                            <div className="flex items-center justify-center gap-1 mb-0.5">
                              <span className="size-1.5 sm:size-2 rounded-full bg-teal-400 animate-pulse"></span>
                              <span className="text-[8px] sm:text-[10px] uppercase tracking-wider font-bold text-teal-400">Battery Bank</span>
                            </div>
                            
                            <div className="text-xs sm:text-base font-extrabold text-white font-mono tracking-tight my-0.5">
                              {aggregatedSoc.toFixed(0)}%
                              <span className="text-[9px] sm:text-xs text-slate-400 font-normal ml-0.5 sm:ml-1">
                                ({totalRemainingAh.toFixed(1)}/{totalCapacityAh.toFixed(0)}Ah)  
                                 <div className="inline-block px-1.5 py-0.5 rounded bg-teal-500/10 border border-teal-500/20 text-[10px] sm:text-[11px] font-bold text-teal-300 font-mono">
                              {totalAggregatedCurrent > 0 ? `+${totalAggregatedCurrent.toFixed(1)}` : totalAggregatedCurrent.toFixed(1)} A
                            </div>
                              </span>
                            </div>

                           
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  {/* Sub-Metrics Cards Footer */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
                    <div className="bg-slate-900/70 border border-slate-800/80 p-3 rounded-2xl flex items-center justify-between shadow-sm backdrop-blur-sm">
                      <div>
                        <div className="text-[11px] font-medium text-slate-400">Estimated Backup</div>
                        <div className="text-sm font-bold text-amber-400 font-mono mt-0.5">
                          {remainingHours > 0 ? `${remHoursInt} ชม. ${remMinutesInt} น.` : `--`}
                        </div>
                      </div>
                      <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 text-base">⏳</div>
                    </div>
                    
                    <div className="bg-slate-900/70 border border-slate-800/80 p-3 rounded-2xl flex items-center justify-between shadow-sm backdrop-blur-sm">
                      <div>
                        <div className="text-[11px] font-medium text-slate-400">Net Battery Power</div>
                        <div className="text-sm font-bold text-teal-400 font-mono mt-0.5">{totalAggregatedPower.toFixed(0)} W</div>
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                          {fleetChargedAhToday.toFixed(1)} Ah · {(fleetChargedWhToday / 1000).toFixed(2)} kWh
                        </div>
                      </div>
                      <div className="p-2 rounded-xl bg-teal-500/10 text-teal-400 border border-teal-500/20 text-base">🔋</div>
                    </div>
                    
                    <div className="bg-slate-900/70 border border-slate-800/80 p-3 rounded-2xl flex items-center justify-between shadow-sm backdrop-blur-sm">
                      <div>
                        <div className="text-[11px] font-medium text-slate-400">Net Load Power</div>
                        {/* No day/night gate anymore - computed continuously,
                            per explicit request. Note this can only ever be
                            the load NOT covered by solar (i.e. what the
                            battery had to discharge to make up) - there is no
                            real solar production sensor anywhere in this app
                            (confirmed - solarGenPower elsewhere is inferred
                            from charge power, not measured), so any load
                            currently being served directly by solar is
                            invisible to this reading by hardware limitation,
                            not a bug. Same reasoning behind the Ah/kWh line
                            below already using discharged energy, not a
                            broader "total load" figure. */}
                        <div className="text-sm font-bold text-indigo-400 font-mono mt-0.5">
                          {(totalAggregatedPower < 0 ? Math.abs(totalAggregatedPower) : 0).toFixed(0)} W
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                          {fleetDischargedAhToday.toFixed(1)} Ah · {(fleetDischargedWhToday / 1000).toFixed(2)} kWh
                        </div>
                      </div>
                      <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-base">💡</div>
                    </div>
                  </div>

                </div>

                {/* Keyframes - dashoffset travels exactly 2x the 12+12
                    dash pattern (24) per cycle, not 50, so the "marching"
                    loop is seamless instead of visibly hitching every
                    repeat - dots use a 0.1+20=20.1 pattern (2x = 40.2),
                    the earlier dashed version used 12+12=24 (2x = 48). */}
                <style>{`
                  /* Scoped to this panel only (via .flow-diagram-font) so it
                     never touches font-mono/uppercase-label styling used
                     anywhere else in the app - a proper monospace (JetBrains
                     Mono) for the numeric readouts and a condensed
                     tech/HUD-style face (Rajdhani) for the uppercase labels,
                     instead of falling back to whatever generic system
                     monospace/sans-serif the browser has, per explicit
                     "font isn't pretty" feedback. */
                  .flow-diagram-font .font-mono {
                    font-family: 'JetBrains Mono', ui-monospace, monospace;
                  }
                  .flow-diagram-font .uppercase {
                    font-family: 'Rajdhani', sans-serif;
                    letter-spacing: 0.08em;
                  }
                  @keyframes dash_forward {
                    from { stroke-dashoffset: 40.2; }
                    to { stroke-dashoffset: 0; }
                  }
                  @keyframes dash_reverse {
                    from { stroke-dashoffset: 0; }
                    to { stroke-dashoffset: 40.2; }
                  }
                `}</style>
              </div>
                <SystemHero
                  deviceLabel={activeDeviceLabel}
                  deviceMac={activeDeviceMac}
                  hubAccount={active.isLive ? activeConfig.hubId : undefined}
                  isOnline={isOnline}
                  onRefresh={() => window.location.reload()}
                  cellCount={settings.cellCount}
                  batteryType={active.info?.battery_type}
                  maxBalancerCurrentA={settings.maxBalCurrent}
                  power={active.power}
                  status={active.status}
                  info={active.info}
                  current={active.current}
                  packVoltage={active.packVoltage}
                  ratedCapacityAh={effectiveCapacityAh}
                  remainingAh={active.remainingAh}
                  socPercent={displaySoc}
                  cellAvgVoltage={active.cells.length ? active.cells.reduce((a, b) => a + b, 0) / active.cells.length : 0}
                  soh={active.soh}
                  healthScore={healthScore}
                  chargedAh={activeEnergy.chargedAh}
                  dischargedAh={activeEnergy.dischargedAh}
                  chargeMOS={chargeMOS}
                  dischargeMOS={dischargeMOS}
                  chargeStatus={chargeStatus}
                  balancerOn={balancerOn}
                  balancerCurrentA={active.balancerCurrent}
                  voltDiffMv={active.voltDiffMv}
                  voltDiffTone={vd.tone}
                  now={now}
                  alarms={activeAlarms}
                  onOpenAlarms={() => setShowAlarms(true)}
                />

                <div className="mt-5 space-y-5">
                  <PowerFlowChart
                    current={active.current}
                    socPercent={displaySoc}
                    remainingRuntime={active.remainingRuntime}
                    timeToFullCharge={active.timeToFullCharge}
                    recommendedChargeCurrentA={recommendedChargeCurrentA}
                    recommendedDischargeCurrentA={recommendedDischargeCurrentA}
                    configuredChargeCurrentA={settings.contChgCurr}
                    configuredDischargeCurrentA={settings.contDsgCurr}
                    history={active.powerHistory}
                    channels={active.tempChannels}
                    temps={active.temps}
                    maxTemp={active.maxTemp}
                    otpLimit={otpLimit}
                    cycleAh={active.cycleAh}
                    cycleCount={active.cycleCount}
                  />
                </div>

                <div className="mt-5 space-y-5">
                  <section className="rounded-3xl bg-[var(--card)] p-5 shadow-sm ring-1 ring-[var(--border)] md:p-6">
                    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="text-base font-bold text-[var(--foreground)]">
                          Cell Voltage Monitoring · {settings.cellCount}S
                        </h2>
                        {active.wireResistances?.some((r) => typeof r === "number" && r > 0) && (
                          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                            <Cable className="size-3.5" />
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

                    <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
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
                            className={`relative rounded-xl p-2.5 text-center ring-1 transition-all duration-200 hover:-translate-y-1 hover:shadow-lg ${
                              t ? `${t.bg} ring-[var(--border)]` : "bg-[var(--card)] ring-[var(--border)]"
                            }`}
                          >
                            {badge && (
                              <span
                                className={`absolute -right-1.5 -top-1.5 rounded-full px-1.5 py-0.5 text-[8px] font-bold text-white shadow-md ${
                                  isBreach ? "animate-pulse" : ""
                                }`}
                                style={{ backgroundColor: isBreach ? "var(--critical)" : isMax ? "var(--warning)" : "var(--info)" }}
                              >
                                {badge}
                              </span>
                            )}

                            <div className={`text-[10px] font-bold ${t ? t.fg : "text-[var(--muted-foreground)]"}`}>
                              C{i + 1}
                            </div>

                            <div className="text-sm font-extrabold text-[var(--foreground)] tabular-nums my-1">{v.toFixed(3)}</div>

                            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
                              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: fillColor }} />
                            </div>

                            {hasWireValue && (
                              <div className="mt-1.5 flex items-center justify-center gap-0.5 text-[9px] text-[var(--muted-foreground)]">
                                <Cable className="size-2.5" />
                                {Math.round(ohm * 1000)}mΩ
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  <ChargeDischargeChart history={active.powerHistory} hubId={activeConfig.hubId} bmsKey={activeConfig.bmsKey} />
                  <CommunicationPanel remoteSettings={active.remoteSettings} />
                </div>

                <p className="mt-6 text-center text-xs text-[var(--muted-foreground)]">
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
                onOpenLog={() => {
                  setShowConfig(false);
                  setShowLog(true);
                }}
                onChangeLocation={() => {
                  setShowConfig(false);
                  weatherLoc.setShowSetupModal(true);
                }}
              />
            </Modal>

            <InstallationLocationModal
              open={weatherLoc.showSetupModal}
              initialLocation={savedLocation}
              onSave={weatherLoc.saveLocation}
              onClose={() => weatherLoc.setShowSetupModal(false)}
              saving={weatherLoc.saving}
            />
            <WeatherModal
              open={showWeatherModal}
              onClose={() => setShowWeatherModal(false)}
              weather={weatherLoc.weather}
              loading={weatherLoc.loading}
              error={weatherLoc.error}
              location={savedLocation}
              onRetry={() => weatherLoc.loadWeather()}
              onChangeLocation={() => {
                setShowWeatherModal(false);
                weatherLoc.setShowSetupModal(true);
              }}
            />

            <Modal open={showOfflineModal} onClose={() => setOfflineDismissed(true)} title="อุปกรณ์หลุดการเชื่อมต่อ">
              <div className="flex flex-col items-center gap-2 py-3 text-center">
                <div className="relative mb-2 flex size-16 items-center justify-center">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--critical)]/30" />
                  <span className="relative flex size-16 items-center justify-center rounded-full bg-[var(--critical-10)] ring-1 ring-[var(--critical)]/30">
                    <WifiOff className="size-7 text-[var(--critical)]" />
                  </span>
                </div>

                <p className="text-base font-bold text-[var(--foreground)]">{active.name} ไม่ตอบสนอง</p>
                <p className="max-w-xs text-xs text-[var(--muted-foreground)]">
                  สัญญาณจาก ESP32/BLE หายไป อาจจะไฟดับ, wifi หลุด, หรือแบตอยู่นอกระยะ - ข้อมูลที่เห็นตอนนี้เป็นค่าล่าสุดก่อนหลุด ไม่ใช่ real-time แล้วนะ
                </p>

                {active.lastUpdateAt && (
                  <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[var(--muted)] px-3.5 py-1 text-xs font-medium text-[var(--muted-foreground)]">
                    <Clock className="size-3.5" />
                    อัปเดตล่าสุด {new Date(active.lastUpdateAt).toLocaleTimeString()}
                  </span>
                )}

                <div className="mt-5 flex w-full items-center gap-3">
                  <button
                    type="button"
                    onClick={() => window.location.reload()}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-[var(--brand)] py-3 text-xs font-semibold text-white shadow-md transition-transform hover:opacity-90 active:scale-95"
                  >
                    <RefreshCw className="size-4" />
                    รีเฟรชเลย
                  </button>
                  <button
                    type="button"
                    onClick={() => setOfflineDismissed(true)}
                    className="inline-flex items-center justify-center rounded-2xl px-4 py-3 text-xs font-semibold text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--muted)]"
                  >
                    รอเดี๋ยว
                  </button>
                </div>

                <p className="mt-3 flex items-center gap-1 text-[11px] text-[var(--muted-foreground)]">
                  <MessageCircleQuestion className="size-3.5" />
                  ยังไม่กลับมา? ทัก Line: Poote3105
                </p>
              </div>
            </Modal>
          </>
        )}
      </div>
    );

  
}

