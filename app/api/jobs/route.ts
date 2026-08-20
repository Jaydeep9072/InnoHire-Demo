import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { createOrdsJob, listOrdsCandidates, listOrdsJobs, OrdsError, ordsJobToInput } from "@/lib/ords/client";
import { jobDraftSchema, publishJobSchema } from "@/lib/validation/job";
import { createJobApplicationUrl } from "@/lib/applications/urls";

export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof ZodError) return NextResponse.json({ error: "Please correct the highlighted fields.", fields: error.flatten().fieldErrors }, { status: 400 });
  if (error instanceof OrdsError) {
    console.error("ORDS job operation failed", { message: error.message, status: error.status, details: error.details });
    return NextResponse.json({ error: "We could not save or retrieve the job information right now. Please try again." }, { status: error.status });
  }
  console.error("Job operation failed", error);
  return NextResponse.json({ error: "The job could not be saved. Please try again." }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const rawId = request.nextUrl.searchParams.get("id") || request.nextUrl.searchParams.get("job_posting_id");
    const jobId = rawId ? Number(rawId) : undefined;
    if (rawId && (!Number.isInteger(jobId) || Number(jobId) <= 0)) return NextResponse.json({ error: "Enter a valid job ID." }, { status: 400 });
    const [jobs, candidates] = await Promise.all([listOrdsJobs(jobId), listOrdsCandidates()]);
    const counts = new Map<number, number>();
    for (const candidate of candidates) counts.set(candidate.job_posting_id, (counts.get(candidate.job_posting_id) || 0) + 1);
    const enriched = jobs.map((job) => ({ ...job, apply_url: job.apply_url || createJobApplicationUrl(job.job_posting_id, request.nextUrl.origin), applicant_count: counts.get(job.job_posting_id) || 0 }));
    if (jobId) return enriched[0] ? NextResponse.json({ configured: true, job: enriched[0] }) : NextResponse.json({ error: "Job not found." }, { status: 404 });
    return NextResponse.json({ configured: true, jobs: enriched });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const action = payload.action === "submit" ? "submit" : payload.action === "publish" ? "publish" : payload.action === "close" ? "close" : payload.action === "application_page" ? "application_page" : "draft";
    if (action === "application_page") {
      const jobId = Number(payload.jobId);
      if (!Number.isInteger(jobId) || jobId <= 0) return NextResponse.json({ error: "Enter a valid job ID." }, { status: 400 });
      const existing = (await listOrdsJobs(jobId))[0];
      if (!existing) return NextResponse.json({ error: "Job not found." }, { status: 404 });
      const status = (existing.posting_status || "").toUpperCase();
      if (status !== "DRAFT" && status !== "PUBLISHED") return NextResponse.json({ error: "Application pages can only be created for draft or published jobs." }, { status: 409 });
      if (existing.apply_url) return NextResponse.json({ jobId, applyUrl: existing.apply_url, message: "The candidate application page is ready." });

      const applyUrl = createJobApplicationUrl(jobId, request.nextUrl.origin);
      const update = await createOrdsJob({ ...ordsJobToInput(existing), applyUrl }, { externalJobId: existing.external_job_id, postingStatus: status, publishedAt: existing.published_at });
      if (update.response_status && update.response_status.toUpperCase() !== "SUCCESS") throw new OrdsError(update.response_message || "The candidate application page could not be saved.", 502, update);
      const savedJob = (await listOrdsJobs(jobId))[0];
      if (savedJob?.apply_url !== applyUrl) console.warn("ORDS did not persist apply_url; the job-based application URL fallback remains active.", { job_posting_id: jobId, expected_apply_url: applyUrl });

      // Unipile LinkedIn synchronization is intentionally paused. ORDS owns the application URL for now.
      return NextResponse.json(update);
    }
    if (action === "close") {
      const jobId = Number(payload.jobId);
      if (!Number.isInteger(jobId) || jobId <= 0) return NextResponse.json({ error: "Enter a valid job ID." }, { status: 400 });
      const existing = (await listOrdsJobs(jobId))[0];
      if (!existing) return NextResponse.json({ error: "Job not found." }, { status: 404 });
      if (existing.posting_status === "CLOSED") return NextResponse.json({ jobId, status: "CLOSED", message: "Job is already closed." });
      if (existing.posting_status !== "PUBLISHED") return NextResponse.json({ error: "Only a published job can be closed." }, { status: 409 });
      // Unipile LinkedIn closing is intentionally paused. Update the local ORDS lifecycle only.
      const update = await createOrdsJob(ordsJobToInput(existing), { externalJobId: existing.external_job_id, postingStatus: "CLOSED", publishedAt: existing.published_at });
      if (update.response_status && update.response_status.toUpperCase() !== "SUCCESS") throw new OrdsError(update.response_message || "ORDS did not close the job.", 502, update);
      return NextResponse.json(update);
    }
    if (action === "publish") {
      const jobId = Number(payload.jobId);
      if (!Number.isInteger(jobId) || jobId <= 0) return NextResponse.json({ error: "Enter a valid job ID." }, { status: 400 });
      const existing = (await listOrdsJobs(jobId))[0];
      if (!existing) return NextResponse.json({ error: "Job not found." }, { status: 404 });
      if (existing.posting_status === "PUBLISHED") return NextResponse.json({ jobId, status: "PUBLISHED", message: "Job is already published." });
      const applyUrl = existing.apply_url || createJobApplicationUrl(jobId, request.nextUrl.origin);
      // Unipile LinkedIn publishing is intentionally paused. Update the local ORDS lifecycle only.
      const update = await createOrdsJob({ ...ordsJobToInput(existing), applyUrl }, { externalJobId: existing.external_job_id, postingStatus: "PUBLISHED", publishedAt: new Date().toISOString() });
      if (update.response_status && update.response_status.toUpperCase() !== "SUCCESS") throw new OrdsError(update.response_message || "ORDS did not publish the job.", 502, update);
      return NextResponse.json(update);
    }
    const parsedJob = (action === "submit" ? publishJobSchema : jobDraftSchema).parse(payload.job);
    const generatedApplyUrl = !parsedJob.applyUrl;
    const result = await createOrdsJob(parsedJob, { externalJobId: null, postingStatus: "DRAFT" });
    if (result.response_status && result.response_status.toUpperCase() !== "SUCCESS") throw new OrdsError(result.response_message || "ORDS did not create the job.", 502, result);
    const jobId = Number(result.job_posting_id);
    if (!Number.isFinite(jobId) || jobId <= 0) throw new OrdsError("ORDS created the job but did not return its ID.", 502, result);
    const applyUrl = parsedJob.applyUrl || createJobApplicationUrl(jobId, request.nextUrl.origin);
    const job = { ...parsedJob, applyUrl };
    if (generatedApplyUrl) {
      const applyUrlUpdate = await createOrdsJob({ ...job, localJobId: jobId }, { externalJobId: null, postingStatus: "DRAFT" });
      if (applyUrlUpdate.response_status && applyUrlUpdate.response_status.toUpperCase() !== "SUCCESS") throw new OrdsError(applyUrlUpdate.response_message || "The job was created, but ORDS did not save its application URL.", 502, applyUrlUpdate);
    }
    const savedJob = (await listOrdsJobs(jobId))[0];
    if (!savedJob || savedJob.apply_url !== applyUrl) console.warn("ORDS did not persist apply_url; the job-based application URL fallback remains active.", { job_posting_id: jobId, expected_apply_url: applyUrl });

    // Unipile LinkedIn draft creation is intentionally paused. The job and apply URL are stored in ORDS only.
    return NextResponse.json(result);
  } catch (error) { return errorResponse(error); }
}
