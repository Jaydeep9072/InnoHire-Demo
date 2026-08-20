import type { Candidate } from "@/types/domain";
import { scoreCandidate } from "@/lib/candidate-matching/score";
import { withConnection } from "./client";

export type CandidateFilters = { jobId?: number; search?: string; minimumScore?: number; status?: string; page?: number; pageSize?: number };

export async function listCandidates(filters: CandidateFilters) {
  return withConnection(async (connection, driver) => {
    const conditions: string[] = [];
    const binds: Record<string, string | number> = {};
    if (filters.jobId) { conditions.push("c.job_posting_id = :job_id"); binds.job_id = filters.jobId; }
    if (filters.search) { conditions.push("(LOWER(c.full_name) LIKE :search OR LOWER(c.email_address) LIKE :search OR LOWER(c.resume_text) LIKE :search)"); binds.search = `%${filters.search.toLowerCase()}%`; }
    if (filters.minimumScore != null) { conditions.push("c.match_score >= :minimum_score"); binds.minimum_score = filters.minimumScore; }
    if (filters.status) { conditions.push("c.application_status = :application_status"); binds.application_status = filters.status; }
    const page = Math.max(1, filters.page || 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize || 25));
    binds.offset_rows = (page - 1) * pageSize;
    binds.page_size = pageSize;
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await connection.execute<Candidate>(
      `SELECT c.job_candidate_id, c.job_posting_id, c.external_application_id, c.full_name, c.email_address,
       c.phone_number, c.headline, c.candidate_location, c.linkedin_profile_url, c.resume_url, c.current_company,
       c.current_position, c.years_of_experience, c.application_status, c.match_score, c.matching_skills,
       c.missing_skills, c.relevant_experience, c.match_strengths, c.match_concerns, c.match_summary,
       TO_CHAR(c.applied_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS applied_at, j.title AS job_title
       FROM job_candidates c LEFT JOIN job_postings j ON j.job_posting_id = c.job_posting_id
       ${where} ORDER BY c.match_score DESC NULLS LAST, c.applied_at DESC NULLS LAST
       OFFSET :offset_rows ROWS FETCH NEXT :page_size ROWS ONLY`, binds, { outFormat: driver.OUT_FORMAT_OBJECT },
    );
    return (result.rows ?? []).map((row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]))) as Candidate[];
  });
}

export type CandidateIngest = {
  jobPostingId: number; externalApplicationId: string; externalCandidateId?: string; fullName: string;
  emailAddress?: string; phoneNumber?: string; headline?: string; candidateLocation?: string;
  linkedinProfileUrl?: string; resumeUrl?: string; resumeText: string; currentCompany?: string;
  currentPosition?: string; yearsOfExperience?: number; appliedAt?: string;
};

export async function ingestCandidate(input: CandidateIngest) {
  return withConnection(async (connection, driver) => {
    const jobResult = await connection.execute<{ TITLE: string; REQUIRED_SKILLS: string; PREFERRED_SKILLS: string; MINIMUM_EXPERIENCE: number }>(
      `SELECT title, required_skills, preferred_skills, minimum_experience FROM job_postings WHERE job_posting_id = :job_id`, { job_id: input.jobPostingId }, { outFormat: driver.OUT_FORMAT_OBJECT },
    );
    const job = jobResult.rows?.[0];
    if (!job) throw new Error("Job not found.");
    const matching = scoreCandidate(
      { title: job.TITLE || "the role", requiredSkills: job.REQUIRED_SKILLS || "", preferredSkills: job.PREFERRED_SKILLS || "", minimumExperience: Number(job.MINIMUM_EXPERIENCE || 0) },
      { resumeText: input.resumeText, headline: input.headline || "", currentPosition: input.currentPosition || "", yearsOfExperience: input.yearsOfExperience || 0 },
    );
    const existing = await connection.execute<{ JOB_CANDIDATE_ID: number }>(
      `SELECT job_candidate_id FROM job_candidates WHERE job_posting_id = :job_id AND external_application_id = :external_application_id FETCH FIRST 1 ROW ONLY`,
      { job_id: input.jobPostingId, external_application_id: input.externalApplicationId }, { outFormat: driver.OUT_FORMAT_OBJECT },
    );
    const common = {
      job_posting_id: input.jobPostingId, external_application_id: input.externalApplicationId,
      external_candidate_id: input.externalCandidateId || null, full_name: input.fullName, email_address: input.emailAddress || null,
      phone_number: input.phoneNumber || null, headline: input.headline || null, candidate_location: input.candidateLocation || null,
      linkedin_profile_url: input.linkedinProfileUrl || null, resume_url: input.resumeUrl || null, resume_text: input.resumeText,
      current_company: input.currentCompany || null, current_position: input.currentPosition || null,
      years_of_experience: input.yearsOfExperience || 0, match_score: matching.score,
      matching_skills: matching.matchingSkills.join(", ") || null, missing_skills: matching.missingSkills.join(", ") || null,
      match_strengths: matching.strengths.join("\n") || null, match_concerns: matching.concerns.join("\n") || null, match_summary: matching.summary,
      applied_at: input.appliedAt ? new Date(input.appliedAt) : new Date(),
    };
    const existingId = existing.rows?.[0]?.JOB_CANDIDATE_ID;
    if (existingId) {
      await connection.execute(`UPDATE job_candidates SET full_name=:full_name, email_address=:email_address, phone_number=:phone_number,
       headline=:headline, candidate_location=:candidate_location, linkedin_profile_url=:linkedin_profile_url, resume_url=:resume_url,
       resume_text=:resume_text, current_company=:current_company, current_position=:current_position, years_of_experience=:years_of_experience,
       match_score=:match_score, matching_skills=:matching_skills, missing_skills=:missing_skills, match_strengths=:match_strengths,
       match_concerns=:match_concerns, match_summary=:match_summary, scored_at=SYSTIMESTAMP, updated_at=SYSTIMESTAMP
       WHERE job_candidate_id=:job_candidate_id`, { ...common, job_candidate_id: existingId }, { autoCommit: true });
      return { id: Number(existingId), score: matching.score, updated: true };
    }
    const result = await connection.execute(
      `INSERT INTO job_candidates (job_candidate_id, job_posting_id, external_application_id, external_candidate_id, full_name,
       email_address, phone_number, headline, candidate_location, linkedin_profile_url, resume_url, resume_text, current_company,
       current_position, years_of_experience, application_status, match_score, matching_skills, missing_skills, match_strengths,
       match_concerns, match_summary, applied_at, scored_at, created_at, updated_at)
       VALUES (job_candidates_seq.nextval, :job_posting_id, :external_application_id, :external_candidate_id, :full_name,
       :email_address, :phone_number, :headline, :candidate_location, :linkedin_profile_url, :resume_url, :resume_text, :current_company,
       :current_position, :years_of_experience, 'APPLIED', :match_score, :matching_skills, :missing_skills, :match_strengths,
       :match_concerns, :match_summary, :applied_at, SYSTIMESTAMP, SYSTIMESTAMP, SYSTIMESTAMP)
       RETURNING job_candidate_id INTO :created_id`, { ...common, created_id: { dir: driver.BIND_OUT, type: driver.NUMBER } }, { autoCommit: true },
    );
    return { id: Number((result.outBinds as { created_id: number[] }).created_id[0]), score: matching.score, updated: false };
  });
}
