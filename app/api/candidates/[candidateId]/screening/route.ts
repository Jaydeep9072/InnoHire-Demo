import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { analyzeScreeningAnswers } from "@/lib/ai/screening-analysis-agent";
import { generateScreeningQuestions } from "@/lib/ai/screening-agent";
import {
  getLatestOrdsScreening,
  getOrdsCandidateResume,
  listOrdsCandidates,
  listOrdsJobs,
  OrdsError,
  saveOrdsScreening,
  type OrdsScreeningRecord,
} from "@/lib/ords/client";
import {
  screeningParameters,
  screeningSubmissionSchema,
  type ScreeningAnalysis,
  type ScreeningQuestion,
} from "@/lib/screening/schema";
import { screeningResume } from "@/lib/screening/resume";

export const runtime = "nodejs";
export const maxDuration = 120;
const headers = { "cache-control": "private, no-store" };

function responseError(error: unknown, fallback: string) {
  if (error instanceof ZodError) return NextResponse.json({ error: "The screening data is invalid." }, { status: 400, headers });
  if (error instanceof OrdsError) {
    return NextResponse.json({
      error: error.status === 404
        ? "Screening storage is not configured. Enable the ai_screening_analysis ORDS resource."
        : fallback,
    }, { status: error.status === 404 ? 503 : error.status, headers });
  }
  console.error("Candidate screening failed", error instanceof Error ? error.message : "Unknown error");
  return NextResponse.json({ error: fallback }, { status: 500, headers });
}

async function candidateContext(candidateId: number) {
  const candidate = (await listOrdsCandidates()).find((item) => item.job_candidate_id === candidateId);
  if (!candidate) return null;
  const job = (await listOrdsJobs(candidate.job_posting_id)).find((item) => item.job_posting_id === candidate.job_posting_id);
  return job ? { candidate, job } : null;
}

function jsonValue(value: string | null, fallback: unknown) {
  if (!value) return fallback;
  try { return JSON.parse(value); }
  catch { return fallback; }
}

function scoreValue(record: OrdsScreeningRecord, parameter: (typeof screeningParameters)[number]) {
  const fields: Record<(typeof screeningParameters)[number], number | null | undefined> = {
    "Role knowledge": record.role_knowledge_score,
    "Problem solving": record.problem_solving_score,
    Communication: record.communication_score,
    "Evidence and ownership": record.evidence_ownership_score,
    Collaboration: record.collaboration_score,
    "Motivation and adaptability": record.motivation_adaptability_score,
  };
  return Number(fields[parameter] ?? 0);
}

function parseStored(record: OrdsScreeningRecord) {
  const rawQuestions = jsonValue(record.questions_json, []) as Array<Record<string, unknown>>;
  const questions: ScreeningQuestion[] = rawQuestions.map((item, index) => {
    const suppliedCategory = String(item.category || "");
    const category: ScreeningQuestion["category"] = suppliedCategory === "HR" || suppliedCategory === "Resume" || suppliedCategory === "Job description"
      ? suppliedCategory
      : "Job description";
    return {
      id: String(item.id || `question-${item.question_id || index + 1}`),
      category,
      question: String(item.question || `Screening question ${index + 1}`),
      context: String(item.context || "Saved screening question"),
    };
  });
  const rawAnswers = jsonValue(record.answers_json, []);
  const answers: Record<string, string> = Array.isArray(rawAnswers)
    ? Object.fromEntries(rawAnswers.map((item: Record<string, unknown>, index) => {
        const numericId = item.question_id || index + 1;
        const question = questions.find(({ id }) => id === `question-${numericId}`) || questions[index];
        return [question?.id || `question-${numericId}`, String(item.answer || "")];
      }))
    : rawAnswers as Record<string, string>;

  let analysis: ScreeningAnalysis | undefined;
  if (record.screening_status === "COMPLETED" && record.overall_analysis) {
    const responsePayload = jsonValue(record.response_analysis_json, {}) as Record<string, unknown>;
    const savedAnalyses = (Array.isArray(responsePayload) ? responsePayload : Array.isArray(responsePayload.answers) ? responsePayload.answers : []) as Array<Record<string, unknown>>;
    const parameterPayload = jsonValue(record.parameter_scores_json, {}) as Record<string, unknown>;
    const keyByParameter: Record<(typeof screeningParameters)[number], string> = {
      "Role knowledge": "role_knowledge",
      "Problem solving": "problem_solving",
      Communication: "communication",
      "Evidence and ownership": "evidence_ownership",
      Collaboration: "collaboration",
      "Motivation and adaptability": "motivation_adaptability",
    };
    analysis = {
      responseAnalyses: questions.map((question, index) => {
        const saved = savedAnalyses.find((item) => String(item.questionId || `question-${item.question_id}`) === question.id) || savedAnalyses[index];
        return {
          questionId: question.id,
          score: Number(saved?.score ?? 0),
          analysis: String(saved?.analysis || "No separate answer analysis was stored."),
          evidence: String(saved?.evidence || answers[question.id] || "No evidence was stored."),
        };
      }),
      parameterScores: screeningParameters.map((parameter) => ({
        parameter,
        score: Number(parameterPayload[keyByParameter[parameter]] ?? scoreValue(record, parameter)),
        rationale: String(record.overall_analysis),
      })),
      summary: record.overall_analysis,
      strengths: jsonValue(record.strengths_json, []) as string[],
      developmentAreas: jsonValue(record.development_areas_json, []) as string[],
      riskFlags: jsonValue(record.risk_flags_json, []) as string[],
      confidencePercentage: Number(record.analysis_confidence_percentage || 0),
      overallMatchPercentage: Number(record.overall_match_percentage || 0),
    };
  }
  return { screeningId: record.screening_id, questions, answers, analysis, startedAt: record.started_at || record.created_at || undefined };
}

function submission(value: unknown) {
  const parsed = screeningSubmissionSchema.parse(value);
  if (new Set(parsed.questions.map(({ id }) => id)).size !== parsed.questions.length) throw new Error("Screening question ids must be unique.");
  return parsed;
}

function storagePayload(input: {
  candidateId: number;
  jobId: number;
  questions: ScreeningQuestion[];
  answers: Record<string, string>;
  startedAt?: string;
  analysis?: ScreeningAnalysis;
  analysisStartedAt?: string;
  completedAt?: string;
}) {
  const answeredCount = input.questions.filter(({ id }) => input.answers[id]?.trim()).length;
  const responseScore = (category: ScreeningQuestion["category"]) => {
    if (!input.analysis) return null;
    const scores = input.questions
      .filter((question) => question.category === category)
      .map((question) => input.analysis?.responseAnalyses.find((item) => item.questionId === question.id)?.score)
      .filter((score): score is number => score != null);
    return scores.length ? Math.round(scores.reduce((total, score) => total + score, 0) / scores.length) : null;
  };
  const parameterScore = (parameter: ScreeningAnalysis["parameterScores"][number]["parameter"]) =>
    input.analysis?.parameterScores.find((item) => item.parameter === parameter)?.score ?? null;
  return {
    job_candidate_id: input.candidateId,
    job_posting_id: input.jobId,
    screening_status: input.analysis ? "COMPLETED" as const : "DRAFT" as const,
    questions_json: JSON.stringify(input.questions),
    answers_json: JSON.stringify(input.answers),
    response_analysis_json: input.analysis ? JSON.stringify(input.analysis.responseAnalyses) : null,
    parameter_scores_json: input.analysis ? JSON.stringify(input.analysis.parameterScores) : null,
    question_count: input.questions.length,
    answered_count: answeredCount,
    completion_percentage: Math.round(answeredCount / input.questions.length * 100),
    hr_score: responseScore("HR"),
    resume_score: responseScore("Resume"),
    job_description_score: responseScore("Job description"),
    role_knowledge_score: parameterScore("Role knowledge"),
    problem_solving_score: parameterScore("Problem solving"),
    communication_score: parameterScore("Communication"),
    evidence_ownership_score: parameterScore("Evidence and ownership"),
    collaboration_score: parameterScore("Collaboration"),
    motivation_adaptability_score: parameterScore("Motivation and adaptability"),
    overall_match_percentage: input.analysis?.overallMatchPercentage ?? null,
    analysis_confidence_percentage: input.analysis?.confidencePercentage ?? null,
    overall_analysis: input.analysis?.summary ?? null,
    strengths_json: input.analysis ? JSON.stringify(input.analysis.strengths) : null,
    development_areas_json: input.analysis ? JSON.stringify(input.analysis.developmentAreas) : null,
    risk_flags_json: input.analysis ? JSON.stringify(input.analysis.riskFlags) : null,
    ai_model: input.analysis ? process.env.GEMINI_MODEL || "gemini-2.5-flash" : null,
    question_generation_model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    prompt_version: "V1.0",
    started_at: input.startedAt || new Date().toISOString(),
    submitted_at: input.analysis ? input.completedAt || new Date().toISOString() : null,
    analysis_started_at: input.analysisStartedAt || null,
    analyzed_at: input.analysis ? input.completedAt || new Date().toISOString() : null,
  };
}

export async function GET(_: Request, { params }: { params: Promise<{ candidateId: string }> }) {
  const candidateId = Number((await params).candidateId);
  if (!Number.isSafeInteger(candidateId) || candidateId <= 0) return NextResponse.json({ error: "Invalid candidate." }, { status: 400, headers });
  try {
    const record = await getLatestOrdsScreening(candidateId);
    if (!record) return NextResponse.json({ error: "No saved screening was found." }, { status: 404, headers });
    return NextResponse.json({ ...parseStored(record), screeningMatchPercentage: record.overall_match_percentage }, { headers });
  } catch (error) {
    if (error instanceof OrdsError && error.status === 404) return NextResponse.json({ error: "No saved screening was found." }, { status: 404, headers });
    return responseError(error, "The saved screening could not be loaded.");
  }
}

export async function POST(_: Request, { params }: { params: Promise<{ candidateId: string }> }) {
  const candidateId = Number((await params).candidateId);
  if (!Number.isSafeInteger(candidateId) || candidateId <= 0) return NextResponse.json({ error: "Invalid candidate." }, { status: 400, headers });
  if (!process.env.GOOGLE_API_KEY && !process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "AI screening is not configured. Add GOOGLE_API_KEY or GEMINI_API_KEY on the server." }, { status: 503, headers });
  }
  try {
    const context = await candidateContext(candidateId);
    if (!context) return NextResponse.json({ error: "Candidate or job not found." }, { status: 404, headers });
    if (context.candidate.application_status?.toUpperCase() === "REJECTED") return NextResponse.json({ error: "Screening is unavailable for rejected candidates." }, { status: 409, headers });
    if (![context.job.job_description, context.job.responsibilities, context.job.required_skills].some((value) => value?.trim())) {
      return NextResponse.json({ error: "Add a job description or job requirements before generating screening questions." }, { status: 422, headers });
    }
    let resume: string | Buffer;
    try { resume = screeningResume((await getOrdsCandidateResume(candidateId)) || ""); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "The resume could not be read." }, { status: 422, headers }); }
    const bank = await generateScreeningQuestions({ ...context, resume });
    return NextResponse.json({
      questions: bank.questions.map((question, index) => ({ ...question, id: `question-${index + 1}` })),
      startedAt: new Date().toISOString(),
    }, { headers });
  } catch (error) {
    return responseError(error, "Screening questions could not be generated right now. Please try again.");
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ candidateId: string }> }) {
  const candidateId = Number((await params).candidateId);
  if (!Number.isSafeInteger(candidateId) || candidateId <= 0) return NextResponse.json({ error: "Invalid candidate." }, { status: 400, headers });
  try {
    const context = await candidateContext(candidateId);
    if (!context) return NextResponse.json({ error: "Candidate or job not found." }, { status: 404, headers });
    const raw = await request.json() as Record<string, unknown>;
    const data = submission(raw);
    const result = await saveOrdsScreening(storagePayload({
      candidateId,
      jobId: context.job.job_posting_id,
      startedAt: typeof raw.startedAt === "string" ? raw.startedAt : undefined,
      ...data,
    }));
    return NextResponse.json({ screeningId: Number(result.screening_id || result.SCREENING_ID || 0) || undefined, message: "Screening answers saved." }, { headers });
  } catch (error) {
    return responseError(error, "Screening answers could not be saved.");
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ candidateId: string }> }) {
  const candidateId = Number((await params).candidateId);
  if (!Number.isSafeInteger(candidateId) || candidateId <= 0) return NextResponse.json({ error: "Invalid candidate." }, { status: 400, headers });
  try {
    const context = await candidateContext(candidateId);
    if (!context) return NextResponse.json({ error: "Candidate or job not found." }, { status: 404, headers });
    const raw = await request.json() as Record<string, unknown>;
    const data = submission(raw);
    const unanswered = data.questions.filter(({ id }) => !data.answers[id]?.trim());
    if (unanswered.length) return NextResponse.json({ error: `Answer all ${data.questions.length} questions before analysis. ${unanswered.length} answer${unanswered.length === 1 ? " is" : "s are"} missing.` }, { status: 422, headers });
    const startedAt = typeof raw.startedAt === "string" ? raw.startedAt : new Date().toISOString();
    const analysisStartedAt = new Date().toISOString();
    const analysis = await analyzeScreeningAnswers({ ...context, ...data });
    const completedAt = new Date().toISOString();
    const result = await saveOrdsScreening(storagePayload({
      candidateId,
      jobId: context.job.job_posting_id,
      ...data,
      startedAt,
      analysis,
      analysisStartedAt,
      completedAt,
    }));
    return NextResponse.json({
      screeningId: Number(result.screening_id || result.SCREENING_ID || 0) || undefined,
      analysis,
      screeningMatchPercentage: analysis.overallMatchPercentage,
      message: "Answers analyzed and saved.",
    }, { headers });
  } catch (error) {
    return responseError(error, "The answers could not be analyzed or saved right now.");
  }
}
