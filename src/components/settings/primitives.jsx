import React, { useState, useEffect } from "react";
import { ChevronDown, Download } from "lucide-react";

/**
 * Form controls for the Configuration popup: solid white surfaces (matches
 * the rest of the dashboard's --card/--border tokens, no glass/translucency
 * per feedback), with emerald as the "on"/confirmed accent. Every field
 * types-then-OK (draft state held locally, committed only when OK is
 * pressed) so nothing writes to Firebase on every keystroke.
 */

export function Toggle({ checked, onChange, size = "md", disabled = false }) {
  const dims =
    size === "lg"
      ? { track: "h-7 w-12", thumb: "size-[22px]", travel: "translate-x-5" }
      : { track: "h-6 w-10", thumb: "size-[18px]", travel: "translate-x-4" };
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex shrink-0 items-center rounded-full border transition-colors ${dims.track} ${
        checked ? "border-emerald-500 bg-emerald-500" : "border-[var(--border)] bg-[var(--muted)]"
      } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
    >
      <span
        className={`absolute left-0.5 inline-block rounded-full bg-white shadow-sm transition-transform ${dims.thumb} ${
          checked ? dims.travel : "translate-x-0"
        }`}
      />
      <span className="sr-only">{checked ? "On" : "Off"}</span>
    </button>
  );
}

export function ToggleRow({ label, description, checked, onChange, size }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div>
        <p className="text-sm text-[var(--foreground)]">{label}</p>
        {description && <p className="text-xs text-[var(--muted-foreground)]">{description}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} size={size} />
    </div>
  );
}

function OkButton({ saved, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
        saved ? "border-emerald-500 bg-emerald-500 text-white" : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
      }`}
    >
      {saved ? "✓" : "OK"}
    </button>
  );
}

export function InputOkRow({ label, value, unit, onConfirm, step = "any", pullValue, pullTitle = "Pull current reading" }) {
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const dirty = String(draft) !== String(value);

  function confirm() {
    if (draft === "" || Number.isNaN(Number(draft))) return;
    onConfirm(Number(draft));
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  }

  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-sm text-[var(--foreground)]">{label}</span>
      <div className="flex items-center gap-2">
        <div
          className={`flex items-center gap-1 rounded-lg border bg-[var(--muted)] px-2 py-1 ${
            dirty ? "border-amber-400" : "border-[var(--border)]"
          }`}
        >
          <input
            type="number"
            step={step}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && confirm()}
            className="w-16 bg-transparent text-right text-sm text-emerald-700 outline-none tabular-nums"
          />
          {unit && <span className="text-xs text-[var(--muted-foreground)]">{unit}</span>}
        </div>
        {pullValue !== undefined && (
          <button
            type="button"
            title={pullTitle}
            onClick={() => setDraft(String(pullValue))}
            className="rounded-lg border border-[var(--border)] p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
          >
            <Download className="size-3.5" />
          </button>
        )}
        <OkButton saved={saved} onClick={confirm} />
      </div>
    </div>
  );
}

export function SelectRow({ label, value, options, onConfirm }) {
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const dirty = draft !== value;

  // If the real synced value isn't one of the known options (e.g. Firebase
  // reports a string this list doesn't enumerate yet, or a device still on
  // an older code-based convention), a native <select> silently falls back
  // to displaying its FIRST option - looking exactly like "unsynced" even
  // though the underlying state is actually correct. Injecting the raw
  // value as an extra option guarantees what's shown always matches what's
  // really stored, never a silently-wrong substitute.
  const hasMatch = options.some((o) => o.code === draft);
  const displayOptions = hasMatch || draft === "" || draft == null ? options : [{ code: draft, label: draft }, ...options];

  function confirm() {
    onConfirm(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  }

  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-sm text-[var(--foreground)]">{label}</span>
      <div className="flex items-center gap-2">
        <select
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className={`max-w-[220px] truncate rounded-lg border bg-[var(--muted)] px-2 py-1.5 text-xs text-emerald-700 outline-none ${
            dirty ? "border-amber-400" : "border-[var(--border)]"
          }`}
        >
          {displayOptions.map((o) => (
            <option key={o.code} value={o.code}>
              {o.code === o.label ? o.label : `${o.code} - ${o.label}`}
            </option>
          ))}
        </select>
        <OkButton saved={saved} onClick={confirm} />
      </div>
    </div>
  );
}

export function AccordionItem({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-[var(--border)] last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between py-3 text-left"
        aria-expanded={open}
      >
        <span className="text-sm font-semibold text-[var(--foreground)]">{title}</span>
        <ChevronDown className={`size-4 text-[var(--muted-foreground)] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="pb-4">{children}</div>}
    </div>
  );
}
