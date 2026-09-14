"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { Candidate } from "@/types/domain";
import { screeningCategories, type ScreeningSession } from "@/lib/screening/schema";
import { canReuploadRecording } from "@/lib/screening/recording";
import styles from "./screening-dialog.module.css";

type Props = {
  candidate: Candidate;
  session: ScreeningSession;
  onClose: () => void;
  onRetry: () => void;
  onAnswer: (questionId: string, value: string) => void;
  onRecordingSelected: (file: File) => void;
  onSave: () => void;
  onAnalyze: () => void;
};

export function ScreeningDialog({ candidate, session, onClose, onRetry, onAnswer, onRecordingSelected, onSave, onAnalyze }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const recordingInput = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState("All questions");
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const busy = Boolean(session.busy);
  const recordingCanBeReuploaded = canReuploadRecording(session.recording || null);
  const recordingActive = Boolean(session.recording && !recordingCanBeReuploaded);


  function chooseRecording(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    setRecordingError(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".m4a")) {
      setRecordingError("Only M4A call recordings can be selected.");
      event.currentTarget.value = "";
      return;
    }
    onRecordingSelected(file);
    event.currentTarget.value = "";
  }
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  const answered = session.questions.filter((question) => session.answers[question.id]?.trim()).length;
  const answerAnalyses = useMemo(() => new Map(session.analysis?.responseAnalyses.map((item) => [item.questionId, item])), [session.analysis]);

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="screening-title" onCancel={(event) => { if (busy) event.preventDefault(); else onClose(); }}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>Candidate screening</p><h2 id="screening-title">Screening question bank</h2><p>{candidate.full_name || "Candidate"} - {candidate.job_title || `Job ${candidate.job_posting_id}`}</p></div>
      <button type="button" className={styles.close} aria-label="Close screening" onClick={onClose} disabled={busy}>X</button>
    </header>

    <div className={styles.content} aria-busy={session.loading || busy}>
      {session.loading ? <div className={styles.state} role="status"><span className={styles.spinner} aria-hidden="true" /><h3>Preparing screening questions</h3><p>Reading the resume and job requirements to create a concise 10-15 minute screening. This may take a minute.</p></div>
        : session.error ? <div className={styles.state}><h3>Questions are unavailable</h3><p role="alert">{session.error}</p><button type="button" className={styles.primary} onClick={onRetry}>Try again</button></div>
        : <>
          <div className={styles.toolbar}>
            <div><span className={styles.badge}>AI generated</span><span role="status">{answered} of {session.questions.length} answered</span></div>
            <p>Answers and analysis are stored as a candidate screening record.</p>
          </div>

          <section className={styles.recordingUpload} aria-labelledby="call-recording-title">
            <div className={styles.recordingInfo}>
              <strong id="call-recording-title">Call recording</strong>
              <span>M4A files only, up to 100 MB. The private recording is transcribed asynchronously by OCI Speech.</span>
              {recordingError && <span className={styles.recordingError} role="alert">{recordingError}</span>}
            </div>
            <div className={styles.recordingControls}>
              <button type="button" className={styles.recordingButton} onClick={() => recordingInput.current?.click()} disabled={busy || recordingActive || !session.screeningId}>{session.busy === "uploading" ? "Uploading..." : recordingCanBeReuploaded ? "Reupload call recording" : "Upload call recording"}</button>
              <input ref={recordingInput} className={styles.fileInput} type="file" accept=".m4a" onChange={chooseRecording} disabled={busy || recordingActive || !session.screeningId} tabIndex={-1} />
              {session.callRecordingName && <span className={styles.recordingName} role="status" title={session.callRecordingName}>{session.callRecordingName}</span>}
            </div>
          </section>

          {session.recording && <section className={styles.recordingStatus} aria-labelledby="recording-status-title">
            <div className={styles.recordingStatusHeader}>
              <div><p className={styles.eyebrow}>OCI Speech job status</p><h3 id="recording-status-title">{(session.recording.stage === "FAILED" ? "FAILED" : session.recording.speechLifecycleState || session.recording.stage).replaceAll("_", " ").toLowerCase()}</h3>{session.recording.transcriptionJobId && <small>Job ID: {session.recording.transcriptionJobId}</small>}</div>
              {session.recording.percentComplete != null && <strong>{Math.round(session.recording.percentComplete)}%</strong>}
            </div>
            {session.recording.percentComplete != null && <div className={styles.recordingProgress} aria-label={`Transcription ${Math.round(session.recording.percentComplete)} percent complete`}><span style={{ width: `${session.recording.percentComplete}%` }} /></div>}
            {session.recording.error && <p className={styles.recordingFailure} role="alert">{session.recording.error.message}{session.recording.error.retryable ? " The worker will retry automatically." : " Upload the M4A recording again to retry."}</p>}
            {session.recording.transcript && <details className={styles.transcript}><summary>Review transcript ({session.recording.transcript.segments.length} segments)</summary><div>{session.recording.transcript.segments.map((segment) => {
              const role = segment.role === "INTERVIEWER" ? "Speaker 1 (Interviewer)" : segment.role === "APPLICANT" ? "Speaker 2 (Applicant)" : segment.speakerId;
              return <p key={segment.id}><span>{role} - {Math.floor(segment.startMs / 60000)}:{String(Math.floor(segment.startMs / 1000) % 60).padStart(2, "0")}</span>{segment.text}</p>;
            })}</div></details>}
            {session.recording.assessment && <div className={styles.recordingAssessment}>
              <div className={styles.recordingAssessmentSummary}><strong>{session.recording.assessment.overallMatchPercentage == null ? "Needs review" : `${session.recording.assessment.overallMatchPercentage}% screening match`}</strong><span>{session.recording.assessment.coveragePercentage}% rubric coverage</span></div>
              <p>{session.recording.assessment.summary}</p>
              <div className={styles.recordingParameters}>{session.recording.assessment.parameterAssessments.map((item) => <div key={item.parameter}><span>{item.parameter}</span><strong>{item.score == null ? "Insufficient evidence" : `${item.score}%`}</strong><p>{item.rationale}</p></div>)}</div>
            </div>}
          </section>}

          {session.message && <div className={session.message.type === "success" ? styles.success : styles.error} role="status">{session.message.text}</div>}

          {session.analysis && <section className={styles.results} aria-labelledby="analysis-title">
            <div className={styles.resultHeader}>
              <div className={styles.score}><strong>{session.analysis.overallMatchPercentage}%</strong><span>Screening match</span></div>
              <div><p className={styles.eyebrow}>AI answer analysis</p><h3 id="analysis-title">Candidate evaluation</h3><p>{session.analysis.summary}</p><p className={styles.confidence}>AI analysis confidence: {Math.round(session.analysis.confidencePercentage)}%</p></div>
            </div>
            <div className={styles.parameters}>
              {session.analysis.parameterScores.map((item) => <article key={item.parameter}><div><strong>{item.parameter}</strong><span>{item.score}%</span></div><div className={styles.meter}><span style={{ width: `${item.score}%` }} /></div><p>{item.rationale}</p></article>)}
            </div>
            <div className={styles.findings}>
              <div><h4>Strengths</h4>{session.analysis.strengths.length ? <ul>{session.analysis.strengths.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No clear strengths were identified.</p>}</div>
              <div><h4>Development areas</h4>{session.analysis.developmentAreas.length ? <ul>{session.analysis.developmentAreas.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No development areas were identified.</p>}</div>
              <div><h4>Review flags</h4>{session.analysis.riskFlags.length ? <ul>{session.analysis.riskFlags.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No answer-related flags were identified.</p>}</div>
            </div>
          </section>}

          <p className={styles.help}>Capture specific examples, the candidate&apos;s actions, and the outcome. Unanswered questions are treated as insufficient evidence.</p>
          <div className={styles.filters} role="group" aria-label="Filter screening questions">
            {["All questions", ...screeningCategories].map((category) => <button type="button" key={category} aria-pressed={filter === category} onClick={() => setFilter(category)}>{category} <span>{category === "All questions" ? session.questions.length : session.questions.filter((question) => question.category === category).length}</span></button>)}
          </div>

          <div className={styles.questions}>
            {session.questions.map((question, index) => {
              const answerAnalysis = answerAnalyses.get(question.id);
              return (filter === "All questions" || filter === question.category) && <section className={styles.question} key={question.id}>
                <div className={styles.questionMeta}><span>Question {index + 1} - {question.category}</span>{session.answers[question.id]?.trim() && <span>Answered</span>}</div>
                <h3 id={`${question.id}-label`}>{question.question}</h3>
                <p className={styles.context}>{question.context}</p>
                <label htmlFor={`${question.id}-answer`}>Answer</label>
                <textarea id={`${question.id}-answer`} aria-describedby={`${question.id}-label`} rows={5} maxLength={10000} value={session.answers[question.id] || ""} onChange={(event) => onAnswer(question.id, event.target.value)} placeholder="Write the candidate's answer here..." disabled={busy} />
                {answerAnalysis && <div className={styles.answerAnalysis}><div><strong>Answer analysis</strong><span>{answerAnalysis.score}%</span></div><p>{answerAnalysis.analysis}</p><small>Evidence: {answerAnalysis.evidence}</small></div>}
              </section>;
            })}
          </div>
        </>}
    </div>

    {!session.loading && !session.error && <footer className={styles.footer}>
      <p>{answered === 0 ? "Add at least one answer to start analysis." : `${answered} of ${session.questions.length} answers will be analyzed. Unanswered questions will be marked as insufficient evidence.`}</p>
      <div>
        <button type="button" className={styles.secondary} onClick={onSave} disabled={busy || answered === 0}>{session.busy === "saving" ? "Saving..." : "Save draft"}</button>
        <button type="button" className={styles.primary} onClick={onAnalyze} disabled={busy || answered === 0}>{session.busy === "analyzing" ? "Analyzing answers..." : session.analysis ? "Analyze again" : "Save & analyze answers"}</button>
      </div>
    </footer>}
  </dialog>;
}
