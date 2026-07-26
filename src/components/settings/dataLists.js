// Dropdown option lists for the Configuration popup - codes are what get
// written to settings/Firebase, labels are what the dropdown displays.

// Real value is the descriptive string itself (e.g. dry1_trigger:
// "MOSFET Over Temperature"), not a numeric code - confirmed live on
// e072a1d6dd18, same convention as CAN_PROTOCOL_LIST/UART_PROTOCOL_LIST
// below. code === label so SelectRow's existing API doesn't need to change
// shape.
export const TRIGGER_LIST = [
  "OFF",
  "Low SOC",
  "Battery Over Voltage",
  "Battery Under Voltage",
  "Battery Cell Over Voltage",
  "Battery Cell Under Voltage",
  "Charge Over Current",
  "Discharge Over Current",
  "Battery over Temperature",
  "MOSFET Over Temperature",
  "SysAlarm",
  "Battery Low Temperature",
  "GPS Remote Control",
].map((v) => ({ code: v, label: v }));

// CAN Protocol and UART1/2/3 Protocol do NOT share an option pool - that was
// a wrong assumption earlier (the first <select> markup captured happened
// to be for a UART field, and CAN's own list was only confirmed later).
// Both confirmed directly from the real BMS app's own <select> markup. The
// value IS the descriptive string itself, not a numeric code - real
// Firebase data stores e.g. can_protocol: "Victron_CANbus_BMS_protocol_
// 20170717" directly. {code, label} kept identical (code === label) so
// SelectRow's existing API doesn't need to change shape.
export const CAN_PROTOCOL_LIST = [
  "JK BMS CAN Protocol (250K) V2.0",
  "Deye Low-voltage hybrid inverter CAN communication protocol V1.0",
  "PYLON-Low-voltage-V1.2",
  "Growatt BMS CAN-Bus-protocol-low-voltage_Rev_05",
  "Victron_CANbus_BMS_protocol_20170717",
  "MEGAREVO_Hybird_BMSCAN_Protocol_V1.0",
  "JK BMS CAN Protocol (500K) V2.0",
  "INVT BMS CAN Bus protocol V1.02",
  "GoodWe LV BMS Protocol (EX/EM/S-BP/BP)",
  "FSS-ConnectingBat-TI-en-10 Version 1.0",
  "MUST PV1800F-CAN communication Protocol1.04.04",
  "LuxpowerTek Battery CAN protocol V01",
  "CAN BUS User customization 1",
  "CAN BUS User customization 2",
].map((v) => ({ code: v, label: v }));

export const UART_PROTOCOL_LIST = [
  "4G-GPS Remote module Common protocol V4.2",
  "JK BMS RS485 Modbus V1.0",
  "NIU U SERIES",
  "China tower shared battery cabinet V1.1",
  "PACE_RS485_Modbus_V1.3",
  "PYLON_low_voltage_Protocol_RS485_V3.5",
  "Growatt_BMS_RS485_Protocol_1xSxxP_ESS_Rev2.01",
  "Voltronic_Inverter_and_BMS_485_communication_protocol_20200325",
  "China tower shared battery cabinet V2.0",
  "WOW_RS485_Modbus_V1.3",
  "JK BMS LCD Protocol V2.0",
  "UART1 User customization",
  "UART2 User customization",
  "(9600) JK BMS RS485 Modbus V1.0",
  "(9600) PYLON_low_voltage_Protocol_RS485_V3.5",
  "JK BMS PBxx SERIES LCD Protocol V1.0",
  "JK BMS LIN BUS V1.0",
  "RS485 Protocol 17",
  "RS485 Protocol 18",
  "RS485 Protocol 19",
  "RS485 Protocol 20",
].map((v) => ({ code: v, label: v }));
