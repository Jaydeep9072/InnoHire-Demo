import { NextRequest, NextResponse } from "next/server";
import { listOrdsCandidates, listOrdsJobOptions, listOrdsJobs, OrdsError } from "@/lib/ords/client";

export const runtime = "nodejs";

function csvValue(value: unknown) { return `"${String(value ?? "").replace(/"/g, '""')}"`; }
function withinDate(value: string | null, from?: string, to?: string) {
  if (!value) return !from && !to;
  const time = new Date(value).getTime();
  if (from && time < new Date(`${from}T00:00:00`).getTime()) return false;
  if (to && time > new Date(`${to}T23:59:59.999`).getTime()) return false;
  return true;
}

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams;
    const jobTitle = query.get("jobTitle") || undefined;
    const department = query.get("department") || undefined;
    const jobStatus = query.get("jobStatus") || undefined;
    const candidateStatus = query.get("candidateStatus") || undefined;
    const minimumScore = query.get("minimumScore") ? Number(query.get("minimumScore")) : undefined;
    const from = query.get("from") || undefined;
    const to = query.get("to") || undefined;
    const highMatchThreshold = Number(process.env.CANDIDATE_MATCH_THRESHOLD || 75);
    const [allJobs, allCandidates, jobOptions] = await Promise.all([listOrdsJobs(), listOrdsCandidates(), listOrdsJobOptions()]);
    const jobs = allJobs.filter((job) => (!jobTitle || job.title === jobTitle)
      && (!department || job.department === department)
      && (!jobStatus || job.posting_status === jobStatus)
      && withinDate(job.created_at, from, to));
    const jobIds = new Set(jobs.map((job) => job.job_posting_id));
    const candidates = allCandidates.filter((candidate) => jobIds.has(candidate.job_posting_id)
      && (!candidateStatus || candidate.application_status === candidateStatus)
      && (minimumScore == null || Number(candidate.match_score || 0) >= minimumScore)
      && withinDate(candidate.applied_at, from, to));
    const scored = candidates.filter((candidate) => candidate.match_score != null);
    const summary = {
      total_jobs: jobs.length,
      draft_jobs: jobs.filter((job) => job.posting_status === "DRAFT").length,
      published_jobs: jobs.filter((job) => job.posting_status === "PUBLISHED").length,
      failed_jobs: jobs.filter((job) => job.posting_status === "PUBLISH_FAILED").length,
      total_applicants: candidates.length,
      average_match_score: scored.length ? Math.round(scored.reduce((sum, candidate) => sum + Number(candidate.match_score), 0) / scored.length * 10) / 10 : null,
      high_match_candidates: candidates.filter((candidate) => Number(candidate.match_score || 0) >= highMatchThreshold).length,
    };
    const statusCounts = new Map<string, number>();
    const trendCounts = new Map<string, number>();
    for (const candidate of candidates) {
      const status = candidate.application_status || "UNSET";
      statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
      if (candidate.applied_at) {
        const day = new Date(candidate.applied_at).toISOString().slice(0, 10);
        trendCounts.set(day, (trendCounts.get(day) || 0) + 1);
      }
    }
    const reportJobs = jobs.map((job) => {
      const applicants = candidates.filter((candidate) => candidate.job_posting_id === job.job_posting_id);
      const applicantScores = applicants.filter((candidate) => candidate.match_score != null);
      return {
        ...job,
        applicant_count: applicants.length,
        high_match_count: applicants.filter((candidate) => Number(candidate.match_score || 0) >= highMatchThreshold).length,
        average_score: applicantScores.length ? Math.round(applicantScores.reduce((sum, candidate) => sum + Number(candidate.match_score), 0) / applicantScores.length * 10) / 10 : null,
      };
    });
    const skillCounts = new Map<string, number>();
    for (const job of jobs) String(job.required_skills || "").split(/[,;\n|]/).map((skill) => skill.trim()).filter(Boolean).forEach((skill) => skillCounts.set(skill, (skillCounts.get(skill) || 0) + 1));
    const reports = {
      configured: true,
      highMatchThreshold,
      summary,
      candidateStatuses: [...statusCounts].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value })),
      applicationsTrend: [...trendCounts].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, value })),
      jobs: reportJobs,
      jobTitles: [...new Set(jobOptions.map((job) => job.title).filter((title): title is string => Boolean(title)))],
      departments: [...new Set(allJobs.map((job) => job.department).filter((value): value is string => Boolean(value)))].sort(),
      topSkills: [...skillCounts].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([label, value]) => ({ label, value })),
    };
    if (query.get("format") === "csv") {
      const columns = ["Job ID", "Title", "Department", "Status", "Applicants", "High-match candidates", "Average score"];
      const rows = reportJobs.map((job) => [job.job_posting_id, job.title, job.department, job.posting_status, job.applicant_count, job.high_match_count, job.average_score]);
      const csv = [columns, ...rows].map((row) => row.map(csvValue).join(",")).join("\r\n");
      return new NextResponse(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=innohire-report.csv" } });
    }
    return NextResponse.json(reports);
  } catch (error) {
    if (error instanceof OrdsError) return NextResponse.json({ error: error.message, details: error.details }, { status: error.status });
    console.error("Reports failed", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: "Reports could not be loaded." }, { status: 500 });
  }
}
