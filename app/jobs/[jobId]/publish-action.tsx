"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import styles from "./job-detail.module.css";

export function JobPublishAction({ jobId, jobTitle, status, canPublish }: { jobId: number; jobTitle: string; status: string | null; canPublish: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"publish" | "close" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closedLocally, setClosedLocally] = useState(false);
  if (closedLocally || (status !== "DRAFT" && status !== "PUBLISHED")) return null;
  async function run(action: "publish" | "close") {
    setBusy(action); setError(null);
    try {
      const response = await fetch("/api/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, jobId }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `The job could not be ${action === "publish" ? "published" : "closed"}.`);
      if (action === "close") { setCloseOpen(false); setClosedLocally(true); }
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : `The job could not be ${action === "publish" ? "published" : "closed"}.`); }
    finally { setBusy(null); }
  }
  return <><div className={styles.publishAction}>{status === "DRAFT" ? <button type="button" onClick={() => run("publish")} disabled={Boolean(busy) || !canPublish}>{busy === "publish" ? "Publishing…" : canPublish ? "Publish on LinkedIn" : "LinkedIn draft unavailable"}</button> : <button type="button" className={styles.closeJobAction} onClick={() => setCloseOpen(true)} disabled={Boolean(busy) || !canPublish}>{busy === "close" ? "Closing…" : "Close job"}</button>}{error && <span>{error}</span>}</div><ConfirmationDialog open={closeOpen} title="Close this job?" description={`${jobTitle} will be closed on LinkedIn and candidates will no longer be able to apply.`} confirmLabel="Close job" busyLabel="Closing job…" busy={busy === "close"} onCancel={() => setCloseOpen(false)} onConfirm={() => void run("close")} /></>;
}
