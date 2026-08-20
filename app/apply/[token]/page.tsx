import type { Metadata } from "next";
import { listOrdsJobs } from "@/lib/ords/client";
import { findJobByApplicationToken } from "@/lib/applications/urls";
import { CandidateApplicationForm } from "./candidate-application-form";
import styles from "./application.module.css";
import { sanitizeRichText } from "@/lib/rich-text";

export const metadata: Metadata = {
  title: "Apply for a role",
  description: "Submit an application to InnoHire.",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function ApplicationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let job = null;
  try { job = findJobByApplicationToken(await listOrdsJobs(), token); } catch { /* Render a safe unavailable state. */ }

  if (!job) return <main className={styles.publicPage}><section className={styles.unavailable}><Brand /><span>Application unavailable</span><h1>This application link is not available.</h1><p>Check the URL or contact the hiring team for a new link.</p></section></main>;

  return <main className={styles.publicPage}>
    <header className={styles.publicHeader}><Brand /><span>Candidate application</span></header>
    <div className={styles.applicationLayout}>
      <aside className={styles.jobSummary}>
        <p className={styles.eyebrow}>Now hiring</p><h1>{job.title}</h1>
        <div className={styles.jobMeta}>{[job.department, job.location, label(job.workplace_type), label(job.employment_type)].filter(Boolean).map((item) => <span key={item}>{item}</span>)}</div>
        {job.job_description && <section><h2>About the role</h2><div className={styles.richJobText} dangerouslySetInnerHTML={{ __html: sanitizeRichText(job.job_description) }} /></section>}
        {job.required_skills && <section><h2>Required skills</h2><p>{job.required_skills}</p></section>}
      </aside>
      <CandidateApplicationForm token={token} jobTitle={job.title || "this role"} />
    </div>
  </main>;
}

function label(value: string | null) { return value ? value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase()) : null; }
function Brand() { return <div className={styles.brand}><span className={styles.brandMark}><span /></span><strong>INNOHIRE</strong></div>; }
