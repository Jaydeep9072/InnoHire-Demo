import { z } from "zod";

export const screeningCategories = ["HR", "Resume", "Job description"] as const;
export const screeningParameters = [
  "Role knowledge",
  "Problem solving",
  "Communication",
  "Evidence and ownership",
  "Collaboration",
  "Motivation and adaptability",
] as const;

const screeningQuestionContentSchema = z.object({
  category: z.enum(screeningCategories),
  question: z.string().trim().min(20).max(1200),
  context: z.string().trim().min(1).max(600),
});

const generatedScreeningQuestionSchema = screeningQuestionContentSchema.extend({
  question: z.string().trim().min(20).max(220),
  context: z.string().trim().min(1).max(160),
});

export const screeningBankSchema = z.object({
  questions: z.array(generatedScreeningQuestionSchema).length(10),
});

export const screeningQuestionSchema = screeningQuestionContentSchema.extend({
  id: z.string().trim().min(1).max(100),
});

export const screeningAnalysisSchema = z.object({
  responseAnalyses: z.array(z.object({
    questionId: z.string().trim().min(1).max(100),
    score: z.number().int().min(0).max(100),
    analysis: z.string().trim().min(1).max(1500),
    evidence: z.string().trim().min(1).max(1000),
  })).min(1).max(20),
  parameterScores: z.array(z.object({
    parameter: z.enum(screeningParameters),
    score: z.number().int().min(0).max(100),
    rationale: z.string().trim().min(1).max(1500),
  })).length(screeningParameters.length),
  summary: z.string().trim().min(1).max(3000),
  strengths: z.array(z.string().trim().min(1).max(500)).max(8),
  developmentAreas: z.array(z.string().trim().min(1).max(500)).max(8),
  riskFlags: z.array(z.string().trim().min(1).max(500)).max(8),
  confidencePercentage: z.number().min(0).max(100),
});

export const screeningSubmissionSchema = z.object({
  questions: z.array(screeningQuestionSchema).min(1).max(20),
  answers: z.record(z.string(), z.string().max(10000)),
});

export type ScreeningBank = z.infer<typeof screeningBankSchema>;
export type ScreeningQuestion = z.infer<typeof screeningQuestionSchema>;
export type ScreeningAnalysis = z.infer<typeof screeningAnalysisSchema> & { overallMatchPercentage: number };
export type ScreeningSession = {
  questions: ScreeningQuestion[];
  answers: Record<string, string>;
  loading: boolean;
  error?: string;
  screeningId?: number;
  screeningMatchPercentage?: number;
  analysis?: ScreeningAnalysis;
  busy?: "saving" | "analyzing";
  message?: { type: "success" | "error"; text: string };
  startedAt?: string;
};

export function validateScreeningBank(value: unknown): ScreeningBank {
  const bank = screeningBankSchema.parse(value);
  const counts = Object.fromEntries(screeningCategories.map((category) => [category, bank.questions.filter((question) => question.category === category).length])) as Record<(typeof screeningCategories)[number], number>;
  if (counts.HR < 4 || counts.HR > 6 || counts.Resume < 2 || counts["Job description"] < 2 || Math.abs(counts.Resume - counts["Job description"]) > 1) {
    throw new Error("The question bank must contain 10 questions: four to six HR questions and a balanced remainder with at least two Resume and two Job description questions.");
  }
  const unique = new Set(bank.questions.map(({ question }) => question.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()));
  if (unique.size !== bank.questions.length) throw new Error("The question bank contains duplicate questions.");
  return bank;
}

export function validateScreeningAnalysis(value: unknown, questionIds: string[]) {
  const analysis = screeningAnalysisSchema.parse(value);
  const actualIds = analysis.responseAnalyses.map(({ questionId }) => questionId);
  if (new Set(actualIds).size !== questionIds.length || questionIds.some((id) => !actualIds.includes(id))) {
    throw new Error("The answer analysis does not match the screening questions.");
  }
  if (new Set(analysis.parameterScores.map(({ parameter }) => parameter)).size !== screeningParameters.length) {
    throw new Error("The analysis must contain every evaluation parameter once.");
  }
  const weights: Record<(typeof screeningParameters)[number], number> = {
    "Role knowledge": 0.2,
    "Problem solving": 0.2,
    Communication: 0.15,
    "Evidence and ownership": 0.15,
    Collaboration: 0.15,
    "Motivation and adaptability": 0.15,
  };
  const overallMatchPercentage = Math.round(analysis.parameterScores.reduce((total, item) => total + item.score * weights[item.parameter], 0));
  return { ...analysis, overallMatchPercentage };
}
