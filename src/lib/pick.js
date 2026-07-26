// Shared field-name fallback helper - the bridge firmware has gone through
// more than one naming scheme (snake_case like battery_voltage/percent_remain,
// then camelCase like totalVoltage/soc). Checks each key in order, returns
// the first one that's actually defined. Used by useBmsPackLive.js and by
// AdminStatusPreview.jsx so both read the exact same fallback chains rather
// than each guessing its own.
export function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj[k] !== undefined) return obj[k];
  }
  return undefined;
}
