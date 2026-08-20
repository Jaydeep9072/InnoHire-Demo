import type { JobInput, JobListItem, JobOption } from "@/types/domain";
import { withConnection } from "./client";

const jobColumns = `title = :title, department = :department, job_description = :job_description,
  responsibilities = :responsibilities, required_skills = :required_skills, preferred_skills = :preferred_skills,
  minimum_experience = :minimum_experience, location = :location, workplace_type = :workplace_type,
  employment_type = :employment_type, seniority_level = :seniority_level, openings_count = :openings_count,
  closing_date = CASE WHEN :closing_date IS NULL THEN NULL ELSE TO_TIMESTAMP(:closing_date, 'YYYY-MM-DD') END,
  source_file_name = :source_file_name, updated_at = SYSTIMESTAMP`;

function binds(input: JobInput) {
  return {
    title: input.title, department: input.department || null, job_description: input.jobDescription || null,
    responsibilities: input.responsibilities || null, required_skills: input.requiredSkills || null,
    preferred_skills: input.preferredSkills || null, minimum_experience: input.minimumExperience,
    location: input.location || null, workplace_type: input.workplaceType, employment_type: input.employmentType,
    seniority_level: input.seniorityLevel || null, openings_count: input.openingsCount,
    closing_date: input.closingDate || null, source_file_name: input.sourceFileName || null,
  };
}

export async function saveJobDraft(input: JobInput): Promise<number> {
  return withConnection(async (connection, driver) => {
    if (input.localJobId) {
      await connection.execute(`UPDATE job_postings SET ${jobColumns} WHERE job_posting_id = :job_posting_id`, { ...binds(input), job_posting_id: input.localJobId }, { autoCommit: true });
      return input.localJobId;
    }
    const result = await connection.execute(
      `INSERT INTO job_postings (job_posting_id, account_id, title, department, job_description, responsibilities,
        required_skills, preferred_skills, minimum_experience, location, workplace_type, employment_type,
        seniority_level, openings_count, closing_date, source_file_name, posting_status, created_at, updated_at)
       VALUES (job_postings_seq.nextval, :account_id, :title, :department, :job_description, :responsibilities,
        :required_skills, :preferred_skills, :minimum_experience, :location, :workplace_type, :employment_type,
        :seniority_level, :openings_count, CASE WHEN :closing_date IS NULL THEN NULL ELSE TO_TIMESTAMP(:closing_date, 'YYYY-MM-DD') END,
        :source_file_name, 'DRAFT', SYSTIMESTAMP, SYSTIMESTAMP)
       RETURNING job_posting_id INTO :created_id`,
      { ...binds(input), account_id: process.env.UNIPILE_ACCOUNT_ID || null, created_id: { dir: driver.BIND_OUT, type: driver.NUMBER } },
      { autoCommit: true },
    );
    const out = result.outBinds as { created_id: number[] };
    return Number(out.created_id[0]);
  });
}

export async function updateJobPostingState(jobId: number, values: { status: string; externalJobId?: string; error?: string }) {
  await withConnection(async (connection) => {
    await connection.execute(
      `UPDATE job_postings SET posting_status = :status, external_job_id = COALESCE(:external_job_id, external_job_id),
       publish_error = :publish_error, published_at = CASE WHEN :status = 'PUBLISHED' THEN SYSTIMESTAMP ELSE published_at END,
       updated_at = SYSTIMESTAMP WHERE job_posting_id = :job_posting_id`,
      { status: values.status, external_job_id: values.externalJobId || null, publish_error: values.error || null, job_posting_id: jobId },
      { autoCommit: true },
    );
  });
}

export async function listJobOptions(): Promise<JobOption[]> {
  return withConnection(async (connection, driver) => {
    const result = await connection.execute<JobOption>(
      `SELECT job_posting_id, title, posting_status FROM job_postings ORDER BY created_at DESC NULLS LAST`, {}, { outFormat: driver.OUT_FORMAT_OBJECT },
    );
    return (result.rows ?? []).map((row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]))) as JobOption[];
  });
}

export async function listJobs(): Promise<JobListItem[]> {
  return withConnection(async (connection, driver) => {
    const result = await connection.execute<JobListItem>(
      `SELECT j.job_posting_id, j.external_job_id, j.title, j.department, j.location,
       j.workplace_type, j.employment_type, j.openings_count, j.posting_status,
       (SELECT COUNT(*) FROM job_candidates c WHERE c.job_posting_id = j.job_posting_id) AS applicant_count,
       TO_CHAR(j.created_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS created_at,
       TO_CHAR(j.published_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS published_at,
       TO_CHAR(j.closing_date, 'YYYY-MM-DD"T"HH24:MI:SS') AS closing_date
       FROM job_postings j
       ORDER BY j.created_at DESC NULLS LAST`,
      {},
      { outFormat: driver.OUT_FORMAT_OBJECT },
    );
    return (result.rows ?? []).map((row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]))) as JobListItem[];
  });
}
