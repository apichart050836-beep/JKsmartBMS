import React, { useState } from "react";
import { SlidersHorizontal, ShieldAlert, ArrowLeftRight, Cpu } from "lucide-react";
import { Toggle, ToggleRow, InputOkRow, SelectRow, AccordionItem } from "./settings/primitives.jsx";
import { TRIGGER_LIST, CAN_PROTOCOL_LIST, UART_PROTOCOL_LIST } from "./settings/dataLists.js";

/**
 * BMS configuration - rendered inside Modal (solid white popup, matching
 * the rest of the dashboard) opened from the [Configuration] button in
 * TopBar.
 *
 * Single flat `settings` object + a single `onSaveSetting(key, value)`
 * callback: every row (toggle, input+OK, dropdown+OK) writes through this
 * one path, which BMSDashboard.jsx uses to update local state and - for the
 * live pack - push the value to Firebase RTDB. Toggles apply immediately
 * (there's no "draft" state for a switch); inputs and dropdowns hold a local
 * draft until OK is pressed, so nothing fires on every keystroke/selection.
 *
 * Categories, in the requested order:
 *   1. Control & Core   2. Protection   3. Active Balancer   4. Advanced & Alarm
 */

const CATEGORIES = [
  { id: "core", label: "Control & Core", icon: SlidersHorizontal },
  { id: "protection", label: "Protection", icon: ShieldAlert },
  { id: "balancer", label: "Active Balancer", icon: ArrowLeftRight },
  { id: "advanced", label: "Advanced & Alarm", icon: Cpu },
];

function CategoryTabs({ activeId, onSelect }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl bg-[var(--muted)] p-1">
      {CATEGORIES.map((c) => {
        const isActive = c.id === activeId;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c.id)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              isActive
                ? "bg-[var(--card)] text-emerald-700 shadow-sm"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            }`}
          >
            <c.icon className="size-3.5" />
            {c.label}
          </button>
        );
      })}
    </div>
  );
}

function ColumnLabel({ children }) {
  return <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{children}</p>;
}

export function SettingsPanel({
  settings,
  onSaveSetting,
  liveBatteryVoltage,
  disabled = false,
  customName,
  batteryType,
  saveError,
  onDismissSaveError,
}) {
  const [activeCategory, setActiveCategory] = useState(CATEGORIES[0].id);

  const toggle = (key) => onSaveSetting(key, !settings[key]);
  const save = (key) => (value) => onSaveSetting(key, value);

  return (
    <div className="text-[var(--foreground)]">
      {disabled && (
        <div className="mb-4 rounded-xl border border-[var(--critical)]/30 bg-[var(--critical-10)] px-4 py-3 text-sm font-semibold text-[var(--critical)]">
          ถูกปิดโดย Admin - ไม่สามารถแก้ไขการตั้งค่าได้จนกว่าจะเปิดใช้งานอีกครั้งใน Admin Monitor
        </div>
      )}
      {saveError && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-[var(--critical)]/30 bg-[var(--critical-10)] px-4 py-3 text-sm text-[var(--critical)]">
          <div>
            <p className="font-semibold">บันทึกไม่สำเร็จ</p>
            <p className="mt-0.5 text-xs">{saveError}</p>
          </div>
          <button type="button" onClick={onDismissSaveError} className="shrink-0 text-xs font-semibold underline">
            ปิด
          </button>
        </div>
      )}
      {customName && (
        <p className="mb-3 text-xs text-[var(--muted-foreground)]">
          Device name: <span className="font-semibold text-[var(--foreground)]">{customName}</span>
        </p>
      )}
      <div className={disabled ? "pointer-events-none opacity-50" : undefined}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[var(--muted-foreground)]">Editing this pack's parameters - changes apply immediately.</p>
        <CategoryTabs activeId={activeCategory} onSelect={setActiveCategory} />
      </div>

      {activeCategory === "core" && (
        <div className="grid gap-x-10 md:grid-cols-2">
          <div>
            <ColumnLabel>Switches</ColumnLabel>
            <div className="divide-y divide-[var(--border)]">
              <ToggleRow label="Charge" description="Enable charge MOSFET" checked={settings.charge} onChange={() => toggle("charge")} />
              <ToggleRow
                label="Discharge"
                description="Enable discharge MOSFET"
                checked={settings.discharge}
                onChange={() => toggle("discharge")}
              />
              <ToggleRow
                label="Emergency"
                description="Force all MOSFETs off"
                checked={settings.emergency}
                onChange={() => toggle("emergency")}
              />
              <ToggleRow
                label="Dis-Limiter"
                description="Discharge current limiter"
                checked={settings.disLimiter}
                onChange={() => toggle("disLimiter")}
              />
              <ToggleRow
                label="LCD Always On"
                description="Keep onboard display lit"
                checked={settings.lcdAlwaysOn}
                onChange={() => toggle("lcdAlwaysOn")}
              />
            </div>
          </div>
          <div>
            <ColumnLabel>Core Parameters</ColumnLabel>
            <div className="divide-y divide-[var(--border)]">
              <InputOkRow label="Cell Count (n)" value={settings.cellCount} onConfirm={save("cellCount")} />
              <InputOkRow label="Capacity" value={settings.capacityAh} unit="Ah" onConfirm={save("capacityAh")} />
              <div className="flex items-center justify-between py-2.5">
                <span className="text-sm text-[var(--foreground)]">Battery Type</span>
                <span className="text-sm font-semibold text-[var(--foreground)]">{batteryType || "-"}</span>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">Capacity feeds the SOC% calculation on the main panel in real time.</p>
          </div>
        </div>
      )}

      {activeCategory === "protection" && (
        <div>
          <AccordionItem title="Voltage Protection" defaultOpen>
            <div className="divide-y divide-[var(--border)]">
              <InputOkRow label="Cell OVP" value={settings.cellOvp} unit="V" step="0.001" onConfirm={save("cellOvp")} />
              <InputOkRow label="Cell RCV" value={settings.cellRcv} unit="V" step="0.001" onConfirm={save("cellRcv")} />
              <InputOkRow label="SOC-100% Volt." value={settings.socFullVolt} unit="V" step="0.001" onConfirm={save("socFullVolt")} />
              <InputOkRow label="Cell OVPR" value={settings.cellOvpr} unit="V" step="0.001" onConfirm={save("cellOvpr")} />
              <InputOkRow label="Cell UVPR" value={settings.cellUvpr} unit="V" step="0.001" onConfirm={save("cellUvpr")} />
              <InputOkRow label="SOC-0% Volt." value={settings.soc0Volt} unit="V" step="0.001" onConfirm={save("soc0Volt")} />
              <InputOkRow label="Cell UVP" value={settings.cellUvp} unit="V" step="0.001" onConfirm={save("cellUvp")} />
              <InputOkRow label="PwrOff Volt." value={settings.pwrOffVolt} unit="V" step="0.001" onConfirm={save("pwrOffVolt")} />
            </div>
          </AccordionItem>
          <AccordionItem title="Current Protection">
            <div className="divide-y divide-[var(--border)]">
              <InputOkRow label="Continued ChgCurr" value={settings.contChgCurr} unit="A" onConfirm={save("contChgCurr")} />
              <InputOkRow label="Continued DsgCurr" value={settings.contDsgCurr} unit="A" onConfirm={save("contDsgCurr")} />
              <ToggleRow label="Discharge OCP 2" checked={settings.dsgOcp2} onChange={() => toggle("dsgOcp2")} />
              <ToggleRow label="Discharge OCP 3" checked={settings.dsgOcp3} onChange={() => toggle("dsgOcp3")} />
              <InputOkRow label="Charge OCP Delay" value={settings.chgOcpDelay} unit="s" onConfirm={save("chgOcpDelay")} />
              <InputOkRow label="Charge OCPR Time" value={settings.chgOcprTime} unit="s" onConfirm={save("chgOcprTime")} />
              <InputOkRow label="DSG OCP Delay" value={settings.dsgOcpDelay} unit="s" onConfirm={save("dsgOcpDelay")} />
              <InputOkRow label="DSG OCPR Time" value={settings.dsgOcprTime} unit="s" onConfirm={save("dsgOcprTime")} />
            </div>
          </AccordionItem>
          <AccordionItem title="Temperature Protection">
            <div className="divide-y divide-[var(--border)]">
              <ToggleRow
                label="Disable Temp-Sensor"
                checked={settings.disableTempSensor}
                onChange={() => toggle("disableTempSensor")}
              />
              <InputOkRow label="Charge OTP" value={settings.chgOtp} unit="°C" onConfirm={save("chgOtp")} />
              <InputOkRow label="Charge OTPR" value={settings.chgOtpr} unit="°C" onConfirm={save("chgOtpr")} />
              <InputOkRow label="Charge UTP" value={settings.chgUtp} unit="°C" onConfirm={save("chgUtp")} />
              <InputOkRow label="Charge UTPR" value={settings.chgUtpr} unit="°C" onConfirm={save("chgUtpr")} />
              <InputOkRow label="Discharge OTP" value={settings.dsgOtp} unit="°C" onConfirm={save("dsgOtp")} />
              <InputOkRow label="Discharge OTPR" value={settings.dsgOtpr} unit="°C" onConfirm={save("dsgOtpr")} />
              <InputOkRow label="Discharge UTP" value={settings.dsgUtp} unit="°C" onConfirm={save("dsgUtp")} />
              <InputOkRow label="CMOS OTP" value={settings.cmosOtp} unit="°C" onConfirm={save("cmosOtp")} />
              <InputOkRow label="CMOS OTPR" value={settings.cmosOtpr} unit="°C" onConfirm={save("cmosOtpr")} />
            </div>
          </AccordionItem>
        </div>
      )}

      {activeCategory === "balancer" && (
        <div>
          <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-[var(--foreground)]">Balancer</p>
              <p className="text-xs text-[var(--muted-foreground)]">
                {settings.maxBalCurrent}A max active cell balancing
              </p>
            </div>
            <Toggle checked={settings.balancer} onChange={() => toggle("balancer")} size="lg" />
          </div>
          <div className="mt-2 divide-y divide-[var(--border)]">
            <InputOkRow label="Bal. Delta Volt" value={settings.balDeltaVolt} unit="mV" onConfirm={save("balDeltaVolt")} />
            <InputOkRow label="Bal. Start Volt" value={settings.balStartVolt} unit="V" step="0.01" onConfirm={save("balStartVolt")} />
            <InputOkRow label="Max. Bal. Current" value={settings.maxBalCurrent} unit="A" step="0.1" onConfirm={save("maxBalCurrent")} />
          </div>
          <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">
            Turning Balancer off shows 0.0 A (Disabled) on the main panel immediately. Bal. Delta Volt also sets the
            ΔV warning threshold shown there.
          </p>
        </div>
      )}

      {activeCategory === "advanced" && (
        <div className="space-y-6">
          <div className="grid gap-x-10 md:grid-cols-2">
            <div>
              <ColumnLabel>Alarm and Emergency</ColumnLabel>
              <div className="divide-y divide-[var(--border)]">
                <ToggleRow
                  label="Intermittent Alarm"
                  checked={settings.intermittentAlarm}
                  onChange={() => toggle("intermittentAlarm")}
                />
                <SelectRow
                  label="LCD Buzzer Trigger"
                  value={settings.lcdBuzzerTrigger}
                  options={TRIGGER_LIST}
                  onConfirm={save("lcdBuzzerTrigger")}
                />
                <SelectRow
                  label="DRY1 Trigger"
                  value={settings.dry1Trigger}
                  options={TRIGGER_LIST}
                  onConfirm={save("dry1Trigger")}
                />
                <InputOkRow label="Emerg. Timer" value={settings.emergTimer} unit="s" onConfirm={save("emergTimer")} />
              </div>
            </div>
            <div>
              <ColumnLabel>Charge Control</ColumnLabel>
              <div className="divide-y divide-[var(--border)]">
                <ToggleRow
                  label="Charge Float Mode"
                  checked={settings.chargeFloatMode}
                  onChange={() => toggle("chargeFloatMode")}
                />
                <InputOkRow label="Cell RFV" value={settings.cellRfv} unit="V" step="0.01" onConfirm={save("cellRfv")} />
                <InputOkRow label="RCV Time" value={settings.rcvTime} unit="min" onConfirm={save("rcvTime")} />
                <InputOkRow label="RFV Time" value={settings.rfvTime} unit="min" onConfirm={save("rfvTime")} />
              </div>
            </div>
          </div>

          <div>
            <ColumnLabel>Data and Communication</ColumnLabel>
            <div className="grid gap-x-10 md:grid-cols-2">
              <div className="divide-y divide-[var(--border)]">
                <InputOkRow label="Device Address" value={settings.deviceAddress} onConfirm={save("deviceAddress")} />
                <ToggleRow
                  label="Timed Stored Data"
                  description="Periodically log to flash"
                  checked={settings.timedStoredData}
                  onChange={() => toggle("timedStoredData")}
                />
                <InputOkRow
                  label="Data Stored Period(s)"
                  value={settings.dataStoredPeriod}
                  unit="s"
                  onConfirm={save("dataStoredPeriod")}
                />
                <SelectRow
                  label="CAN Protocol"
                  value={settings.canProtocol}
                  options={CAN_PROTOCOL_LIST}
                  onConfirm={save("canProtocol")}
                />
              </div>
              <div className="divide-y divide-[var(--border)]">
                <SelectRow
                  label="UART1 Protocol"
                  value={settings.uart1Protocol}
                  options={UART_PROTOCOL_LIST}
                  onConfirm={save("uart1Protocol")}
                />
                <SelectRow
                  label="UART2 Protocol"
                  value={settings.uart2Protocol}
                  options={UART_PROTOCOL_LIST}
                  onConfirm={save("uart2Protocol")}
                />
                <SelectRow
                  label="UART3 Protocol"
                  value={settings.uart3Protocol}
                  options={UART_PROTOCOL_LIST}
                  onConfirm={save("uart3Protocol")}
                />
              </div>
            </div>
          </div>

          <div>
            <ColumnLabel>Calibration</ColumnLabel>
            <div className="divide-y divide-[var(--border)]">
              <InputOkRow
                label="Volt Calibration"
                value={settings.voltCalibration}
                unit="V"
                step="0.01"
                onConfirm={save("voltCalibration")}
                pullValue={liveBatteryVoltage}
                pullTitle="Pull current battery voltage"
              />
              <InputOkRow label="Curr. Calibration" value={settings.currCalibration} unit="A" step="0.1" onConfirm={save("currCalibration")} />
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
