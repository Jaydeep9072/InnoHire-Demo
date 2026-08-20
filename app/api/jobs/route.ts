import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { createOrdsJob, listOrdsCandidates, listOrdsJobs, OrdsError, ordsJobToInput } from "@/lib/ords/client";
import { jobDraftSchema, publishJobSchema } from "@/lib/validation/job";
import { createApplicationUrl } from "@/lib/applications/urls";
import { closeLinkedInJob, createLinkedInJob, publishLinkedInJob, UnipileError } from "@/lib/unipile/client";

export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof ZodError) return NextResponse.json({ error: "Please correct the highlighted fields.", fields: error.flatten().fieldErrors }, { status: 400 });
  if (error instanceof OrdsError) return NextResponse.json({ error: error.message, details: error.details }, { status: error.status });
  if (error instanceof UnipileError) return NextResponse.json({ error: error.message, details: error.details }, { status: error.status });
  console.error("Job operation failed", error instanceof Error ? error.message : "Unknown error");
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
    const enriched = jobs.map((job) => ({ ...job, applicant_count: counts.get(job.job_posting_id) || 0 }));
    if (jobId) return enriched[0] ? NextResponse.json({ configured: true, job: enriched[0] }) : NextResponse.json({ error: "Job not found." }, { status: 404 });
    return NextResponse.json({ configured: true, jobs: enriched });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const action = payload.action === "submit" ? "submit" : payload.action === "publish" ? "publish" : payload.action === "close" ? "close" : "draft";
    if (action === "close") {
      const jobId = Number(payload.jobId);
      if (!Number.isInteger(jobId) || jobId <= 0) return NextResponse.json({ error: "Enter a valid job ID." }, { status: 400 });
      const existing = (await listOrdsJobs(jobId))[0];
      if (!existing) return NextResponse.json({ error: "Job not found." }, { status: 404 });
      if (existing.posting_status === "CLOSED") return NextResponse.json({ jobId, status: "CLOSED", message: "Job is already closed." });
      if (existing.posting_status !== "PUBLISHED") return NextResponse.json({ error: "Only a published job can be closed." }, { status: 409 });
      if (!existing.external_job_id) return NextResponse.json({ error: "The LinkedIn job ID is unavailable." }, { status: 409 });
      await closeLinkedInJob(existing.external_job_id);
      const update = await createOrdsJob(ordsJobToInput(existing), { externalJobId: existing.external_job_id, postingStatus: "CLOSED", publishedAt: existing.published_at });
      if (update.response_status && update.response_status.toUpperCase() !== "SUCCESS") throw new OrdsError(update.response_message || "LinkedIn closed the job, but ORDS did not update its status.", 502, update);
      return NextResponse.json({ jobId, status: "CLOSED", message: "Job closed on LinkedIn successfully." });
    }
    if (action === "publish") {
      const jobId = Number(payload.jobId);
      if (!Number.isInteger(jobId) || jobId <= 0) return NextResponse.json({ error: "Enter a valid job ID." }, { status: 400 });
      const existing = (await listOrdsJobs(jobId))[0];
      if (!existing) return NextResponse.json({ error: "Job not found." }, { status: 404 });
      if (existing.posting_status === "PUBLISHED") return NextResponse.json({ jobId, status: "PUBLISHED", message: "Job is already published." });
      if (!existing.external_job_id) return NextResponse.json({ error: "Create the LinkedIn draft before publishing this job." }, { status: 409 });
      try {
        await publishLinkedInJob(existing.external_job_id);
        const update = await createOrdsJob(ordsJobToInput(existing), { externalJobId: existing.external_job_id, postingStatus: "PUBLISHED", publishedAt: new Date().toISOString() });
        if (update.response_status && update.response_status.toUpperCase() !== "SUCCESS") throw new OrdsError(update.response_message || "ORDS did not update the job.", 502, update);
        return NextResponse.json({ jobId, status: "PUBLISHED", message: "Job published to LinkedIn successfully." });
      } catch (error) {
        try { await createOrdsJob(ordsJobToInput(existing), { externalJobId: existing.external_job_id, postingStatus: "DRAFT", publishError: error instanceof Error ? error.message : "LinkedIn publishing failed." }); } catch { /* Preserve the original error. */ }
        throw error;
      }
    }
    const parsedJob = (action === "submit" ? publishJobSchema : jobDraftSchema).parse(payload.job);
    const generatedApplyUrl = !parsedJob.applyUrl;
    const job = { ...parsedJob, applyUrl: parsedJob.applyUrl || createApplicationUrl(request.nextUrl.origin) };
    let externalJobId: string | null = null;
    if (action === "submit" && job.jobBoards.includes("LinkedIn")) externalJobId = (await createLinkedInJob(job)).id;
    const result = await createOrdsJob(job, { externalJobId, postingStatus: "DRAFT" });
    if (result.response_status && result.response_status.toUpperCase() !== "SUCCESS") throw new OrdsError(result.response_message || "ORDS did not create the job.", 502, result);
    const jobId = Number(result.job_posting_id);
    if (generatedApplyUrl && Number.isFinite(jobId) && jobId > 0) {
      const applyUrlUpdate = await createOrdsJob({ ...job, localJobId: jobId }, { externalJobId, postingStatus: "DRAFT" });
      if (applyUrlUpdate.response_status && applyUrlUpdate.response_status.toUpperCase() !== "SUCCESS") throw new OrdsError(applyUrlUpdate.response_message || "The job was created, but ORDS did not save its application URL.", 502, applyUrlUpdate);
    }
    return NextResponse.json({
      jobId: Number.isFinite(jobId) ? jobId : result.job_posting_id,
      applyUrl: job.applyUrl,
      externalJobId,
      status: "DRAFT",
      message: externalJobId ? "LinkedIn draft created and saved successfully." : (result.response_message || "Job posting created successfully."),
    });
  } catch (error) { return errorResponse(error); }
}
