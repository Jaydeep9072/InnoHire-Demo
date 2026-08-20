"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./reports-dashboard.module.css";

type DataPoint = { label: string; value: number };
type ReportJob = { job_posting_id: number; title: string | null; department: string | null; posting_status: string | null; applicant_count: number; high_match_count: number; average_score: number | null };
type ReportData = {
  configured: boolean; error?: string; highMatchThreshold: number; jobs: ReportJob[]; jobTitles: string[]; departments: string[];
  summary: Record<string, number | null>; candidateStatuses: DataPoint[]; applicationsTrend: DataPoint[];
  topSkills: DataPoint[];
};

export function ReportsDashboard() {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ jobTitle: "", department: "", jobStatus: "", candidateStatus: "", minimumScore: "", from: "", to: "" });
  const setFilter = (name: keyof typeof filters, value: string) => setFilters((current) => ({ ...current, [name]: value }));
  const params = useMemo(() => { const query = new URLSearchParams(); Object.entries(filters).forEach(([key, value]) => value && query.set(key, value)); return query; }, [filters]);
  const load = useCallback(async () => {
    setLoading(true);
    try { const response = await fetch(`/api/reports?${params}`); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Reports could not be loaded."); setData(payload); }
    catch (error) { setData({ configured: true, error: error instanceof Error ? error.message : "Reports could not be loaded.", highMatchThreshold: 75, jobs: [], jobTitles: [], departments: [], summary: {}, candidateStatuses: [], applicationsTrend: [], topSkills: [] } as unknown as ReportData); }
    finally { setLoading(false); }
  }, [params]);
  useEffect(() => { const timer = setTimeout(load, 200); return () => clearTimeout(timer); }, [load]);

  const summary = data?.summary || {};
  const maxTrend = Math.max(1, ...(data?.applicationsTrend || []).map((item) => item.value));
  const statusTotal = (data?.candidateStatuses || []).reduce((total, item) => total + item.value, 0);
  const statusGradient = useMemo(() => {
    const colors = ["#0f766e", "#159b8e", "#76cfc1", "#c8ebe4", "#d97706"];
    return (data?.candidateStatuses || []).map((item, index, items) => {
      const start = items.slice(0, index).reduce((total, current) => total + current.value, 0) / Math.max(statusTotal, 1) * 100;
      const end = start + item.value / Math.max(statusTotal, 1) * 100;
      return `${colors[index % colors.length]} ${start}% ${end}%`;
    }).join(",");
  }, [data, statusTotal]);

  const exportCsv = () => { const exportParams = new URLSearchParams(params); exportParams.set("format", "csv"); window.location.href = `/api/reports?${exportParams}`; };

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}><div><p className={styles.eyebrow}>Talent analytics</p><h1>Recruitment reports</h1><p>Measure job activity, applicant quality, and pipeline outcomes from live hiring data.</p></div><button type="button" className={styles.exportButton} onClick={exportCsv} disabled={!data?.configured}>Export CSV <span>↓</span></button></header>

      <section className={styles.filterBar}>
        <label><span>Date from</span><input type="date" value={filters.from} onChange={(event) => setFilter("from", event.target.value)} /></label>
        <label><span>Date to</span><input type="date" value={filters.to} onChange={(event) => setFilter("to", event.target.value)} /></label>
        <label><span>Job</span><select value={filters.jobTitle} onChange={(event) => setFilter("jobTitle", event.target.value)}><option value="">All jobs</option>{data?.jobTitles?.map((title) => <option value={title} key={title}>{title}</option>)}</select></label>
        <label><span>Department</span><select value={filters.department} onChange={(event) => setFilter("department", event.target.value)}><option value="">All departments</option>{data?.departments?.map((department) => <option key={department}>{department}</option>)}</select></label>
        <label><span>Job status</span><select value={filters.jobStatus} onChange={(event) => setFilter("jobStatus", event.target.value)}><option value="">All statuses</option><option>DRAFT</option><option>PUBLISHING</option><option>PUBLISHED</option><option>CLOSED</option><option>PUBLISH_FAILED</option></select></label>
        <label><span>Candidate status</span><select value={filters.candidateStatus} onChange={(event) => setFilter("candidateStatus", event.target.value)}><option value="">All stages</option><option>APPLIED</option><option>AI_SCREENING</option><option>SHORTLISTED</option><option>TECHNICAL_INTERVIEW</option><option>HIRING_MANAGER</option><option>OFFER</option><option>HIRED</option><option>REJECTED</option></select></label>
        <label><span>Minimum match</span><select value={filters.minimumScore} onChange={(event) => setFilter("minimumScore", event.target.value)}><option value="">Any score</option><option value="60">60% or higher</option><option value="70">70% or higher</option><option value="75">75% or higher</option><option value="80">80% or higher</option><option value="90">90% or higher</option></select></label>
        <button type="button" className={styles.clearButton} onClick={() => setFilters({ jobTitle: "", department: "", jobStatus: "", candidateStatus: "", minimumScore: "", from: "", to: "" })}>Clear</button>
      </section>

      {!loading && data && !data.configured ? <section className={styles.configurationState}><span>DB</span><h2>Connect ORDS to generate reports</h2><p>Reports are calculated from real job and candidate records. Add the ORDS base URL to begin.</p></section> : data?.error ? <section className={styles.errorState}>{data.error}</section> : <>
        <section className={styles.summaryGrid} aria-label="Report summary">
          <MetricCard label="Total jobs" value={summary.total_jobs} detail={`${summary.published_jobs || 0} published`} tone="teal" loading={loading} />
          <MetricCard label="Total applicants" value={summary.total_applicants} detail="Across filtered jobs" tone="blue" loading={loading} />
          <MetricCard label="High-match candidates" value={summary.high_match_candidates} detail={`${data?.highMatchThreshold || 75}% threshold`} tone="mint" loading={loading} />
          <MetricCard label="Average match score" value={summary.average_match_score == null ? null : `${summary.average_match_score}%`} detail="Scored applicants" tone="amber" loading={loading} />
          <MetricCard label="Publishing failures" value={summary.failed_jobs} detail="Needs attention" tone="red" loading={loading} />
        </section>

        <div className={styles.analyticsGrid}>
          <section className={styles.trendPanel}><PanelHeading title="Applications over time" subtitle="Applications received within the selected date range" />
            {!data?.applicationsTrend?.length ? <EmptyChart text="No application activity in this range." /> : <div className={styles.barChart}>{data.applicationsTrend.map((item) => <div className={styles.barGroup} key={item.label}><span className={styles.barValue}>{item.value}</span><div className={styles.barTrack}><span style={{ height: `${Math.max(8, item.value / maxTrend * 100)}%` }} /></div><small>{new Date(`${item.label}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small></div>)}</div>}
          </section>
          <section className={styles.statusPanel}><PanelHeading title="Candidate status" subtitle="Current applicant pipeline distribution" />
            {!data?.candidateStatuses?.length ? <EmptyChart text="No candidate statuses to report." /> : <div className={styles.donutLayout}><div className={styles.donut} style={{ background: `conic-gradient(${statusGradient})` }}><div><strong>{statusTotal}</strong><span>Applicants</span></div></div><ul>{data.candidateStatuses.map((item, index) => <li key={item.label}><span style={{ background: ["#0f766e", "#159b8e", "#76cfc1", "#c8ebe4", "#d97706"][index % 5] }} /><div><strong>{item.label}</strong><small>{item.value} · {Math.round(item.value / statusTotal * 100)}%</small></div></li>)}</ul></div>}
          </section>
          <section className={styles.skillsPanel}><PanelHeading title="Top required skills" subtitle="Most frequent requirements across filtered jobs" />
            {!data?.topSkills?.length ? <EmptyChart text="No required skills to report." /> : <div className={styles.skillBars}>{data.topSkills.map((item) => <div key={item.label}><span>{item.label}</span><div><i style={{ width: `${item.value / Math.max(...data.topSkills.map((skill) => skill.value)) * 100}%` }} /></div><strong>{item.value}</strong></div>)}</div>}
          </section>
        </div>

        <section className={styles.tablePanel}><PanelHeading title="Job performance" subtitle="Applicant volume and match quality by role" />
          <div className={styles.tableWrap}><table><thead><tr><th>Job</th><th>Department</th><th>Status</th><th>Applicants</th><th>High match</th><th>Avg. score</th></tr></thead><tbody>{(data?.jobs || []).map((job) => <tr key={job.job_posting_id}><td><strong>{job.title || `Job ${job.job_posting_id}`}</strong><small>#{job.job_posting_id}</small></td><td>{job.department || "—"}</td><td><span className={styles.statusPill}>{job.posting_status || "UNSET"}</span></td><td>{job.applicant_count || 0}</td><td>{job.high_match_count || 0}</td><td>{job.average_score == null ? "—" : `${job.average_score}%`}</td></tr>)}</tbody></table>{!data?.jobs?.length && <div className={styles.tableEmpty}>No jobs match the selected filters.</div>}</div>
        </section>
      </>}
    </div>
  );
}

function MetricCard({ label, value, detail, tone, loading }: { label: string; value: string | number | null | undefined; detail: string; tone: string; loading: boolean }) { return <article className={`${styles.metricCard} ${styles[tone]}`}><span>{label}</span>{loading ? <i className={styles.metricLoading} /> : <strong>{value ?? 0}</strong>}<small>{detail}</small></article>; }
function PanelHeading({ title, subtitle }: { title: string; subtitle: string }) { return <header className={styles.panelHeading}><div><h2>{title}</h2><p>{subtitle}</p></div><span>Live data</span></header>; }
function EmptyChart({ text }: { text: string }) { return <div className={styles.emptyChart}><span>↗</span><p>{text}</p></div>; }
