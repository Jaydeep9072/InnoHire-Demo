"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { JobListItem } from "@/types/domain";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import styles from "./all-jobs.module.css";

type JobsResponse = { configured: boolean; jobs: JobListItem[]; error?: string };

export function AllJobs() {
  const [data, setData] = useState<JobsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [publishingId, setPublishingId] = useState<number | null>(null);
  const [closingId, setClosingId] = useState<number | null>(null);
  const [closeTarget, setCloseTarget] = useState<{ id: number; title: string } | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const load = useCallback(() => {
    let active = true;
    fetch("/api/jobs")
      .then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Jobs could not be loaded."); return payload; })
      .then((payload) => { if (active) setData(payload); })
      .catch((error) => { if (active) setData({ configured: true, jobs: [], error: error instanceof Error ? error.message : "Jobs could not be loaded." }); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => load(), [load]);

  async function publish(jobId: number) {
    setPublishingId(jobId); setActionMessage(null);
    try {
      const response = await fetch("/api/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "publish", jobId }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The job could not be published.");
      setActionMessage({ type: "success", text: payload.message || "Job published successfully." });
      load();
    } catch (error) { setActionMessage({ type: "error", text: error instanceof Error ? error.message : "The job could not be published." }); }
    finally { setPublishingId(null); }
  }

  async function closeJob(jobId: number) {
    setClosingId(jobId); setActionMessage(null);
    try {
      const response = await fetch("/api/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "close", jobId }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The job could not be closed.");
      setActionMessage({ type: "success", text: payload.message || "Job closed successfully." });
      setData((current) => current ? { ...current, jobs: current.jobs.map((job) => job.job_posting_id === jobId ? { ...job, posting_status: "CLOSED" } : job) } : current);
      setCloseTarget(null);
      load();
    } catch (error) { setActionMessage({ type: "error", text: error instanceof Error ? error.message : "The job could not be closed." }); }
    finally { setClosingId(null); }
  }

  const jobs = useMemo(() => data?.jobs || [], [data]);
  const filtered = useMemo(() => jobs.filter((job) => {
    const text = `${job.title || ""} ${job.department || ""} ${job.location || ""}`.toLowerCase();
    return (!search || text.includes(search.toLowerCase())) && (!status || job.posting_status === status);
  }), [jobs, search, status]);
  const published = jobs.filter((job) => job.posting_status === "PUBLISHED").length;
  const drafts = jobs.filter((job) => job.posting_status === "DRAFT").length;
  const applicants = jobs.reduce((total, job) => total + Number(job.applicant_count || 0), 0);

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div><p className={styles.eyebrow}>Job board</p><h1>All jobs</h1><p>Manage job drafts, published roles, and applicant activity in one place.</p></div>
        <Link href="/jobs/new" className={styles.primaryAction}>Post a job</Link>
      </header>

      {actionMessage && <div role="status" className={actionMessage.type === "success" ? styles.actionSuccess : styles.actionError}>{actionMessage.text}</div>}

      {!loading && data && !data.configured ? <section className={styles.configurationState}><span>DB</span><h2>Connect ORDS to view jobs</h2><p>Your job board will display saved and published roles after the ORDS base URL is configured.</p><Link href="/jobs/new">Open job creator</Link></section> : data?.error ? <section className={styles.errorState}>{data.error}</section> : <>
        <section className={styles.summaryGrid} aria-label="Job board summary">
          <Summary label="Total jobs" value={jobs.length} detail="All saved roles" loading={loading} />
          <Summary label="Published" value={published} detail="Live job records" loading={loading} />
          <Summary label="Drafts" value={drafts} detail="Not yet published" loading={loading} />
          <Summary label="Applicants" value={applicants} detail="Across all jobs" loading={loading} />
        </section>

        <section className={styles.jobsPanel}>
          <div className={styles.panelHeader}>
            <div><h2>Job listings</h2><p>{loading ? "Loading jobs…" : `${filtered.length} of ${jobs.length} jobs`}</p></div>
            <div className={styles.filters}>
              <label><span className={styles.searchIcon}>⌕</span><input aria-label="Search jobs" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title, department or location" /></label>
              <select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option><option value="DRAFT">Draft</option><option value="PUBLISHING">Publishing</option><option value="READY_TO_PUBLISH">Ready to publish</option><option value="PUBLISHED">Published</option><option value="CLOSED">Closed</option><option value="PUBLISH_FAILED">Publish failed</option></select>
            </div>
          </div>

          <div className={styles.tableWrap}>
            <table><thead><tr><th>Job</th><th>Type</th><th>Location</th><th>Channel</th><th>Applicants</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
              <tbody>{filtered.map((job) => <tr key={job.job_posting_id}>
                <td data-label="Job"><Link className={styles.jobLink} href={`/jobs/${job.job_posting_id}`}><strong>{job.title || `Job ${job.job_posting_id}`}</strong><small>{job.department || "No department"} · #{job.job_posting_id}</small></Link></td>
                <td data-label="Type">{formatLabel(job.employment_type)}<small>{formatLabel(job.workplace_type)}</small></td>
                <td data-label="Location">{job.location || "—"}</td>
                <td data-label="Channel">{job.job_boards ? <span className={styles.unpublished}>{job.job_boards}</span> : job.external_job_id ? <span className={styles.linkedinBadge}><b>in</b> LinkedIn</span> : <span className={styles.unpublished}>Not selected</span>}</td>
                <td data-label="Applicants"><strong>{Number(job.applicant_count || 0)}</strong></td>
                <td data-label="Status"><span className={`${styles.status} ${styles[statusTone(job.posting_status)]}`}>{formatLabel(job.posting_status) || "Unset"}</span></td>
                <td data-label="Created">{formatDate(job.created_at)}</td>
                <td data-label="Actions"><div className={styles.rowActions}><Link href={`/jobs/${job.job_posting_id}`}>View</Link>{job.posting_status === "DRAFT" && <button type="button" onClick={() => publish(job.job_posting_id)} disabled={publishingId === job.job_posting_id || !job.external_job_id} title={job.external_job_id ? "Publish this LinkedIn draft" : "Create the LinkedIn draft before publishing"}>{publishingId === job.job_posting_id ? "Publishing…" : "Publish"}</button>}{job.posting_status === "PUBLISHED" && <button type="button" className={styles.closeButton} onClick={() => setCloseTarget({ id: job.job_posting_id, title: job.title || `Job #${job.job_posting_id}` })} disabled={closingId === job.job_posting_id}>{closingId === job.job_posting_id ? "Closing…" : "Close job"}</button>}</div></td>
              </tr>)}</tbody>
            </table>
            {!loading && !filtered.length && <div className={styles.emptyState}><span>▤</span><h2>{jobs.length ? "No jobs match these filters" : "No jobs have been created"}</h2><p>{jobs.length ? "Change the search or status filter to see more jobs." : "Create your first role and save it as a draft or publish it to LinkedIn."}</p>{!jobs.length && <Link href="/jobs/new">Post your first job</Link>}</div>}
          </div>
        </section>
      </>}
      <ConfirmationDialog open={Boolean(closeTarget)} title="Close this job?" description={`${closeTarget?.title || "This job"} will be closed on LinkedIn and candidates will no longer be able to apply.`} confirmLabel="Close job" busyLabel="Closing job…" busy={Boolean(closingId)} onCancel={() => setCloseTarget(null)} onConfirm={() => { if (closeTarget) void closeJob(closeTarget.id); }} />
    </div>
  );
}

function Summary({ label, value, detail, loading }: { label: string; value: number; detail: string; loading: boolean }) { return <article className={styles.summaryCard}><span>{label}</span>{loading ? <i /> : <strong>{value}</strong>}<small>{detail}</small></article>; }
function formatLabel(value: string | null) { return value ? value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : ""; }
function formatDate(value: string | null) { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); }
function statusTone(value: string | null) { if (value === "PUBLISHED") return "success"; if (value === "PUBLISH_FAILED") return "danger"; if (value === "PUBLISHING" || value === "READY_TO_PUBLISH") return "progress"; return "neutral"; }
