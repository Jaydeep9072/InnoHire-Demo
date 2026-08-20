"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import styles from "./job-detail.module.css";

function apiErrorMessage(payload: { error?: unknown }, fallback: string) {
  return typeof payload.error === "string" && payload.error.trim() ? payload.error.trim() : fallback;
}

export function JobPublishAction({ jobId, jobTitle, status, hasLinkedInJob, hasApplyUrl }: { jobId: number; jobTitle: string; status: string | null; hasLinkedInJob: boolean; hasApplyUrl: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"publish" | "close" | "application_page" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closedLocally, setClosedLocally] = useState(false);
  if (closedLocally || (status !== "DRAFT" && status !== "PUBLISHED")) return null;
  async function run(action: "publish" | "close" | "application_page") {
    setBusy(action); setError(null);
    try {
      const response = await fetch("/api/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, jobId }) });
      const payload = await response.json();
      const fallback = action === "publish" ? "The job could not be published." : action === "close" ? "The job could not be closed." : "The candidate application page could not be created.";
      if (!response.ok) throw new Error(apiErrorMessage(payload, fallback));
      if (action === "close") { setCloseOpen(false); setClosedLocally(true); }
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The requested action could not be completed."); }
    finally { setBusy(null); }
  }
  return <><div className={styles.publishAction}>{!hasApplyUrl && <button type="button" onClick={() => run("application_page")} disabled={Boolean(busy)}>{busy === "application_page" ? "Creating page…" : "Create application page"}</button>}{status === "DRAFT" ? <button type="button" onClick={() => run("publish")} disabled={Boolean(busy) || !hasLinkedInJob || !hasApplyUrl}>{busy === "publish" ? "Publishing…" : !hasLinkedInJob ? "LinkedIn draft unavailable" : !hasApplyUrl ? "Create application page first" : "Publish on LinkedIn"}</button> : <button type="button" className={styles.closeJobAction} onClick={() => setCloseOpen(true)} disabled={Boolean(busy) || !hasLinkedInJob}>{busy === "close" ? "Closing…" : "Close job"}</button>}{error && <span>{error}</span>}</div><ConfirmationDialog open={closeOpen} title="Close this job?" description={`${jobTitle} will be closed on LinkedIn and candidates will no longer be able to apply.`} confirmLabel="Close job" busyLabel="Closing job…" busy={busy === "close"} onCancel={() => setCloseOpen(false)} onConfirm={() => void run("close")} /></>;
}
