import { withConnection } from "./client";

type ReportFilters = { jobId?: number; department?: string; jobStatus?: string; candidateStatus?: string; minimumScore?: number; from?: string; to?: string };

function clauses(filters: ReportFilters, alias: "j" | "c") {
  const values: Record<string, string | number | Date> = {};
  const conditions: string[] = [];
  if (filters.jobId) { conditions.push(`${alias}.job_posting_id = :job_id`); values.job_id = filters.jobId; }
  if (alias === "j") {
    if (filters.department) { conditions.push("j.department = :department"); values.department = filters.department; }
    if (filters.jobStatus) { conditions.push("j.posting_status = :job_status"); values.job_status = filters.jobStatus; }
    if (filters.from) { conditions.push("j.created_at >= :date_from"); values.date_from = new Date(filters.from); }
    if (filters.to) { conditions.push("j.created_at < :date_to + 1"); values.date_to = new Date(filters.to); }
  } else {
    if (filters.candidateStatus) { conditions.push("c.application_status = :candidate_status"); values.candidate_status = filters.candidateStatus; }
    if (filters.minimumScore != null) { conditions.push("c.match_score >= :minimum_score"); values.minimum_score = filters.minimumScore; }
    if (filters.from) { conditions.push("c.applied_at >= :date_from"); values.date_from = new Date(filters.from); }
    if (filters.to) { conditions.push("c.applied_at < :date_to + 1"); values.date_to = new Date(filters.to); }
  }
  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", values };
}

function lower<T>(rows: unknown[] = []) {
  return rows.map((row) => Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([key, value]) => [key.toLowerCase(), value]))) as T[];
}

export async function getReports(filters: ReportFilters, highMatchThreshold: number) {
  return withConnection(async (connection, driver) => {
    const jobs = clauses(filters, "j");
    const candidates = clauses(filters, "c");
    const [jobSummary, candidateSummary, statuses, trend, jobRows, departments] = await Promise.all([
      connection.execute(`SELECT COUNT(*) total_jobs,
        SUM(CASE WHEN posting_status='DRAFT' THEN 1 ELSE 0 END) draft_jobs,
        SUM(CASE WHEN posting_status='PUBLISHED' THEN 1 ELSE 0 END) published_jobs,
        SUM(CASE WHEN posting_status='PUBLISH_FAILED' THEN 1 ELSE 0 END) failed_jobs
        FROM job_postings j ${jobs.where}`, jobs.values, { outFormat: driver.OUT_FORMAT_OBJECT }),
      connection.execute(`SELECT COUNT(*) total_applicants, ROUND(AVG(match_score),1) average_match_score,
        SUM(CASE WHEN match_score >= :high_match_threshold THEN 1 ELSE 0 END) high_match_candidates
        FROM job_candidates c ${candidates.where}`, { ...candidates.values, high_match_threshold: highMatchThreshold }, { outFormat: driver.OUT_FORMAT_OBJECT }),
      connection.execute(`SELECT NVL(application_status,'UNSET') label, COUNT(*) value FROM job_candidates c ${candidates.where}
        GROUP BY NVL(application_status,'UNSET') ORDER BY value DESC`, candidates.values, { outFormat: driver.OUT_FORMAT_OBJECT }),
      connection.execute(`SELECT TO_CHAR(TRUNC(applied_at), 'YYYY-MM-DD') label, COUNT(*) value FROM job_candidates c ${candidates.where}
        GROUP BY TRUNC(applied_at) ORDER BY TRUNC(applied_at)`, candidates.values, { outFormat: driver.OUT_FORMAT_OBJECT }),
      connection.execute(`SELECT j.job_posting_id, j.title, j.department, j.posting_status, j.required_skills,
        COUNT(c.job_candidate_id) applicant_count,
        SUM(CASE WHEN c.match_score >= :high_match_threshold THEN 1 ELSE 0 END) high_match_count,
        ROUND(AVG(c.match_score),1) average_score
        FROM job_postings j LEFT JOIN job_candidates c ON c.job_posting_id = j.job_posting_id
        ${jobs.where} GROUP BY j.job_posting_id, j.title, j.department, j.posting_status, j.required_skills
        ORDER BY MAX(j.created_at) DESC NULLS LAST`, { ...jobs.values, high_match_threshold: highMatchThreshold }, { outFormat: driver.OUT_FORMAT_OBJECT }),
      connection.execute(`SELECT DISTINCT department FROM job_postings WHERE department IS NOT NULL ORDER BY department`, {}, { outFormat: driver.OUT_FORMAT_OBJECT }),
    ]);
    const jobsList = lower<Record<string, unknown>>(jobRows.rows ?? []);
    const skillCounts = new Map<string, number>();
    for (const job of jobsList) {
      String(job.required_skills || "").split(/[,;\n|]/).map((skill) => skill.trim()).filter(Boolean).forEach((skill) => skillCounts.set(skill, (skillCounts.get(skill) || 0) + 1));
    }
    return {
      summary: { ...lower<Record<string, number>>(jobSummary.rows ?? [])[0], ...lower<Record<string, number>>(candidateSummary.rows ?? [])[0] },
      candidateStatuses: lower<{ label: string; value: number }>(statuses.rows ?? []),
      applicationsTrend: lower<{ label: string; value: number }>(trend.rows ?? []),
      jobs: jobsList,
      departments: lower<{ department: string }>(departments.rows ?? []).map((row) => row.department),
      topSkills: [...skillCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([label, value]) => ({ label, value })),
    };
  });
}
