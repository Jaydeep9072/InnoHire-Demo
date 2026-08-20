"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Candidate, JobOption } from "@/types/domain";
import styles from "./candidate-pipeline.module.css";

type ApiData = { configured: boolean; candidates: Candidate[]; jobs: JobOption[]; error?: string };
const stages = ["APPLIED", "SCREENED", "SHORTLISTED", "INTERVIEW", "OFFER", "HIRED", "REJECTED"];
const stageLabels: Record<string, string> = { APPLIED: "Applied", SCREENED: "AI screened", SHORTLISTED: "Shortlisted", INTERVIEW: "Interview", OFFER: "Offer", HIRED: "Hired", REJECTED: "Rejected" };
const splitLines = (value: string | null) => (value || "").split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
const initials = (name: string | null) => (name || "?").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

export function CandidatePipeline() {
  const [data, setData] = useState<ApiData | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [jobTitle, setJobTitle] = useState("");
  const [search, setSearch] = useState("");
  const [minimumScore, setMinimumScore] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [schedule, setSchedule] = useState({ provider: "google", date: "", time: "" });
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [scheduleMessage, setScheduleMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectBusy, setRejectBusy] = useState(false);
  const [candidateMessage, setCandidateMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (jobTitle) params.set("jobTitle", jobTitle);
    if (search) params.set("search", search);
    if (minimumScore) params.set("minimumScore", minimumScore);
    if (status) params.set("status", status);
    try {
      const response = await fetch(`/api/candidates?${params}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Candidates could not be loaded.");
      setData(payload);
      setSelectedId((current) => payload.candidates.some((candidate: Candidate) => candidate.job_candidate_id === current) ? current : payload.candidates[0]?.job_candidate_id ?? null);
    } catch (error) { setData({ configured: true, candidates: [], jobs: [], error: error instanceof Error ? error.message : "Candidates could not be loaded." }); }
    finally { setLoading(false); }
  }, [jobTitle, search, minimumScore, status]);

  useEffect(() => { const timer = setTimeout(load, 250); return () => clearTimeout(timer); }, [load]);
  const selected = data?.candidates.find((candidate) => candidate.job_candidate_id === selectedId) ?? null;
  const stageCounts = useMemo(() => Object.fromEntries(stages.map((stage) => [stage, data?.candidates.filter((candidate) => (candidate.application_status || "APPLIED").toUpperCase() === stage).length || 0])), [data]);

  async function submitInterview() {
    if (!selected?.email_address) { setScheduleMessage({ type: "error", text: "Add the candidate email address before scheduling an interview." }); return; }
    if (!schedule.date || !schedule.time) { setScheduleMessage({ type: "error", text: "Select both the interview date and time." }); return; }
    setScheduleBusy(true); setScheduleMessage(null);
    try {
      const response = await fetch("/api/interviews", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: schedule.provider,
          candidateName: selected.full_name || "Candidate",
          candidateEmail: selected.email_address,
          jobTitle: selected.job_title || `Job ${selected.job_posting_id}`,
          startAt: new Date(`${schedule.date}T${schedule.time}`).toISOString(),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The interview could not be scheduled.");
      setScheduleMessage({ type: "success", text: `Interview invitation sent to ${selected.email_address}.` });
    } catch (error) { setScheduleMessage({ type: "error", text: error instanceof Error ? error.message : "The interview could not be scheduled." }); }
    finally { setScheduleBusy(false); }
  }

  async function rejectCandidate() {
    if (!selected) return;
    setRejectBusy(true); setCandidateMessage(null);
    try {
      const response = await fetch("/api/candidates", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ candidateId: selected.job_candidate_id, status: "REJECTED" }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The candidate could not be rejected.");
      setRejectOpen(false);
      setCandidateMessage({ type: "success", text: payload.message || "Candidate rejected successfully." });
      await load();
    } catch (error) { setCandidateMessage({ type: "error", text: error instanceof Error ? error.message : "The candidate could not be rejected." }); }
    finally { setRejectBusy(false); }
  }

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div><p className={styles.eyebrow}>Candidate intelligence</p><h1>Candidate pipeline</h1><p>Prioritize applicants using evidence from their experience and the job requirements.</p></div>
        <div className={styles.headerControls}>
          <select aria-label="Select job" value={jobTitle} onChange={(event) => setJobTitle(event.target.value)}><option value="">All jobs</option>{data?.jobs.map((job) => <option value={job.title || ""} key={job.title || job.job_posting_id}>{job.title || `Job ${job.job_posting_id}`}</option>)}</select>
          <span className={styles.applicantCount}>{data?.candidates.length || 0} applicants</span>
        </div>
      </header>

      <section className={styles.stageTracker} aria-label="Recruitment stages">
        {stages.map((stage, index) => <div key={stage} className={index === 0 ? styles.stageActive : styles.stage}><span>{stageLabels[stage]}</span><strong>{stageCounts[stage]}</strong></div>)}
      </section>

      {!loading && data && !data.configured ? (
        <section className={styles.configurationState}><span>DB</span><h2>Connect ORDS to view candidates</h2><p>Add the ORDS base URL to the environment. Real candidate applications will appear here after they are ingested.</p></section>
      ) : (
        <div className={styles.operationalGrid}>
          <section className={styles.candidatePanel}>
            <div className={styles.panelTitle}><div><h2>Applicants</h2><p>Ranked by job match</p></div><span>{data?.candidates.length || 0}</span></div>
            <div className={styles.filters}>
              <input aria-label="Search candidates" placeholder="Search name, email or skill" value={search} onChange={(event) => setSearch(event.target.value)} />
              <div><select aria-label="Minimum match score" value={minimumScore} onChange={(event) => setMinimumScore(event.target.value)}><option value="">Any score</option><option value="90">90%+</option><option value="75">75%+</option><option value="50">50%+</option></select><select aria-label="Candidate status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All stages</option>{stages.map((stage) => <option key={stage} value={stage}>{stageLabels[stage]}</option>)}</select></div>
            </div>
            <div className={styles.candidateList}>
              {loading ? <div className={styles.loadingState}><span /><span /><span /></div> : data?.error ? <div className={styles.inlineError}>{data.error}</div> : !data?.candidates.length ? <div className={styles.emptyList}><strong>No candidates found</strong><p>Applicants will appear after real candidate data is ingested.</p></div> : data.candidates.map((candidate) => (
                <button type="button" key={candidate.job_candidate_id} className={candidate.job_candidate_id === selectedId ? styles.candidateActive : styles.candidate} onClick={() => setSelectedId(candidate.job_candidate_id)}>
                  <span className={styles.avatar}>{initials(candidate.full_name)}</span><span className={styles.candidateIdentity}><strong>{candidate.full_name || "Unnamed candidate"}</strong><small>{candidate.headline || candidate.current_position || "Candidate profile"}</small></span><span className={styles.candidateScore}>{candidate.match_score == null ? "—" : `${candidate.match_score}%`}<small>match</small></span><span className={styles.chevron}>›</span>
                </button>
              ))}
            </div>
          </section>

          <section className={styles.profilePanel}>
            {!selected ? <div className={styles.panelEmpty}><span>◎</span><h2>Select a candidate</h2><p>Candidate profile, match evidence, and experience will appear here.</p></div> : <>
              <div className={styles.profileHeader}><div className={styles.profileAvatar}>{initials(selected.full_name)}</div><div><span className={styles.statusBadge}>{stageLabels[(selected.application_status || "APPLIED").toUpperCase()] || selected.application_status}</span><h2>{selected.full_name}</h2><p>{selected.headline || selected.current_position || "Candidate profile"}</p></div><div className={styles.scoreRing} style={{ "--score": selected.match_score || 0 } as React.CSSProperties}><div><strong>{selected.match_score ?? "—"}</strong><span>% match</span></div></div></div>
              <div className={styles.profileActions}><button type="button" className={styles.aiScreeningButton}>AI Screening</button><button type="button" className={styles.scheduleButton} onClick={() => { setScheduleOpen(true); setScheduleMessage(null); }}>Schedule an interview</button><button type="button" className={styles.rejectButton} onClick={() => { setRejectOpen(true); setCandidateMessage(null); }} disabled={(selected.application_status || "").toUpperCase() === "REJECTED"}>{(selected.application_status || "").toUpperCase() === "REJECTED" ? "Rejected" : "Reject candidate"}</button></div>
              {candidateMessage && <div role="status" className={candidateMessage.type === "success" ? styles.candidateSuccess : styles.candidateError}>{candidateMessage.text}</div>}
              <section className={styles.matchSummary}><span>✦</span><div><strong>Match summary</strong><p>{selected.match_summary || "A match summary has not been generated for this applicant."}</p></div></section>
              <div className={styles.infoGrid}><div><span>Current position</span><strong>{selected.current_position || "Not provided"}</strong></div><div><span>Current company</span><strong>{selected.current_company || "Not provided"}</strong></div><div><span>Experience</span><strong>{selected.years_of_experience == null ? "Not provided" : `${selected.years_of_experience} years`}</strong></div><div><span>Location</span><strong>{selected.candidate_location || "Not provided"}</strong></div></div>
              <section className={styles.contactSection}><h3>Contact and application</h3><dl><div><dt>Email</dt><dd>{selected.email_address || "Not provided"}</dd></div><div><dt>Phone</dt><dd>{selected.phone_number || "Not provided"}</dd></div><div><dt>Applied</dt><dd>{selected.applied_at ? new Date(selected.applied_at).toLocaleDateString() : "Not provided"}</dd></div><div><dt>Job</dt><dd>{selected.job_title || `Job ${selected.job_posting_id}`}</dd></div><div><dt>Résumé</dt><dd><a className={styles.resumeLink} href={`/api/candidates/${selected.job_candidate_id}/resume`} target="_blank" rel="noreferrer">View PDF résumé</a></dd></div></dl></section>
            </>}
          </section>

          <aside className={styles.evidenceColumn}>
            <section className={styles.evidencePanel}><div className={styles.panelTitle}><div><h2>Evidence</h2><p>Grounded in candidate data</p></div><span className={styles.autoBadge}>Auto-scored</span></div>
              {!selected ? <div className={styles.smallEmpty}>Select a candidate to review evidence.</div> : <div className={styles.evidenceList}>
                <div className={styles.evidenceBlock}><div className={styles.evidenceHeading}><span className={styles.successIcon}>✓</span><strong>Matching skills</strong></div>{splitLines(selected.matching_skills).length ? <ul>{splitLines(selected.matching_skills).map((skill) => <li key={skill}>{skill}</li>)}</ul> : <p>No matching skills were recorded.</p>}</div>
                <div className={styles.evidenceBlock}><div className={styles.evidenceHeading}><span className={styles.warningIcon}>!</span><strong>Missing required skills</strong></div>{splitLines(selected.missing_skills).length ? <ul>{splitLines(selected.missing_skills).map((skill) => <li key={skill}>{skill}</li>)}</ul> : <p>No required skill gaps were recorded.</p>}</div>
                <div className={styles.evidenceBlock}><div className={styles.evidenceHeading}><span className={styles.neutralIcon}>+</span><strong>Strengths</strong></div>{splitLines(selected.match_strengths).length ? <ul>{splitLines(selected.match_strengths).map((item) => <li key={item}>{item}</li>)}</ul> : <p>No strengths were recorded.</p>}</div>
                <div className={styles.evidenceBlock}><div className={styles.evidenceHeading}><span className={styles.warningIcon}>!</span><strong>Concerns</strong></div>{splitLines(selected.match_concerns).length ? <ul>{splitLines(selected.match_concerns).map((item) => <li key={item}>{item}</li>)}</ul> : <p>No concerns were recorded.</p>}</div>
              </div>}
            </section>
            <section className={styles.responsibleAi}><span>i</span><div><strong>Responsible review</strong><p>Scores exclude protected characteristics and should support—not replace—human hiring decisions.</p></div></section>
          </aside>
        </div>
      )}
      {scheduleOpen && selected && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setScheduleOpen(false); }}>
        <section className={styles.scheduleModal} role="dialog" aria-modal="true" aria-labelledby="schedule-title">
          <header><div><p>Candidate interview</p><h2 id="schedule-title">Schedule an interview</h2></div><button type="button" aria-label="Close scheduling dialog" onClick={() => setScheduleOpen(false)}>×</button></header>
          <div className={styles.scheduleCandidate}><span className={styles.avatar}>{initials(selected.full_name)}</span><div><strong>{selected.full_name || "Unnamed candidate"}</strong><small>{selected.email_address || "Email address not provided"}</small></div></div>
          <fieldset className={styles.providerOptions}><legend>Meeting platform</legend>
            {[{ value: "google", label: "Google Meet" }, { value: "teams", label: "Microsoft Teams" }, { value: "zoom", label: "Zoom" }].map((provider) => <label key={provider.value} className={schedule.provider === provider.value ? styles.providerSelected : undefined}><input type="radio" name="provider" value={provider.value} checked={schedule.provider === provider.value} onChange={(event) => setSchedule((current) => ({ ...current, provider: event.target.value }))} /><span>{provider.label}</span></label>)}
          </fieldset>
          <div className={styles.scheduleFields}><label><span>Date</span><input type="date" value={schedule.date} min={new Date().toISOString().slice(0, 10)} onChange={(event) => setSchedule((current) => ({ ...current, date: event.target.value }))} /></label><label><span>Time</span><input type="time" value={schedule.time} onChange={(event) => setSchedule((current) => ({ ...current, time: event.target.value }))} /></label></div>
          {scheduleMessage && <div className={scheduleMessage.type === "success" ? styles.scheduleSuccess : styles.scheduleError}>{scheduleMessage.text}</div>}
          <footer><button type="button" className={styles.cancelButton} onClick={() => setScheduleOpen(false)}>Cancel</button><button type="button" className={styles.scheduleSubmit} onClick={submitInterview} disabled={scheduleBusy}>{scheduleBusy ? "Creating meeting…" : "Create meeting and send email"}</button></footer>
        </section>
      </div>}
      {rejectOpen && selected && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !rejectBusy) setRejectOpen(false); }}>
        <section className={styles.rejectModal} role="dialog" aria-modal="true" aria-labelledby="reject-title">
          <span className={styles.rejectIcon}>!</span>
          <h2 id="reject-title">Reject this candidate?</h2>
          <p><strong>{selected.full_name || "This candidate"}</strong> will move to the Rejected stage. Their information will remain available for reporting.</p>
          <footer><button type="button" className={styles.cancelButton} onClick={() => setRejectOpen(false)} disabled={rejectBusy}>Cancel</button><button type="button" className={styles.rejectSubmit} onClick={rejectCandidate} disabled={rejectBusy}>{rejectBusy ? "Rejecting…" : "Reject candidate"}</button></footer>
        </section>
      </div>}
    </div>
  );
}
