import { HumanMessage } from "@langchain/core/messages";
import { ChatGoogle } from "@langchain/google/node";
import { createAgent, providerStrategy } from "langchain";
import { z } from "zod";

export const extractedJobSchema = z.object({
  title: z.string().describe("Job title. Return an empty string only when it is not present."),
  department: z.string().describe("Department or business function. Return an empty string when absent."),
  jobDescription: z.string().describe("Clean complete description of the role without adding facts."),
  responsibilities: z.string().describe("Responsibilities separated by newline characters."),
  requiredSkills: z.string().describe("Required skills as a comma-separated list."),
  minimumExperience: z.number().min(0).max(80).describe("Minimum years of experience; use 0 when unspecified."),
  salary: z.number().int().nonnegative().nullable().describe("Single stated salary amount, or null when absent."),
  currency: z.string().max(3).describe("Three-letter ISO currency code, or an empty string when absent."),
  minSalary: z.number().int().nonnegative().nullable().describe("Minimum salary in a stated range, or null when absent."),
  maxSalary: z.number().int().nonnegative().nullable().describe("Maximum salary in a stated range, or null when absent."),
  payFrequency: z.enum(["YEARLY", "MONTHLY", "HOURLY", ""]).describe("Salary frequency, or an empty string when absent."),
  location: z.string().describe("Job location. Return an empty string when unspecified."),
  workplaceType: z.enum(["ON_SITE", "HYBRID", "REMOTE"]).describe("Use ON_SITE when the document does not specify a workplace type."),
  employmentType: z.enum(["FULL_TIME", "PART_TIME", "CONTRACT", "TEMPORARY", "OTHER", "VOLUNTEER", "INTERNSHIP"]).describe("Use FULL_TIME when unspecified."),
  seniorityLevel: z.enum(["ENTRY_LEVEL", "ASSOCIATE", "MID_SENIOR_LEVEL", "DIRECTOR", "EXECUTIVE", ""]).describe("Use an empty string when seniority cannot be determined."),
  openingsCount: z.number().int().min(1).max(999).describe("Number of openings; use 1 when unspecified."),
  closingDate: z.string().describe("Closing date in YYYY-MM-DD format, or an empty string when absent."),
});

export type ExtractedJob = z.infer<typeof extractedJobSchema>;

const systemPrompt = `You are InnoHire's job-description extraction agent.
Extract only information supported by the supplied document. Never invent company names, locations, dates, responsibilities, or skills.
Normalize enumerated fields to the allowed schema values. Preserve useful detail in jobDescription while keeping responsibilities and requiredSkills concise.
The result is inserted directly into an HR form, so return only the validated structured response.`;

export async function extractJobDescription(input: { buffer: Buffer; mimeType: string; fileName: string; text?: string }) {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Gemini extraction is not configured. Add GOOGLE_API_KEY to the environment.");
  const model = new ChatGoogle({
    apiKey,
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    maxRetries: 2,
  });
  const agent = createAgent({
    model,
    tools: [],
    systemPrompt,
    responseFormat: providerStrategy(extractedJobSchema),
  });
  const instruction = `Read the attached job description named "${input.fileName}" and extract every available form field.`;
  const message = input.mimeType === "application/pdf"
    ? new HumanMessage({
        contentBlocks: [
          { type: "text", text: instruction },
          { type: "file", mimeType: input.mimeType, data: input.buffer.toString("base64") },
        ],
        response_metadata: { output_version: "v1" },
      })
    : new HumanMessage(`${instruction}\n\nDocument content:\n${input.text || ""}`);
  const result = await agent.invoke({ messages: [message] });
  return extractedJobSchema.parse(result.structuredResponse);
}
