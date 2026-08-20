import { Buffer } from "node:buffer";
import { NextRequest, NextResponse } from "next/server";
import pdfParse from "pdf-parse";
import { z, ZodError } from "zod";
import { findJobByApplicationToken } from "@/lib/applications/urls";
import { matchCandidateToJob, type CandidateMatch } from "@/lib/ai/candidate-matching-agent";
import { scoreCandidate } from "@/lib/candidate-matching/score";
import { createOrdsCandidate, listOrdsJobs, OrdsError } from "@/lib/ords/client";

export const runtime = "nodejs";
const maximumResumeBytes = 3 * 1024 * 1024;

const applicationSchema = z.object({
  externalApplicationId: z.string().uuid(),
  fullName: z.string().trim().min(2).max(500),
  emailAddress: z.string().trim().email().max(500),
  phoneNumber: z.string().trim().min(5).max(100),
  candidateLocation: z.string().trim().min(2).max(500),
  linkedinProfileUrl: z.union([z.string().trim().url().max(2000), z.literal("")]).optional(),
  currentCompany: z.string().trim().max(500).optional(), currentPosition: z.string().trim().max(500).optional(),
  yearsOfExperience: z.number().min(0).max(80).optional(),
  resumeFileName: z.string().trim().min(1).max(500), resumeMimeType: z.literal("application/pdf"),
  resumeBase64: z.string().min(8).max(4_200_000), consent: z.literal(true),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const job = findJobByApplicationToken(await listOrdsJobs(), token);
    if (!job) return NextResponse.json({ error: "This application link is not available." }, { status: 404 });
    const application = applicationSchema.parse(await request.json());
    const resume = Buffer.from(application.resumeBase64, "base64");
    if (!resume.length || resume.length > maximumResumeBytes || resume.subarray(0, 5).toString("ascii") !== "%PDF-") {
      return NextResponse.json({ error: "Upload a valid PDF résumé no larger than 3 MB." }, { status: 400 });
    }
    let match: CandidateMatch;
    try {
      match = await matchCandidateToJob({
        job,
        resume,
        candidate: {
          currentCompany: application.currentCompany,
          currentPosition: application.currentPosition,
          yearsOfExperience: application.yearsOfExperience,
        },
      });
    } catch (error) {
      console.error("Gemini candidate matching failed; using evidence-only fallback scoring.", error);
      let resumeText = "";
      try { resumeText = (await pdfParse(resume)).text; }
      catch (parseError) { console.error("Resume text extraction failed during fallback scoring.", parseError); }
      const fallback = scoreCandidate({
        title: job.title || "this role",
        requiredSkills: job.required_skills || "",
        preferredSkills: "",
        minimumExperience: job.minimum_experience || 0,
      }, {
        resumeText,
        headline: application.currentPosition || "",
        currentPosition: application.currentPosition || "",
        yearsOfExperience: application.yearsOfExperience || 0,
      });
      match = {
        matchScore: fallback.score,
        matchingSkills: fallback.matchingSkills,
        missingSkills: fallback.missingSkills,
        relevantExperience: application.currentPosition || "Experience details were not available for automated review.",
        strengths: fallback.strengths,
        concerns: fallback.concerns,
        summary: fallback.summary,
      };
    }
    const result = await createOrdsCandidate({
      job_posting_id: job.job_posting_id,
      external_application_id: application.externalApplicationId,
      external_candidate_id: null,
      full_name: application.fullName,
      email_address: application.emailAddress,
      phone_number: application.phoneNumber,
      headline: application.currentPosition || null,
      candidate_location: application.candidateLocation,
      linkedin_profile_url: application.linkedinProfileUrl || null,
      resume_url: null,
      resume_text: application.resumeBase64,
      current_company: application.currentCompany || null,
      current_position: application.currentPosition || null,
      years_of_experience: application.yearsOfExperience ?? null,
      application_status: "APPLIED",
      match_score: match.matchScore,
      matching_skills: match.matchingSkills.join(", ") || null,
      missing_skills: match.missingSkills.join(", ") || null,
      relevant_experience: match.relevantExperience || null,
      match_strengths: match.strengths.join("\n") || null,
      match_concerns: match.concerns.join("\n") || null,
      match_summary: match.summary,
      applied_at: new Date().toISOString(),
    });
    const status = String(result.response_status ?? result.repsonse_status ?? "SUCCESS").toUpperCase();
    if (status !== "SUCCESS") throw new OrdsError(String(result.response_message ?? result.repsonse_message ?? "The application could not be saved."), 502, result);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof ZodError) return NextResponse.json({ error: "Complete all required fields and attach a valid PDF résumé." }, { status: 400 });
    if (error instanceof OrdsError) {
      console.error("ORDS candidate application failed", { message: error.message, status: error.status, details: error.details });
      return NextResponse.json({ error: "Your application could not be submitted right now. Please try again shortly." }, { status: error.status });
    }
    console.error("Candidate application failed", error);
    return NextResponse.json({ error: "Your application could not be submitted. Please try again." }, { status: 500 });
  }
}
