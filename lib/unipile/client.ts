import type { JobInput } from "@/types/domain";
import { sanitizeRichText } from "@/lib/rich-text";

const DEFAULT_BASE_URL = "https://api60.unipile.com:19041";

export class UnipileError extends Error {
  constructor(message: string, public status: number, public details?: unknown) { super(message); }
}

function configuration() {
  const apiKey = process.env.UNIPILE_API_KEY;
  const accountId = process.env.UNIPILE_ACCOUNT_ID;
  if (!apiKey || !accountId) throw new UnipileError("Unipile credentials are not configured.", 503);
  return { baseUrl: (process.env.UNIPILE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ""), apiKey, accountId };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!);
}

function description(input: JobInput) {
  const richBlock = (heading: string, value: string) => value.trim() ? `<p><strong>${heading}</strong></p>${sanitizeRichText(value)}` : "";
  const textBlock = (heading: string, value: string) => value.trim() ? `<p><strong>${heading}</strong></p><p>${escapeHtml(value).replace(/\n/g, "<br>")}</p>` : "";
  const minimum = input.minSalary == null ? "" : new Intl.NumberFormat("en-US").format(input.minSalary);
  const maximum = input.maxSalary == null ? "" : new Intl.NumberFormat("en-US").format(input.maxSalary);
  const salaryRange = minimum && maximum ? `${minimum} - ${maximum}` : minimum || maximum;
  const compensation = [salaryRange, input.currency, input.payFrequency ? `per ${input.payFrequency.toLowerCase().replace("ly", "")}` : ""].filter(Boolean).join(" ");
  return [richBlock("About the role", input.jobDescription), richBlock("Responsibilities", input.responsibilities), textBlock("Required skills", input.requiredSkills), textBlock("Preferred skills", input.preferredSkills), textBlock("Compensation", compensation)].join("");
}

function providerErrorMessage(payload: unknown) {
  if (typeof payload === "string") return payload.trim();
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  const messages = ["message", "detail", "title", "error", "reason", "code", "type"]
    .map((key) => record[key])
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
  return [...new Set(messages)].join(" — ");
}

async function request(path: string, body: unknown, method: "POST" | "PATCH" = "POST") {
  const { baseUrl, apiKey } = configuration();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${baseUrl}${path}`, { method, headers: { "content-type": "application/json", accept: "application/json", "x-api-key": apiKey }, body: JSON.stringify(body), signal: controller.signal });
    const raw = await response.text();
    let parsed: unknown = raw;
    try { parsed = raw ? JSON.parse(raw) : null; } catch { /* Retain non-JSON error details. */ }
    if (!response.ok) {
      const providerMessage = providerErrorMessage(parsed);
      throw new UnipileError(`Unipile request failed (${response.status}${response.statusText ? ` ${response.statusText}` : ""})${providerMessage ? `: ${providerMessage}` : "."}`, response.status, parsed);
    }
    return parsed;
  } catch (error) {
    if (error instanceof UnipileError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new UnipileError("Unipile request timed out.", 504);
    throw new UnipileError(`Unable to reach Unipile${error instanceof Error && error.message ? `: ${error.message}` : "."}`, 502);
  } finally { clearTimeout(timer); }
}

function externalId(response: unknown) {
  if (!response || typeof response !== "object") return null;
  const record = response as Record<string, unknown>;
  for (const key of ["id", "job_id", "draft_id"]) if (typeof record[key] === "string" && record[key]) return record[key] as string;
  return null;
}

export async function createLinkedInJob(input: JobInput) {
  const { accountId } = configuration();
  const payload = {
    account_id: accountId,
    job_title: { ...(input.linkedinJobTitleId ? { id: input.linkedinJobTitleId } : {}), text: input.title },
    company: { id: input.linkedinCompanyId },
    workplace: input.workplaceType,
    location: input.linkedinLocationId,
    employment_status: input.employmentType,
    description: description(input),
    apply_method: input.applyUrl
      ? { type: "external", url: input.applyUrl }
      : { type: "linkedin", notification_email: input.notificationEmail },
  };
  const response = await request("/api/v1/linkedin/jobs", payload);
  const id = externalId(response);
  if (!id) throw new UnipileError("Unipile created the draft but did not return a recognizable job ID.", 502, response);
  return { id, response };
}

export async function publishLinkedInJob(jobId: string) {
  const { accountId } = configuration();
  return request(`/api/v1/linkedin/jobs/${encodeURIComponent(jobId)}/publish`, { account_id: accountId, mode: "FREE" });
}

export async function updateLinkedInJobApplicationUrl(jobId: string, applyUrl: string) {
  const { accountId } = configuration();
  return request(`/api/v1/linkedin/jobs/${encodeURIComponent(jobId)}`, {
    account_id: accountId,
    apply_method: { type: "external", url: applyUrl },
  }, "PATCH");
}

export async function closeLinkedInJob(jobId: string) {
  const { accountId } = configuration();
  const query = new URLSearchParams({ account_id: accountId, service: "CLASSIC" });
  return request(`/api/v1/linkedin/jobs/${encodeURIComponent(jobId)}/close?${query}`, {});
}
