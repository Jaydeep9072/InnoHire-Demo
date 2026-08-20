import { randomUUID } from "node:crypto";
import type { OrdsJob } from "@/lib/ords/client";

function withProtocol(value: string) {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

export function applicationBaseUrl(requestOrigin?: string) {
  const configured = process.env.APPLICATION_BASE_URL
    || process.env.VERCEL_PROJECT_PRODUCTION_URL
    || process.env.VERCEL_URL
    || requestOrigin;
  if (!configured) throw new Error("APPLICATION_BASE_URL is not configured.");
  return withProtocol(configured).replace(/\/$/, "");
}

export function createApplicationUrl(requestOrigin?: string) {
  return `${applicationBaseUrl(requestOrigin)}/apply/${randomUUID()}`;
}

export function createJobApplicationUrl(jobId: number, requestOrigin?: string) {
  if (!Number.isInteger(jobId) || jobId <= 0) throw new Error("A valid job ID is required to create an application URL.");
  return `${applicationBaseUrl(requestOrigin)}/apply/job-${jobId}`;
}

export function applicationToken(value: string) {
  const token = value.trim();
  return /^[A-Za-z0-9_-]{20,128}$/.test(token) ? token : null;
}

export function findJobByApplicationToken(jobs: OrdsJob[], token: string) {
  const safeToken = applicationToken(token);
  if (!safeToken) return null;
  const jobToken = /^job-(\d+)$/.exec(safeToken);
  if (jobToken) {
    const jobId = Number(jobToken[1]);
    return jobs.find((job) => {
      const status = (job.posting_status || "").toUpperCase();
      return job.job_posting_id === jobId && (status === "DRAFT" || status === "PUBLISHED");
    }) || null;
  }
  return jobs.find((job) => {
    if (!job.apply_url) return false;
    const status = (job.posting_status || "").toUpperCase();
    if (status !== "DRAFT" && status !== "PUBLISHED") return false;
    try {
      const segments = new URL(job.apply_url).pathname.split("/").filter(Boolean);
      return segments.at(-1) === safeToken && segments.at(-2) === "apply";
    } catch { return false; }
  }) || null;
}
