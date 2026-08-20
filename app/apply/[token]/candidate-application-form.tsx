"use client";

import { useRef, useState } from "react";
import styles from "./application.module.css";

const maximumResumeBytes = 3 * 1024 * 1024;

type FormState = {
  fullName: string; emailAddress: string; phoneNumber: string; candidateLocation: string;
  currentCompany: string; currentPosition: string; yearsOfExperience: string; linkedinProfileUrl: string;
};

const initialForm: FormState = { fullName: "", emailAddress: "", phoneNumber: "", candidateLocation: "", currentCompany: "", currentPosition: "", yearsOfExperience: "", linkedinProfileUrl: "" };

export function CandidateApplicationForm({ token, jobTitle }: { token: string; jobTitle: string }) {
  const [form, setForm] = useState(initialForm);
  const [resume, setResume] = useState<{ fileName: string; base64: string } | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const applicationId = useRef(crypto.randomUUID());

  function update(key: keyof FormState, value: string) { setForm((current) => ({ ...current, [key]: value })); setMessage(null); }
  async function selectResume(file?: File) {
    setMessage(null);
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) { setResume(null); setMessage("Upload your résumé as a PDF file."); return; }
    if (file.size > maximumResumeBytes) { setResume(null); setMessage("The résumé must be 3 MB or smaller."); return; }
    const dataUrl = await readDataUrl(file);
    setResume({ fileName: file.name, base64: dataUrl.slice(dataUrl.indexOf(",") + 1) });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setMessage(null);
    if (!resume) { setMessage("Upload your résumé as a PDF file."); return; }
    if (!consent) { setMessage("Confirm that the information is accurate before submitting."); return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/applications/${encodeURIComponent(token)}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, yearsOfExperience: form.yearsOfExperience ? Number(form.yearsOfExperience) : undefined, externalApplicationId: applicationId.current, resumeFileName: resume.fileName, resumeMimeType: "application/pdf", resumeBase64: resume.base64, consent }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Your application could not be submitted.");
      setComplete(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Your application could not be submitted."); }
    finally { setBusy(false); }
  }

  if (complete) return <section className={styles.applicationCard}><div className={styles.successState}><span>✓</span><p>Application submitted</p><h2>Thank you for applying.</h2><div>Your application for {jobTitle} has been sent to the hiring team.</div></div></section>;

  return <form className={styles.applicationCard} onSubmit={submit}>
    <div className={styles.formHeading}><p>Application form</p><h2>Tell us about yourself</h2><span>Fields marked with * are required.</span></div>
    <div className={styles.formGrid}>
      <Field label="Full name *" full><input required autoComplete="name" value={form.fullName} onChange={(event) => update("fullName", event.target.value)} /></Field>
      <Field label="Email address *"><input required type="email" autoComplete="email" value={form.emailAddress} onChange={(event) => update("emailAddress", event.target.value)} /></Field>
      <Field label="Phone number *"><input required type="tel" autoComplete="tel" value={form.phoneNumber} onChange={(event) => update("phoneNumber", event.target.value)} /></Field>
      <Field label="Current location *"><input required autoComplete="address-level2" value={form.candidateLocation} onChange={(event) => update("candidateLocation", event.target.value)} /></Field>
      <Field label="LinkedIn profile"><input type="url" placeholder="https://linkedin.com/in/..." value={form.linkedinProfileUrl} onChange={(event) => update("linkedinProfileUrl", event.target.value)} /></Field>
      <Field label="Current company"><input value={form.currentCompany} onChange={(event) => update("currentCompany", event.target.value)} /></Field>
      <Field label="Current position"><input value={form.currentPosition} onChange={(event) => update("currentPosition", event.target.value)} /></Field>
      <Field label="Years of experience"><input min="0" max="80" step="0.5" type="number" value={form.yearsOfExperience} onChange={(event) => update("yearsOfExperience", event.target.value)} /></Field>
      <Field label="Résumé (PDF) *" full><label className={styles.resumeUpload}><input required type="file" accept="application/pdf,.pdf" onChange={(event) => void selectResume(event.target.files?.[0])} /><span>{resume ? "PDF" : "↑"}</span><div><strong>{resume?.fileName || "Choose your résumé"}</strong><small>PDF only · maximum 3 MB</small></div><b>{resume ? "Replace" : "Browse"}</b></label></Field>
    </div>
    <label className={styles.consent}><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I confirm that the information provided is accurate and may be used to process this application.</span></label>
    {message && <div role="alert" className={styles.formError}>{message}</div>}
    <div className={styles.formFooter}><p>Your résumé is securely submitted to the hiring team.</p><button type="submit" disabled={busy}>{busy ? "Submitting…" : "Submit application"}</button></div>
  </form>;
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) { return <label className={full ? styles.fullField : undefined}><span>{label}</span>{children}</label>; }
function readDataUrl(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("The résumé could not be read.")); reader.readAsDataURL(file); }); }
