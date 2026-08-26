"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

export function InlineConfirm({ title, children, confirmLabel, busy = false, onCancel, onConfirm }: {
  title: string; children: ReactNode; confirmLabel: string; busy?: boolean;
  onCancel: () => void; onConfirm: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { firstButton.current?.focus(); }, []);
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [])];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [busy, onCancel]);
  return (
    <div ref={dialogRef} className="samograph-confirm" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <h3 id={titleId}>{title}</h3>
      <p>{children}</p>
      <div className="samograph-actions">
        <button ref={firstButton} type="button" className="samograph-btn samograph-btn--secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="samograph-btn samograph-btn--danger samograph-btn--solid" onClick={onConfirm} disabled={busy} aria-busy={busy}>{confirmLabel}</button>
      </div>
    </div>
  );
}
