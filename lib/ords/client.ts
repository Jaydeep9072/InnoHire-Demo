import type { Candidate, JobInput, JobListItem, JobOption } from "@/types/domain";

const suppliedBaseUrl = "https://geab81ab04d531e-innovagedev.adb.me-dubai-1.oraclecloudapps.com/ords/inn_support_sys/innohire";

type OrdsCollection<T> = { items?: T[]; count?: number; hasMore?: boolean };

export type OrdsJob = JobListItem & {
  account_id: string | null;
  apply_url: string | null;
  job_description: string | null;
  responsibilities: string | null;
  required_skills: string | null;
  job_boards: string | null;
  minimum_experience: number | null;
  salary: number | null;
  currency: string | null;
  min_salary: number | null;
  max_salary: number | null;
  pay_frequency: string | null;
  seniority_level: string | null;
  source_file_name: string | null;
  source_file_type: string | null;
  publish_error: string | null;
  created_by: string | null;
  updated_at: string | null;
};

export class OrdsError extends Error {
  constructor(message: string, public status = 502, public details?: unknown) { super(message); }
}

export function getOrdsBaseUrl() {
  return (process.env.ORDS_BASE_URL || process.env.base_url || suppliedBaseUrl).replace(/\/$/, "");
}

async function requestOrds<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${getOrdsBaseUrl()}${path}`, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
      headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
    });
    const text = await response.text();
    let payload: unknown = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
    if (!response.ok) throw new OrdsError(`ORDS request failed with status ${response.status}.`, response.status, payload);
    return payload as T;
  } catch (error) {
    if (error instanceof OrdsError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new OrdsError("The ORDS request timed out.", 504);
    throw new OrdsError(error instanceof Error ? error.message : "ORDS could not be reached.");
  } finally { clearTimeout(timer); }
}

function nullableString(value: unknown) { return value == null ? null : String(value); }
function nullableNumber(value: unknown) { return value == null || value === "" ? null : Number(value); }

export async function listOrdsJobs(jobId?: number): Promise<OrdsJob[]> {
  const query = jobId ? `?job_posting_id=${encodeURIComponent(jobId)}` : "";
  const response = await requestOrds<OrdsCollection<Record<string, unknown>>>(`/jobs${query}`);
  const jobs = (response.items || []).map((row) => ({
    job_posting_id: Number(row.job_posting_id),
    external_job_id: nullableString(row.external_job_id),
    account_id: nullableString(row.account_id),
    apply_url: nullableString(row.apply_url),
    title: nullableString(row.title),
    department: nullableString(row.department),
    job_description: nullableString(row.job_description),
    responsibilities: nullableString(row.responsibilities),
    required_skills: nullableString(row.required_skills),
    job_boards: nullableString(row.job_boards ?? row.job_board),
    minimum_experience: nullableNumber(row.minimum_experience),
    salary: nullableNumber(row.salary),
    currency: nullableString(row.currency),
    min_salary: nullableNumber(row.min_salary),
    max_salary: nullableNumber(row.max_salary),
    pay_frequency: nullableString(row.pay_frequency),
    location: nullableString(row.location),
    workplace_type: nullableString(row.workplace_type),
    employment_type: nullableString(row.employment_type),
    seniority_level: nullableString(row.seniority_level),
    openings_count: nullableNumber(row.openings_count),
    closing_date: nullableString(row.closing_date),
    source_file_name: nullableString(row.source_file_name),
    source_file_type: nullableString(row.source_file_type),
    posting_status: nullableString(row.posting_status),
    publish_error: nullableString(row.publish_error),
    created_by: nullableString(row.created_by),
    created_at: nullableString(row.created_at),
    updated_at: nullableString(row.updated_at),
    published_at: nullableString(row.published_at),
    applicant_count: 0,
  }));
  return jobId ? jobs.filter((job) => job.job_posting_id === jobId) : jobs;
}

export async function listOrdsCandidates(): Promise<Candidate[]> {
  const response = await requestOrds<OrdsCollection<Record<string, unknown>>>("/candidate");
  return (response.items || []).map((row) => ({
    job_candidate_id: Number(row.job_candidate_id),
    job_posting_id: Number(row.job_posting_id),
    external_application_id: nullableString(row.external_application_id),
    full_name: nullableString(row.full_name),
    email_address: nullableString(row.email_address),
    phone_number: nullableString(row.phone_number),
    headline: nullableString(row.headline),
    candidate_location: nullableString(row.candidate_location),
    linkedin_profile_url: nullableString(row.linkedin_profile_url),
    resume_url: nullableString(row.resume_url),
    current_company: nullableString(row.current_company),
    current_position: nullableString(row.current_position),
    years_of_experience: nullableNumber(row.years_of_experience),
    application_status: nullableString(row.application_status),
    match_score: nullableNumber(row.match_score),
    matching_skills: nullableString(row.matching_skills),
    missing_skills: nullableString(row.missing_skills),
    relevant_experience: nullableString(row.relevant_experience),
    match_strengths: nullableString(row.match_strengths),
    match_concerns: nullableString(row.match_concerns),
    match_summary: nullableString(row.match_summary),
    applied_at: nullableString(row.applied_at),
    job_title: nullableString(row.job_title),
  }));
}

export async function listOrdsJobOptions(): Promise<JobOption[]> {
  const response = await requestOrds<OrdsCollection<{ title?: string | null }>>("/jobs_title_lov");
  return (response.items || []).filter((row) => row.title).map((row, index) => ({ job_posting_id: index + 1, title: row.title || null, posting_status: null }));
}

export function ordsJobToInput(job: OrdsJob): JobInput {
  return {
    localJobId: job.job_posting_id,
    title: job.title || "",
    department: job.department || "",
    jobDescription: job.job_description || "",
    responsibilities: job.responsibilities || "",
    requiredSkills: job.required_skills || "",
    preferredSkills: "",
    minimumExperience: job.minimum_experience || 0,
    salary: job.salary,
    currency: job.currency || "",
    minSalary: job.min_salary,
    maxSalary: job.max_salary,
    payFrequency: (job.pay_frequency === "YEARLY" || job.pay_frequency === "MONTHLY" || job.pay_frequency === "HOURLY") ? job.pay_frequency : "",
    location: job.location || "",
    workplaceType: job.workplace_type === "HYBRID" || job.workplace_type === "REMOTE" ? job.workplace_type : "ON_SITE",
    employmentType: (["FULL_TIME", "PART_TIME", "CONTRACT", "TEMPORARY", "OTHER", "VOLUNTEER", "INTERNSHIP"] as const).find((value) => value === job.employment_type) || "OTHER",
    seniorityLevel: job.seniority_level || "",
    openingsCount: job.openings_count || 1,
    closingDate: job.closing_date ? job.closing_date.slice(0, 10) : "",
    sourceFileName: job.source_file_name || undefined,
    sourceFileType: job.source_file_type || undefined,
    applyUrl: job.apply_url || undefined,
    jobBoards: (job.job_boards || "").split(",").map((board) => board.trim()).filter(Boolean),
    linkedinJobTitleId: "",
    linkedinCompanyId: "",
    linkedinLocationId: "",
    notificationEmail: "",
  };
}

type JobPostingState = { externalJobId?: string | null; postingStatus?: string; publishError?: string | null; publishedAt?: string | null };

export function toOrdsJobPayload(input: JobInput, state: JobPostingState = {}) {
  return {
    job_posting_id: input.localJobId || null,
    external_job_id: state.externalJobId ?? null,
    account_id: process.env.UNIPILE_ACCOUNT_ID || null,
    apply_url: input.applyUrl || null,
    title: input.title,
    department: input.department || null,
    job_description: input.jobDescription || null,
    responsibilities: input.responsibilities || null,
    required_skills: input.requiredSkills || null,
    job_board: input.jobBoards.join(", ") || null,
    minimum_experience: input.minimumExperience,
    salary: input.salary,
    currency: input.currency || null,
    min_salary: input.minSalary,
    max_salary: input.maxSalary,
    pay_frequency: input.payFrequency || null,
    location: input.location || null,
    workplace_type: input.workplaceType,
    employment_type: input.employmentType,
    seniority_level: input.seniorityLevel || null,
    openings_count: input.openingsCount,
    closing_date: input.closingDate ? `${input.closingDate}T23:59:59` : null,
    source_file_name: input.sourceFileName || null,
    source_file_type: input.sourceFileType || null,
    posting_status: state.postingStatus || "DRAFT",
    publish_error: state.publishError ?? null,
    published_at: state.publishedAt ?? null,
    created_by: process.env.INNOHIRE_CREATED_BY || "ADMIN",
  };
}

export async function createOrdsJob(input: JobInput, state?: JobPostingState) {
  return requestOrds<{ job_posting_id?: string | number; response_message?: string; response_status?: string }>("/jobs", { method: "POST", body: JSON.stringify(toOrdsJobPayload(input, state)) });
}

export async function createOrdsCandidate(payload: Record<string, unknown>) {
  return requestOrds<Record<string, unknown>>("/candidate", { method: "POST", body: JSON.stringify(payload) });
}

export async function getOrdsCandidateResume(candidateId: number) {
  const response = await requestOrds<OrdsCollection<Record<string, unknown>>>("/candidate");
  const row = (response.items || []).find((item) => Number(item.job_candidate_id) === candidateId);
  return row ? nullableString(row.resume_text) : null;
}
