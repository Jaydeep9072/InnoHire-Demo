import { z } from "zod";
import { hasRichText, sanitizeRichText } from "@/lib/rich-text";

const text = z.string().trim().max(10000);
const money = z.preprocess((value) => {
  if (value == null || value === "") return null;
  const normalized = typeof value === "string" ? value.replaceAll(",", "").trim() : value;
  return normalized === "" ? null : Number(normalized);
}, z.number().int().nonnegative().max(999_999_999_999).nullable());

export const jobDraftSchema = z.object({
  localJobId: z.number().int().positive().optional(),
  title: z.string().trim().min(1, "Job title is required").max(500),
  department: z.string().trim().max(255).default(""),
  jobDescription: z.string().trim().max(100000).transform(sanitizeRichText).default(""),
  responsibilities: z.string().trim().max(10000).transform(sanitizeRichText).default(""),
  requiredSkills: text.default(""),
  preferredSkills: text.default(""),
  minimumExperience: z.coerce.number().min(0).max(80).default(0),
  salary: money.default(null),
  currency: z.string().trim().max(3).default(""),
  minSalary: money.default(null),
  maxSalary: money.default(null),
  payFrequency: z.enum(["YEARLY", "MONTHLY", "HOURLY", ""]).default(""),
  location: z.string().trim().max(500).default(""),
  workplaceType: z.enum(["ON_SITE", "HYBRID", "REMOTE"]).default("ON_SITE"),
  employmentType: z.enum(["FULL_TIME", "PART_TIME", "CONTRACT", "TEMPORARY", "OTHER", "VOLUNTEER", "INTERNSHIP"]).default("FULL_TIME"),
  seniorityLevel: z.string().trim().max(100).default(""),
  openingsCount: z.coerce.number().int().min(1).max(999).default(1),
  closingDate: z.string().trim().max(50).default(""),
  sourceFileName: z.string().trim().max(1000).optional(),
  sourceFileType: z.string().trim().max(255).optional(),
  applyUrl: z.string().trim().url("Enter a valid application URL").max(2000).optional().or(z.literal("")),
  jobBoards: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  linkedinJobTitleId: z.string().trim().max(255).default(""),
  linkedinCompanyId: z.string().trim().max(255).default(""),
  linkedinLocationId: z.string().trim().max(255).default(""),
  notificationEmail: z.string().trim().max(500).default(""),
});

export const publishJobSchema = jobDraftSchema.superRefine((value, context) => {
  const required: Array<[keyof typeof value, string]> = [
    ["department", "Department is required"],
    ["jobDescription", "Job description is required"],
    ["responsibilities", "Responsibilities are required"],
    ["requiredSkills", "Required skills are required"],
    ["location", "Location is required"],
  ];
  for (const [field, message] of required) {
    const fieldValue = String(value[field] ?? "");
    if ((field === "jobDescription" || field === "responsibilities") ? !hasRichText(fieldValue) : !fieldValue.trim()) context.addIssue({ code: "custom", path: [field], message });
  }
  // Job-board and LinkedIn identifier validation is paused while submissions use ORDS only.
  if (value.notificationEmail && !z.string().email().safeParse(value.notificationEmail).success) {
    context.addIssue({ code: "custom", path: ["notificationEmail"], message: "Enter a valid notification email" });
  }
  const hasSalary = value.salary != null || value.minSalary != null || value.maxSalary != null;
  if (hasSalary && !value.currency) context.addIssue({ code: "custom", path: ["currency"], message: "Currency is required when salary is entered" });
  if (hasSalary && !value.payFrequency) context.addIssue({ code: "custom", path: ["payFrequency"], message: "Pay frequency is required when salary is entered" });
  if (value.minSalary != null && value.maxSalary != null && value.maxSalary < value.minSalary) context.addIssue({ code: "custom", path: ["maxSalary"], message: "Maximum salary must be greater than or equal to minimum salary" });
});
