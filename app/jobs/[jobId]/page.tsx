import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listOrdsJobs } from "@/lib/ords/client";
import { sanitizeRichText } from "@/lib/rich-text";
import { JobPublishAction } from "./publish-action";
import styles from "./job-detail.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ jobId: string }> }): Promise<Metadata> {
  const jobId = Number((await params).jobId);
  const job = Number.isInteger(jobId) ? (await listOrdsJobs(jobId))[0] : null;
  return { title: job?.title || "Job details" };
}

export default async function JobDetailPage({ params }: { params: Promise<{ jobId: string }> }) {
  const jobId = Number((await params).jobId);
  if (!Number.isInteger(jobId) || jobId <= 0) notFound();
  const job = (await listOrdsJobs(jobId))[0];
  if (!job) notFound();
  const skills = (job.required_skills || "").split(/[,\n]/).map((skill) => skill.trim()).filter(Boolean);
  const salaryRange = formatSalaryRange(job.min_salary, job.max_salary, job.currency, job.pay_frequency);

  return <div className={styles.page}>
    <div className={styles.breadcrumb}><Link href="/jobs">Job board</Link><span>/</span><span>Job #{job.job_posting_id}</span></div>
    <header className={styles.hero}>
      <div><p className={styles.eyebrow}>{job.department || "Job posting"}</p><h1>{job.title || `Job ${job.job_posting_id}`}</h1><div className={styles.meta}>{[job.location, label(job.workplace_type), label(job.employment_type)].filter(Boolean).map((value) => <span key={value}>{value}</span>)}</div></div>
      <div className={styles.heroActions}><span className={job.posting_status === "PUBLISHED" ? styles.published : job.posting_status === "CLOSED" ? styles.closed : styles.draft}>{label(job.posting_status) || "Unset"}</span><JobPublishAction jobId={job.job_posting_id} jobTitle={job.title || `Job #${job.job_posting_id}`} status={job.posting_status} canPublish={Boolean(job.external_job_id)} /></div>
    </header>

    {job.publish_error && <div className={styles.publishError}>{job.publish_error}</div>}

    <div className={styles.layout}>
      <main className={styles.content}>
        <section><h2>About the role</h2>{job.job_description ? <div className={styles.richText} dangerouslySetInnerHTML={{ __html: sanitizeRichText(job.job_description) }} /> : <p>Not provided.</p>}</section>
        <section><h2>Responsibilities</h2>{job.responsibilities ? <div className={styles.richText} dangerouslySetInnerHTML={{ __html: sanitizeRichText(job.responsibilities) }} /> : <p>Not provided.</p>}</section>
        <section><h2>Required skills</h2>{skills.length ? <div className={styles.skills}>{skills.map((skill) => <span key={skill}>{skill}</span>)}</div> : <p>Not provided.</p>}</section>
      </main>
      <aside className={styles.sidebar}>
        <section><h2>Role details</h2><dl><Detail label="Seniority" value={label(job.seniority_level)} /><Detail label="Experience" value={job.minimum_experience == null ? null : `${job.minimum_experience} years minimum`} /><Detail label="Openings" value={job.openings_count?.toString()} /><Detail label="Closing date" value={formatDate(job.closing_date)} /><Detail label="Job boards" value={job.job_boards} /></dl></section>
        <section><h2>Compensation</h2><dl><Detail label="Salary" value={formatMoney(job.salary, job.currency)} /><Detail label="Range" value={salaryRange} /><Detail label="Currency" value={job.currency} /><Detail label="Pay frequency" value={label(job.pay_frequency)} /></dl></section>
        <section><h2>Application</h2><dl><Detail label="LinkedIn draft ID" value={job.external_job_id} /><Detail label="Created" value={formatDate(job.created_at)} /><Detail label="Published" value={formatDate(job.published_at)} /></dl>{job.apply_url && <a className={styles.applyLink} href={job.apply_url} target="_blank" rel="noreferrer">Open candidate application page</a>}</section>
      </aside>
    </div>
  </div>;
}

function Detail({ label: detailLabel, value }: { label: string; value: string | null | undefined }) { return <div><dt>{detailLabel}</dt><dd>{value || "—"}</dd></div>; }
function label(value: string | null | undefined) { return value ? value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : ""; }
function formatDate(value: string | null) { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" }); }
function formatMoney(value: number | null, currency: string | null) { if (value == null) return null; return currency ? new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(value) : new Intl.NumberFormat("en").format(value); }
function formatSalaryRange(minimum: number | null, maximum: number | null, currency: string | null, frequency: string | null) { if (minimum == null && maximum == null) return null; const range = [formatMoney(minimum, currency), formatMoney(maximum, currency)].filter(Boolean).join(" – "); return `${range}${frequency ? ` / ${label(frequency).toLowerCase()}` : ""}`; }
