import { HumanMessage } from "@langchain/core/messages";
import { ChatGoogle } from "@langchain/google/node";
import { createAgent, providerStrategy } from "langchain";
import { z } from "zod";
import type { OrdsJob } from "@/lib/ords/client";

const candidateMatchSchema = z.object({
  matchScore: z.number().int().min(0).max(100),
  matchingSkills: z.array(z.string()).max(30),
  missingSkills: z.array(z.string()).max(30),
  relevantExperience: z.string().max(2000),
  strengths: z.array(z.string()).max(10),
  concerns: z.array(z.string()).max(10),
  summary: z.string().min(1).max(2000),
});

export type CandidateMatch = z.infer<typeof candidateMatchSchema>;

const systemPrompt = `You are InnoHire's candidate-to-job matching agent.
Evaluate the candidate only against the supplied job. Use evidence from the application and attached resume; do not infer unsupported skills or experience.
Do not use or infer protected characteristics. Scores support a human review and must not make an autonomous hiring decision.
Return concise, client-readable evidence. A missing skill means the resume does not demonstrate it, not that the candidate definitely lacks it.`;

export async function matchCandidateToJob(input: {
  job: OrdsJob;
  resume: Buffer;
  candidate: {
    currentCompany?: string;
    currentPosition?: string;
    yearsOfExperience?: number;
  };
}) {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Candidate matching is not configured.");

  const model = new ChatGoogle({
    apiKey,
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    maxRetries: 2,
  });
  const agent = createAgent({
    model,
    tools: [],
    systemPrompt,
    responseFormat: providerStrategy(candidateMatchSchema),
  });
  const jobContext = {
    title: input.job.title,
    department: input.job.department,
    description: input.job.job_description,
    responsibilities: input.job.responsibilities,
    requiredSkills: input.job.required_skills,
    minimumExperience: input.job.minimum_experience,
    location: input.job.location,
    workplaceType: input.job.workplace_type,
    employmentType: input.job.employment_type,
  };
  const candidateContext = {
    currentCompany: input.candidate.currentCompany || null,
    currentPosition: input.candidate.currentPosition || null,
    yearsOfExperience: input.candidate.yearsOfExperience ?? null,
  };
  const message = new HumanMessage({
    contentBlocks: [
      {
        type: "text",
        text: `Match this candidate to this exact job.\n\nJob:\n${JSON.stringify(jobContext)}\n\nCandidate application:\n${JSON.stringify(candidateContext)}`,
      },
      { type: "file", mimeType: "application/pdf", data: input.resume.toString("base64") },
    ],
    response_metadata: { output_version: "v1" },
  });
  const result = await agent.invoke({ messages: [message] });
  return candidateMatchSchema.parse(result.structuredResponse);
}
