"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./job-form.module.css";
import { RichTextEditor } from "./rich-text-editor";

const steps = ["Job details", "Description", "Requirements", "Review & publish"];
const postingChannels = [
  { name: "LinkedIn", mark: "in" },
  { name: "Indeed", mark: "i" },
  { name: "Naukri", mark: "N" },
  { name: "Glassdoor", mark: "G" },
  { name: "Monster", mark: "M" },
  { name: "ZipRecruiter", mark: "Z" },
];
const currencies = [
  ["AED", "UAE Dirham"], ["USD", "US Dollar"], ["EUR", "Euro"], ["GBP", "British Pound"], ["INR", "Indian Rupee"],
  ["CAD", "Canadian Dollar"], ["AUD", "Australian Dollar"], ["SGD", "Singapore Dollar"], ["SAR", "Saudi Riyal"], ["JPY", "Japanese Yen"],
  ["CNY", "Chinese Yuan"], ["CHF", "Swiss Franc"], ["QAR", "Qatari Riyal"], ["KWD", "Kuwaiti Dinar"], ["NZD", "New Zealand Dollar"],
];
type JobState = {
  localJobId?: number; title: string; department: string; jobDescription: string; responsibilities: string;
  requiredSkills: string; minimumExperience: number; location: string;
  salary: string; currency: string; minSalary: string; maxSalary: string; payFrequency: "YEARLY" | "MONTHLY" | "HOURLY" | "";
  workplaceType: "ON_SITE" | "HYBRID" | "REMOTE"; employmentType: "FULL_TIME" | "PART_TIME" | "CONTRACT" | "TEMPORARY" | "OTHER" | "VOLUNTEER" | "INTERNSHIP";
  seniorityLevel: string; openingsCount: number; closingDate: string; sourceFileName?: string; sourceFileType?: string; jobBoards: string[];
  applyUrl?: string;
  linkedinJobTitleId: string; linkedinCompanyId: string; linkedinLocationId: string; notificationEmail: string;
};

const initialJob: JobState = {
  title: "", department: "", jobDescription: "", responsibilities: "", requiredSkills: "",
  minimumExperience: 0, salary: "", currency: "", minSalary: "", maxSalary: "", payFrequency: "", location: "", workplaceType: "ON_SITE", employmentType: "FULL_TIME", seniorityLevel: "",
  openingsCount: 1, closingDate: "", jobBoards: ["LinkedIn"], linkedinJobTitleId: "", linkedinCompanyId: "", linkedinLocationId: "", notificationEmail: "",
};

function hasEditorContent(value: string) { return value.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim().length > 0; }
function formatMoneyInput(value: string) { const digits = value.replace(/\D/g, ""); return digits ? new Intl.NumberFormat("en-US").format(Number(digits)) : ""; }
function apiErrorMessage(payload: { error?: unknown }, fallback: string) {
  return typeof payload.error === "string" && payload.error.trim() ? payload.error.trim() : fallback;
}

export function JobForm() {
  const router = useRouter();
  const [activeStep, setActiveStep] = useState(0);
  const [job, setJob] = useState<JobState>(initialJob);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState<"extract" | "draft" | "submit" | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadedFile = useRef<File | null>(null);

  const linkedInReady = !job.jobBoards.includes("LinkedIn") || Boolean(job.linkedinCompanyId && job.linkedinLocationId);
  const stepChecks = [
    Boolean(job.title && job.department && job.seniorityLevel && job.location && job.workplaceType && job.employmentType && job.openingsCount > 0),
    Boolean(hasEditorContent(job.jobDescription) && hasEditorContent(job.responsibilities)),
    Boolean(job.requiredSkills),
    Boolean(job.jobBoards.length > 0 && linkedInReady),
  ];

  function update<K extends keyof JobState>(key: K, value: JobState[K]) { setJob((current) => ({ ...current, [key]: value })); setMessage(null); }
  function handleFile(file?: File) { if (!file) return; uploadedFile.current = file; setFileName(file.name); setJob((current) => ({ ...current, sourceFileName: file.name, sourceFileType: file.type || "application/octet-stream" })); setMessage(null); void extractDocument(file); }
  function toggleChannel(channel: string) { setJob((current) => ({ ...current, jobBoards: current.jobBoards.includes(channel) ? current.jobBoards.filter((item) => item !== channel) : [...current.jobBoards, channel] })); setMessage(null); }

  async function extractDocument(selectedFile?: File) {
    const file = selectedFile || uploadedFile.current;
    if (!file) return;
    setBusy("extract"); setMessage(null);
    try {
      const formData = new FormData(); formData.append("file", file);
      const response = await fetch("/api/documents/extract", { method: "POST", body: formData });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The document could not be read.");
      setJob((current) => ({ ...current, ...payload.job, salary: "", minSalary: payload.job.minSalary == null ? "" : formatMoneyInput(String(payload.job.minSalary)), maxSalary: payload.job.maxSalary == null ? "" : formatMoneyInput(String(payload.job.maxSalary)), sourceFileName: file.name, sourceFileType: file.type || "application/octet-stream" }));
      setActiveStep(0); setMessage({ type: "success", text: `The AI agent analyzed ${file.name} and filled the job form.` });
    } catch (error) { setMessage({ type: "error", text: error instanceof Error ? error.message : "The document could not be read." }); }
    finally { setBusy(null); }
  }

  async function save(action: "draft" | "submit") {
    setBusy(action); setMessage(null);
    try {
      const response = await fetch("/api/jobs", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ action, job }) });
      const payload = await response.json();
      if (!response.ok) {
        const firstFieldError = payload.fields ? Object.values(payload.fields).flat().find(Boolean) : null;
        throw new Error(String(firstFieldError || apiErrorMessage(payload, "The job could not be saved.")));
      }
      setJob((current) => ({ ...current, localJobId: payload.jobId, applyUrl: payload.applyUrl || current.applyUrl }));
      if (action === "submit") { router.push(`/jobs/${payload.jobId}`); return; }
      setMessage({ type: "success", text: `Draft #${payload.jobId} saved.` });
    } catch (error) { setMessage({ type: "error", text: error instanceof Error ? error.message : "The job could not be saved." }); }
    finally { setBusy(null); }
  }

  return (
    <div className={styles.page}>
      <section className={styles.pageHeader}><div><p className={styles.eyebrow}>Job board</p><h1>Create a new job</h1><p>Build the role, review every detail, then publish it to a connected job board.</p></div>{job.localJobId && <div className={styles.draftStatus}><span className={styles.savedDot} /> Draft #{job.localJobId}</div>}</section>

      <ol className={styles.stepper} aria-label="Job creation progress">{steps.map((step, index) => <li key={step}><button type="button" className={index === activeStep ? styles.stepActive : stepChecks[index] ? styles.stepComplete : styles.step} onClick={() => setActiveStep(index)}><span>{stepChecks[index] ? "✓" : index + 1}</span><strong>{step}</strong></button></li>)}</ol>

      {message && <div role="status" className={message.type === "success" ? styles.messageSuccess : styles.messageError}><span>{message.type === "success" ? "✓" : "!"}</span>{message.text}</div>}

      <div className={styles.workspace}>
        <section className={styles.formPanel}>
          {activeStep === 0 && <>
            <SectionHeading number="01" title="Role overview" subtitle="Start with the information candidates see first." />
            <div className={styles.formGrid}>
              <Field label="Job title *" full><input value={job.title} onChange={(event) => update("title", event.target.value)} placeholder="Enter the role title" /></Field>
              <Field label="Department *"><select value={job.department} onChange={(event) => update("department", event.target.value)}><option value="" disabled>Select department</option>{job.department && !["Engineering", "Product", "Design", "Consulting", "Operations", "Sales", "Marketing", "Human Resources", "Finance"].includes(job.department) && <option>{job.department}</option>}<option>Engineering</option><option>Product</option><option>Design</option><option>Consulting</option><option>Operations</option><option>Sales</option><option>Marketing</option><option>Human Resources</option><option>Finance</option></select></Field>
              <Field label="Seniority level *"><select value={job.seniorityLevel} onChange={(event) => update("seniorityLevel", event.target.value)}><option value="" disabled>Select level</option><option value="ENTRY_LEVEL">Entry level</option><option value="ASSOCIATE">Associate</option><option value="MID_SENIOR_LEVEL">Mid-senior</option><option value="DIRECTOR">Director</option><option value="EXECUTIVE">Executive</option></select></Field>
              <Field label="Location *"><input value={job.location} onChange={(event) => update("location", event.target.value)} placeholder="City, state or country" /></Field>
              <Field label="Workplace type *"><div className={styles.segmented}>{(["ON_SITE", "HYBRID", "REMOTE"] as const).map((value) => <button type="button" key={value} onClick={() => update("workplaceType", value)} className={job.workplaceType === value ? styles.segmentActive : undefined}>{value === "ON_SITE" ? "On-site" : value[0] + value.slice(1).toLowerCase()}</button>)}</div></Field>
              <Field label="Employment type *"><select value={job.employmentType} onChange={(event) => update("employmentType", event.target.value as JobState["employmentType"])}><option value="FULL_TIME">Full-time</option><option value="PART_TIME">Part-time</option><option value="CONTRACT">Contract</option><option value="TEMPORARY">Temporary</option><option value="INTERNSHIP">Internship</option><option value="OTHER">Other</option></select></Field>
              <Field label="Number of openings *"><input value={job.openingsCount} onChange={(event) => update("openingsCount", Number(event.target.value))} type="number" min="1" /></Field>
              <Field label="Application closing date"><input value={job.closingDate} onChange={(event) => update("closingDate", event.target.value)} type="date" /></Field>
            </div>
            <div className={styles.sectionDivider} />
            <div className={styles.editorHeading}><div><h2>Compensation</h2><p>Add the salary range shown to candidates.</p></div></div>
            <div className={styles.formGrid}>
              <Field label="Currency"><select value={job.currency} onChange={(event) => update("currency", event.target.value)}><option value="">Select currency</option>{currencies.map(([code, name]) => <option value={code} key={code}>{code} — {name}</option>)}</select></Field>
              <Field label="Pay frequency"><select value={job.payFrequency} onChange={(event) => update("payFrequency", event.target.value as JobState["payFrequency"])}><option value="">Select frequency</option><option value="YEARLY">Yearly</option><option value="MONTHLY">Monthly</option><option value="HOURLY">Hourly</option></select></Field>
              <Field label="Minimum salary"><input inputMode="numeric" value={job.minSalary} onChange={(event) => update("minSalary", formatMoneyInput(event.target.value))} placeholder="e.g. 100,000" /></Field>
              <Field label="Maximum salary"><input inputMode="numeric" value={job.maxSalary} onChange={(event) => update("maxSalary", formatMoneyInput(event.target.value))} placeholder="e.g. 140,000" /></Field>
            </div>
          </>}

          {activeStep === 1 && <>
            <SectionHeading number="02" title="Job description" subtitle="Explain the opportunity, impact, and day-to-day responsibilities." />
            <div className={styles.formGrid}>
              <Field label="About the role *" full><RichTextEditor label="About the role" value={job.jobDescription} onChange={(value) => update("jobDescription", value)} placeholder="Describe the role, its impact, and what success looks like…" /></Field>
              <Field label="Responsibilities *" full><RichTextEditor label="Responsibilities" value={job.responsibilities} onChange={(value) => update("responsibilities", value)} placeholder="Add the responsibilities for this role…" /></Field>
            </div>
          </>}

          {activeStep === 2 && <>
            <SectionHeading number="03" title="Candidate requirements" subtitle="Define the evidence used to match applicants to this role." />
            <div className={styles.notice}><span>✦</span><div><strong>Explainable matching</strong><p>Skills and experience below are compared only with the candidate’s professional profile and résumé content.</p></div></div>
            <div className={styles.formGrid}>
              <Field label="Required skills *" full><textarea value={job.requiredSkills} onChange={(event) => update("requiredSkills", event.target.value)} rows={7} placeholder="Enter skills separated by commas or one per line…" /></Field>
              <Field label="Minimum experience (years)"><input value={job.minimumExperience} onChange={(event) => update("minimumExperience", Number(event.target.value))} type="number" min="0" max="80" /></Field>
            </div>
          </>}

          {activeStep === 3 && <>
            <SectionHeading number="04" title="Review and publish" subtitle="Confirm the LinkedIn identifiers and publish this job." />
            <div className={styles.reviewGrid}>
              <article className={styles.reviewCard}><span>Role</span><strong>{job.title || "Job title not added"}</strong><p>{[job.department, job.location, job.workplaceType.replace("_", " ")].filter(Boolean).join(" · ") || "Role details are incomplete"}</p></article>
              <article className={styles.reviewCard}><span>Requirements</span><strong>{job.minimumExperience} years minimum</strong><p>{job.requiredSkills ? `${job.requiredSkills.split(/[,\n]/).filter(Boolean).length} required skills` : "Required skills not added"}</p></article>
              <article className={styles.reviewCard}><span>Compensation</span><strong>{job.minSalary || job.maxSalary ? `${job.minSalary || "—"} – ${job.maxSalary || "—"} ${job.currency}` : "Not added"}</strong><p>{job.payFrequency ? job.payFrequency.toLowerCase() : "Pay frequency not added"}</p></article>
            </div>
            <div className={styles.sectionDivider} />
            <div className={styles.channelHeading}><h2>Choose where to publish</h2></div>
            <div className={styles.channelGrid} role="group" aria-label="Job posting channels">
              {postingChannels.map((channel) => { const selected = job.jobBoards.includes(channel.name); return <button key={channel.name} type="button" aria-pressed={selected} onClick={() => toggleChannel(channel.name)} className={selected ? styles.channelSelected : styles.channelOption}><span>{channel.mark}</span><strong>{channel.name}</strong></button>; })}
            </div>
            {job.jobBoards.length > 0 && <><div className={styles.sectionDivider} /><div className={styles.platformRequirements}>
              {job.jobBoards.map((channel) => <section className={styles.platformPanel} key={channel}>
                <div className={styles.integrationHeading}><div><span>{postingChannels.find((item) => item.name === channel)?.mark}</span><h2>{channel} publishing details</h2></div></div>
                {channel === "LinkedIn" ? <div className={styles.formGrid}>
                  <Field label="LinkedIn company ID *"><input value={job.linkedinCompanyId} onChange={(event) => update("linkedinCompanyId", event.target.value)} placeholder="Company parameter ID" /></Field>
                  <Field label="LinkedIn location ID *"><input value={job.linkedinLocationId} onChange={(event) => update("linkedinLocationId", event.target.value)} placeholder="Numeric location parameter ID" /></Field>
                  <Field label="LinkedIn job title ID"><input value={job.linkedinJobTitleId} onChange={(event) => update("linkedinJobTitleId", event.target.value)} placeholder="Optional title parameter ID" /></Field>
                  <Field label="External application page"><input value={job.applyUrl || "Generated automatically when saved"} readOnly aria-readonly="true" /></Field>
                </div> : <div className={styles.noPlatformFields}>No additional fields are required for {channel}.</div>}
              </section>)}
            </div></>}
          </>}

          <div className={styles.formFooter}><button className={styles.secondaryButton} type="button" onClick={() => save("draft")} disabled={busy !== null}>{busy === "draft" ? "Saving…" : "Save draft"}</button><div className={styles.stepActions}>{activeStep > 0 && <button className={styles.secondaryButton} type="button" onClick={() => setActiveStep(activeStep - 1)}>Back</button>}{activeStep < steps.length - 1 ? <button className={styles.primaryButton} type="button" onClick={() => setActiveStep(activeStep + 1)}>Continue <span>→</span></button> : <button type="button" onClick={() => save("submit")} disabled={busy !== null} className={styles.publishButton}>{busy === "submit" ? "Submitting…" : "Submit job"}</button>}</div></div>
        </section>

        <aside className={styles.sideColumn}>
          <section className={styles.uploadPanel}><div className={styles.sideHeading}><span className={styles.uploadIcon}>✦</span><div><h2>Upload a job description</h2><p>The AI agent will extract the details and fill the form.</p></div></div><input ref={fileInput} className={styles.hiddenInput} type="file" accept=".pdf,.docx,.txt" onChange={(event) => handleFile(event.target.files?.[0])} /><button type="button" className={styles.dropzone} onClick={() => fileInput.current?.click()} onDrop={(event) => { event.preventDefault(); handleFile(event.dataTransfer.files?.[0]); }} onDragOver={(event) => event.preventDefault()}><span className={styles.fileIcon}>AI</span><strong>{busy === "extract" ? "AI agent is analyzing…" : fileName || "Drop a file here or browse"}</strong><small>{fileName ? "The form will update automatically" : "PDF, DOCX or TXT · maximum 10 MB"}</small></button>{fileName && <button type="button" className={styles.extractButton} onClick={() => extractDocument()} disabled={busy !== null}>{busy === "extract" ? "Analyzing…" : "Run AI extraction again"}</button>}</section>
        </aside>
      </div>
    </div>
  );
}

function SectionHeading({ number, title, subtitle }: { number: string; title: string; subtitle: string }) { return <div className={styles.panelHeading}><div><span className={styles.sectionNumber}>{number}</span><div><h2>{title}</h2><p>{subtitle}</p></div></div><span className={styles.requiredNote}>* Required fields</span></div>; }
function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) { return <label className={full ? styles.fullField : undefined}><span>{label}</span>{children}</label>; }
