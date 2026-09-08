"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Candidate } from "@/types/domain";
import { screeningCategories, type ScreeningSession } from "@/lib/screening/schema";
import styles from "./screening-dialog.module.css";

type Props = {
  candidate: Candidate;
  session: ScreeningSession;
  onClose: () => void;
  onRetry: () => void;
  onAnswer: (questionId: string, value: string) => void;
  onSave: () => void;
  onAnalyze: () => void;
};

export function ScreeningDialog({ candidate, session, onClose, onRetry, onAnswer, onSave, onAnalyze }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [filter, setFilter] = useState("All questions");
  const busy = Boolean(session.busy);

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
      <div><p className={styles.eyebrow}>Candidate screening</p><h2 id="screening-title">Screening question bank</h2><p>{candidate.full_name || "Candidate"} · {candidate.job_title || `Job ${candidate.job_posting_id}`}</p></div>
      <button type="button" className={styles.close} aria-label="Close screening" onClick={onClose} disabled={busy}>×</button>
    </header>

    <div className={styles.content} aria-busy={session.loading || busy}>
      {session.loading ? <div className={styles.state} role="status"><span className={styles.spinner} aria-hidden="true" /><h3>Preparing screening questions</h3><p>Reading the resume and job requirements to create a concise 10-15 minute screening. This may take a minute.</p></div>
        : session.error ? <div className={styles.state}><h3>Questions are unavailable</h3><p role="alert">{session.error}</p><button type="button" className={styles.primary} onClick={onRetry}>Try again</button></div>
        : <>
          <div className={styles.toolbar}>
            <div><span className={styles.badge}>AI generated</span><span role="status">{answered} of {session.questions.length} answered</span></div>
            <p>Answers and analysis are stored as a candidate screening record.</p>
          </div>

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

          <p className={styles.help}>Capture specific examples, the candidate’s actions, and the outcome. All 14 answers are required for analysis.</p>
          <div className={styles.filters} role="group" aria-label="Filter screening questions">
            {["All questions", ...screeningCategories].map((category) => <button type="button" key={category} aria-pressed={filter === category} onClick={() => setFilter(category)}>{category} <span>{category === "All questions" ? session.questions.length : session.questions.filter((question) => question.category === category).length}</span></button>)}
          </div>

          <div className={styles.questions}>
            {session.questions.map((question, index) => {
              const answerAnalysis = answerAnalyses.get(question.id);
              return (filter === "All questions" || filter === question.category) && <section className={styles.question} key={question.id}>
                <div className={styles.questionMeta}><span>Question {index + 1} · {question.category}</span>{session.answers[question.id]?.trim() && <span>Answered</span>}</div>
                <h3 id={`${question.id}-label`}>{question.question}</h3>
                <p className={styles.context}>{question.context}</p>
                <label htmlFor={`${question.id}-answer`}>Answer</label>
                <textarea id={`${question.id}-answer`} aria-describedby={`${question.id}-label`} rows={5} maxLength={10000} value={session.answers[question.id] || ""} onChange={(event) => onAnswer(question.id, event.target.value)} placeholder="Write the candidate’s answer here…" disabled={busy} />
                {answerAnalysis && <div className={styles.answerAnalysis}><div><strong>Answer analysis</strong><span>{answerAnalysis.score}%</span></div><p>{answerAnalysis.analysis}</p><small>Evidence: {answerAnalysis.evidence}</small></div>}
              </section>;
            })}
          </div>
        </>}
    </div>

    {!session.loading && !session.error && <footer className={styles.footer}>
      <p>{answered < session.questions.length ? `${session.questions.length - answered} answer${session.questions.length - answered === 1 ? "" : "s"} remaining before AI analysis.` : "All answers are ready for AI analysis."}</p>
      <div>
        <button type="button" className={styles.secondary} onClick={onSave} disabled={busy || answered === 0}>{session.busy === "saving" ? "Saving…" : "Save draft"}</button>
        <button type="button" className={styles.primary} onClick={onAnalyze} disabled={busy || answered !== session.questions.length}>{session.busy === "analyzing" ? "Analyzing answers…" : session.analysis ? "Analyze again" : "Save & analyze answers"}</button>
      </div>
    </footer>}
  </dialog>;
}
