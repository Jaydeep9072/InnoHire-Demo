import type { Candidate, Employee, JobInput, JobListItem, JobOption } from "@/types/domain";

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

function sanitizeForLog(value: unknown, key = ""): unknown {
  const normalizedKey = key.toLowerCase();
  if (/password|secret|api[_-]?key|authorization|access[_-]?token/.test(normalizedKey)) return "[REDACTED]";
  if (normalizedKey === "resume_text" || normalizedKey === "resumebase64") {
    const length = typeof value === "string" ? value.length : 0;
    return `[REDACTED BASE64 RESUME: ${length} characters]`;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeForLog(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [entryKey, sanitizeForLog(entryValue, entryKey)]));
  }
  return value;
}

function requestBodyForLog(body: BodyInit | null | undefined) {
  if (typeof body !== "string") return body ? `[${body.constructor.name}]` : null;
  try { return sanitizeForLog(JSON.parse(body)); }
  catch { return body; }
}

async function requestOrds<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  const method = (init?.method || "GET").toUpperCase();
  const url = `${getOrdsBaseUrl()}${path}`;
  if (method === "POST") console.info(`ORDS POST request\n${JSON.stringify({ url, payload: requestBodyForLog(init?.body) }, null, 2)}`);
  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
      headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
    });
    const text = await response.text();
    let payload: unknown = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
    if (method === "POST") console.info(`ORDS POST response\n${JSON.stringify({ url, status: response.status, ok: response.ok, payload: sanitizeForLog(payload) }, null, 2)}`);
    if (!response.ok) throw new OrdsError(`ORDS request failed with status ${response.status}.`, response.status, payload);
    return payload as T;
  } catch (error) {
    if (error instanceof OrdsError) throw error;
    if (method === "POST") console.error("ORDS POST transport error", { url, error: error instanceof Error ? error.message : "Unknown transport error" });
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
    external_candidate_id: nullableString(row.external_candidate_id),
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
    screening_id: nullableNumber(row.screening_id),
    overall_match_percentage: nullableNumber(row.overall_match_percentage),
    matching_skills: nullableString(row.matching_skills),
    missing_skills: nullableString(row.missing_skills),
    relevant_experience: nullableString(row.relevant_experience),
    match_strengths: nullableString(row.match_strengths),
    match_concerns: nullableString(row.match_concerns),
    match_summary: nullableString(row.match_summary),
    applied_at: nullableString(row.applied_at),
    scored_at: nullableString(row.scored_at),
    job_title: nullableString(row.job_title),
  }));
}

export async function listOrdsJobOptions(): Promise<JobOption[]> {
  const response = await requestOrds<OrdsCollection<{ title?: string | null }>>("/jobs_title_lov");
  return (response.items || []).filter((row) => row.title).map((row, index) => ({ job_posting_id: index + 1, title: row.title || null, posting_status: null }));
}

export async function listOrdsEmployees(): Promise<Employee[]> {
  const response = await requestOrds<OrdsCollection<Record<string, unknown>>>("/employees");
  return (response.items || []).map((row) => ({
    employee_id: Number(row.employee_id),
    employee_code: nullableString(row.employee_code),
    first_name: nullableString(row.first_name),
    last_name: nullableString(row.last_name),
    full_name: nullableString(row.full_name),
    email_address: nullableString(row.email_address),
    department: nullableString(row.department),
    designation: nullableString(row.designation),
    employee_status: nullableString(row.employee_status),
    work_location: nullableString(row.work_location),
    years_of_experience: nullableNumber(row.years_of_experience),
  })).filter((employee) => Number.isInteger(employee.employee_id) && employee.employee_id > 0 && employee.employee_status?.toUpperCase() === "ACTIVE" && employee.email_address);
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
    job_boards: [...new Set(input.jobBoards.map((board) => board.trim()).filter(Boolean))].join(",") || null,
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
  const response = await requestOrds<OrdsCollection<Record<string, unknown>>>(`/candidate?job_candidate_id=${encodeURIComponent(candidateId)}`);
  const row = (response.items || []).find((item) => Number(item.job_candidate_id) === candidateId);
  return row ? nullableString(row.resume_text ?? row.resume_base64) : null;
}


export type OrdsScreeningRecord = {
  screening_id: number;
  job_candidate_id: number;
  job_posting_id: number;
  account_id: string | null;
  screening_status: "DRAFT" | "COMPLETED" | "FAILED";
  questions_json: string;
  answers_json: string;
  response_analysis_json: string | null;
  parameter_scores_json: string | null;
  question_count?: number;
  answered_count?: number;
  completion_percentage?: number;
  hr_score?: number | null;
  resume_score?: number | null;
  job_description_score?: number | null;
  role_knowledge_score?: number | null;
  problem_solving_score?: number | null;
  communication_score?: number | null;
  evidence_ownership_score?: number | null;
  collaboration_score?: number | null;
  motivation_adaptability_score?: number | null;
  overall_match_percentage: number | null;
  analysis_confidence_percentage?: number | null;
  overall_analysis: string | null;
  strengths_json: string | null;
  development_areas_json: string | null;
  risk_flags_json: string | null;
  ai_model: string | null;
  started_at?: string | null;
  submitted_at?: string | null;
  analysis_started_at?: string | null;
  created_at: string | null;
  updated_at: string | null;
  analyzed_at: string | null;
};

export async function getLatestOrdsScreening(candidateId: number): Promise<OrdsScreeningRecord | null> {
  const response = await requestOrds<OrdsCollection<Record<string, unknown>>>(`/ai_screening_analysis?job_candidate_id=${encodeURIComponent(candidateId)}`);
  const rows = (response.items || []).filter((row) => Number(row.job_candidate_id) === candidateId);
  rows.sort((a, b) => String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || "")));
  const row = rows[0];
  if (!row) return null;
  const status = String(row.screening_status || "DRAFT").toUpperCase();
  return {
    screening_id: Number(row.screening_id),
    job_candidate_id: Number(row.job_candidate_id),
    job_posting_id: Number(row.job_posting_id),
    account_id: nullableString(row.account_id),
    screening_status: status === "COMPLETED" || status === "ANALYZED" ? "COMPLETED" : status === "FAILED" ? "FAILED" : "DRAFT",
    questions_json: typeof row.questions_json === "string" ? row.questions_json : JSON.stringify(row.questions_json || []),
    answers_json: typeof row.answers_json === "string" ? row.answers_json : JSON.stringify(row.answers_json || []),
    response_analysis_json: row.response_analysis_json == null ? null : typeof row.response_analysis_json === "string" ? row.response_analysis_json : JSON.stringify(row.response_analysis_json),
    parameter_scores_json: row.parameter_scores_json == null ? null : typeof row.parameter_scores_json === "string" ? row.parameter_scores_json : JSON.stringify(row.parameter_scores_json),
    question_count: nullableNumber(row.question_count) ?? undefined,
    answered_count: nullableNumber(row.answered_count) ?? undefined,
    completion_percentage: nullableNumber(row.completion_percentage) ?? undefined,
    hr_score: nullableNumber(row.hr_score),
    resume_score: nullableNumber(row.resume_score),
    job_description_score: nullableNumber(row.job_description_score),
    role_knowledge_score: nullableNumber(row.role_knowledge_score),
    problem_solving_score: nullableNumber(row.problem_solving_score),
    communication_score: nullableNumber(row.communication_score),
    evidence_ownership_score: nullableNumber(row.evidence_ownership_score),
    collaboration_score: nullableNumber(row.collaboration_score),
    motivation_adaptability_score: nullableNumber(row.motivation_adaptability_score),
    overall_match_percentage: nullableNumber(row.overall_match_percentage),
    analysis_confidence_percentage: nullableNumber(row.analysis_confidence_percentage),
    overall_analysis: nullableString(row.overall_analysis),
    strengths_json: nullableString(row.strengths_json),
    development_areas_json: nullableString(row.development_areas_json),
    risk_flags_json: nullableString(row.risk_flags_json),
    ai_model: nullableString(row.ai_model),
    started_at: nullableString(row.started_at),
    submitted_at: nullableString(row.submitted_at),
    analysis_started_at: nullableString(row.analysis_started_at),
    created_at: nullableString(row.created_at),
    updated_at: nullableString(row.updated_at),
    analyzed_at: nullableString(row.analyzed_at),
  };
}

type SaveOrdsScreeningInput = Omit<OrdsScreeningRecord, "screening_id" | "account_id" | "created_at" | "updated_at"> & {
  screening_id?: number;
  question_generation_model?: string | null;
  prompt_version?: string | null;
};

function scoreBand(score: number | null | undefined) {
  if (score == null) return "NOT_ASSESSED";
  if (score >= 85) return "EXCELLENT";
  if (score >= 70) return "GOOD";
  if (score >= 50) return "FAIR";
  return "LOW";
}

function relevanceBand(score: number | null | undefined) {
  if (score == null) return "NOT_ASSESSED";
  if (score >= 75) return "HIGH";
  if (score >= 50) return "MEDIUM";
  return "LOW";
}

export async function saveOrdsScreening(input: SaveOrdsScreeningInput) {
  const storedQuestions = JSON.parse(input.questions_json) as Array<{ id: string; question: string; category?: string; context?: string }>;
  const answerRecord = JSON.parse(input.answers_json) as Record<string, string>;
  const answerAnalyses = input.response_analysis_json ? JSON.parse(input.response_analysis_json) : [];
  const questionId = (value: string, index: number) => Number(value.match(/\d+$/)?.[0] || index + 1);
  const questions = storedQuestions.map((item, index) => ({
    question_id: questionId(item.id, index),
    question: item.question,
    category: item.category,
    context: item.context,
  }));
  const answers = storedQuestions.map((item, index) => ({
    question_id: questionId(item.id, index),
    answer: answerRecord[item.id] || "",
  }));
  const parameterScores = {
    hr: input.hr_score,
    resume: input.resume_score,
    job_description: input.job_description_score,
    role_knowledge: input.role_knowledge_score,
    problem_solving: input.problem_solving_score,
    communication: input.communication_score,
    evidence_ownership: input.evidence_ownership_score,
    collaboration: input.collaboration_score,
    motivation_adaptability: input.motivation_adaptability_score,
  };
  const technicalScore = input.role_knowledge_score == null || input.problem_solving_score == null
    ? null
    : (input.role_knowledge_score + input.problem_solving_score) / 2;
  const experienceScore = input.resume_score == null || input.job_description_score == null
    ? null
    : (input.resume_score + input.job_description_score) / 2;
  const actor = process.env.INNOHIRE_CREATED_BY || "ADMIN";

  return requestOrds<Record<string, unknown>>("/ai_screening_analysis", {
    method: "POST",
    body: JSON.stringify({
      job_candidate_id: input.job_candidate_id,
      job_posting_id: input.job_posting_id,
      account_id: process.env.UNIPILE_ACCOUNT_ID || null,
      screening_round: 1,
      screening_status: input.screening_status,
      response_mode: "TEXT",
      question_bank_version: "V1.0",
      question_count: input.question_count ?? questions.length,
      answered_count: input.answered_count ?? answers.filter((item) => item.answer.trim()).length,
      completion_percentage: input.completion_percentage ?? 0,
      questions_json: questions,
      answers_json: answers,
      response_analysis_json: {
        technical_accuracy: scoreBand(technicalScore),
        communication: scoreBand(input.communication_score),
        experience_relevance: relevanceBand(experienceScore),
        answers: answerAnalyses,
      },
      parameter_scores_json: parameterScores,
      hr_score: input.hr_score,
      resume_score: input.resume_score,
      job_description_score: input.job_description_score,
      role_knowledge_score: input.role_knowledge_score,
      problem_solving_score: input.problem_solving_score,
      communication_score: input.communication_score,
      evidence_ownership_score: input.evidence_ownership_score,
      collaboration_score: input.collaboration_score,
      motivation_adaptability_score: input.motivation_adaptability_score,
      overall_match_percentage: input.overall_match_percentage,
      analysis_confidence_percentage: input.analysis_confidence_percentage,
      overall_analysis: input.overall_analysis,
      strengths_json: input.strengths_json ? JSON.parse(input.strengths_json) : [],
      development_areas_json: input.development_areas_json ? JSON.parse(input.development_areas_json) : [],
      risk_flags_json: input.risk_flags_json ? JSON.parse(input.risk_flags_json) : [],
      analysis_error: null,
      started_at: input.started_at || new Date().toISOString(),
      submitted_at: input.submitted_at,
      analysis_started_at: input.analysis_started_at,
      analyzed_at: input.analyzed_at,
      review_status: "PENDING",
      reviewed_by: null,
      reviewer_notes: null,
      reviewed_at: null,
      created_by: actor,
      updated_by: actor,
    }),
  });
}
