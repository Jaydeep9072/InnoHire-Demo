"use client";

import { useEffect, useRef } from "react";
import styles from "./confirmation-dialog.module.css";

type ConfirmationDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  busyLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmationDialog({ open, title, description, confirmLabel, busyLabel = "Working…", busy = false, onCancel, onConfirm }: ConfirmationDialogProps) {
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    cancelButton.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onCancel(); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [busy, onCancel, open]);

  if (!open) return null;
  return <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="confirmation-dialog-title" aria-describedby="confirmation-dialog-description">
      <span className={styles.icon} aria-hidden="true">!</span>
      <h2 id="confirmation-dialog-title">{title}</h2>
      <p id="confirmation-dialog-description">{description}</p>
      <footer>
        <button ref={cancelButton} type="button" className={styles.cancelButton} onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className={styles.confirmButton} onClick={onConfirm} disabled={busy}>{busy ? busyLabel : confirmLabel}</button>
      </footer>
    </section>
  </div>;
}
