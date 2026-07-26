import React, { useEffect } from "react";
import { X } from "lucide-react";

export function Modal({ open, onClose, title, children, maxWidthClass = "max-w-3xl" }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative flex max-h-[85vh] w-full ${maxWidthClass} flex-col overflow-hidden rounded-2xl bg-[var(--card)] shadow-xl ring-1 ring-[var(--border)]`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-4 md:px-6">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1.5 hover:bg-[var(--muted)]"
          >
            <X className="size-4 text-[var(--muted-foreground)]" />
          </button>
        </div>
        <div className="overflow-y-auto p-5 md:p-6">{children}</div>
      </div>
    </div>
  );
}
