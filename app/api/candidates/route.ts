import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { createOrdsCandidate, listOrdsCandidates, listOrdsJobOptions, OrdsError } from "@/lib/ords/client";

export const runtime = "nodejs";

const candidateSchema = z.object({
  jobPostingId: z.number().int().positive(), externalApplicationId: z.string().trim().min(1).max(255),
  externalCandidateId: z.string().trim().max(255).optional(), fullName: z.string().trim().min(1).max(500),
  emailAddress: z.string().trim().email().max(500).optional(), phoneNumber: z.string().trim().max(100).optional(),
  headline: z.string().trim().max(1000).optional(), candidateLocation: z.string().trim().max(500).optional(),
  linkedinProfileUrl: z.string().url().max(2000).optional(), resumeUrl: z.string().url().max(2000).optional(),
  resumeText: z.string().trim().min(1).max(500000), currentCompany: z.string().trim().max(500).optional(),
  currentPosition: z.string().trim().max(500).optional(), yearsOfExperience: z.number().min(0).max(80).optional(),
  appliedAt: z.string().datetime().optional(),
});

function failure(error: unknown) {
  if (error instanceof ZodError) return NextResponse.json({ error: "Candidate data is invalid.", fields: error.flatten().fieldErrors }, { status: 400 });
  if (error instanceof OrdsError) return NextResponse.json({ error: error.message, details: error.details }, { status: error.status });
  console.error("Candidate operation failed", error instanceof Error ? error.message : "Unknown error");
  return NextResponse.json({ error: "Candidate data could not be loaded." }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams;
    const [allCandidates, jobs] = await Promise.all([listOrdsCandidates(), listOrdsJobOptions()]);
    const search = (query.get("search") || "").toLowerCase();
    const minimumScore = query.get("minimumScore") ? Number(query.get("minimumScore")) : null;
    const status = query.get("status");
    const jobTitle = query.get("jobTitle");
    const candidates = allCandidates.filter((candidate) => {
      const text = `${candidate.full_name || ""} ${candidate.email_address || ""} ${candidate.current_position || ""}`.toLowerCase();
      return (!search || text.includes(search))
        && (minimumScore == null || Number(candidate.match_score || 0) >= minimumScore)
        && (!status || candidate.application_status === status)
        && (!jobTitle || candidate.job_title === jobTitle);
    });
    return NextResponse.json({ configured: true, candidates, jobs });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.CANDIDATE_INGESTION_SECRET;
  if (!expectedSecret) return NextResponse.json({ error: "Candidate ingestion is not configured." }, { status: 503 });
  if (request.headers.get("x-ingestion-secret") !== expectedSecret) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const raw = await request.json() as Record<string, unknown>;
    const payload = "job_posting_id" in raw ? raw : (() => {
      const candidate = candidateSchema.parse(raw);
      return {
        job_posting_id: candidate.jobPostingId,
        external_application_id: candidate.externalApplicationId,
        external_candidate_id: candidate.externalCandidateId || null,
        full_name: candidate.fullName,
        email_address: candidate.emailAddress || null,
        phone_number: candidate.phoneNumber || null,
        headline: candidate.headline || null,
        candidate_location: candidate.candidateLocation || null,
        linkedin_profile_url: candidate.linkedinProfileUrl || null,
        resume_url: candidate.resumeUrl || null,
        resume_text: candidate.resumeText,
        current_company: candidate.currentCompany || null,
        current_position: candidate.currentPosition || null,
        years_of_experience: candidate.yearsOfExperience ?? null,
        applied_at: candidate.appliedAt || null,
      };
    })();
    return NextResponse.json(await createOrdsCandidate(payload));
  } catch (error) { return failure(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    const payload = z.object({ candidateId: z.number().int().positive(), status: z.literal("REJECTED") }).parse(await request.json());
    const candidate = (await listOrdsCandidates()).find((item) => item.job_candidate_id === payload.candidateId);
    if (!candidate) return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
    const result = await createOrdsCandidate({
      job_candidate_id: candidate.job_candidate_id,
      job_posting_id: candidate.job_posting_id,
      external_application_id: candidate.external_application_id,
      application_status: payload.status,
    });
    const response = result as { response_status?: string; response_message?: string };
    if (response.response_status && response.response_status.toUpperCase() !== "SUCCESS") throw new OrdsError(response.response_message || "ORDS did not update the candidate.", 502, result);
    return NextResponse.json({ candidateId: candidate.job_candidate_id, status: payload.status, message: "Candidate rejected successfully." });
  } catch (error) { return failure(error); }
}
