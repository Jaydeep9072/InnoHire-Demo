import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { createOrdsJob, listOrdsCandidates, listOrdsJobs, OrdsError, ordsJobToInput } from "@/lib/ords/client";
import { jobDraftSchema, publishJobSchema } from "@/lib/validation/job";
import { createApplicationUrl } from "@/lib/applications/urls";
import { closeLinkedInJob, createLinkedInJob, publishLinkedInJob, UnipileError, updateLinkedInJobApplicationUrl } from "@/lib/unipile/client";

export const runtime = "nodejs";

function providerDetail(details: unknown) {
  if (!details || typeof details !== "object") return "";
  const record = details as Record<string, unknown>;
  const detail = [record.detail, record.message, record.title].find((value) => typeof value === "string" && value.trim().length > 0);
  if (typeof detail !== "string" || detail.length > 240 || ["{", "}", "[", "]", "<", ">"].some((character) => detail.includes(character))) return "";
  return detail.replaceAll("_", " ").trim();
}

function linkedInClientError(error: UnipileError) {
  const detail = providerDetail(error.details);
  if (error.message.includes("credentials are not configured")) return "LinkedIn publishing has not been configured yet. Please contact your administrator.";
  if (error.status === 401) return "The LinkedIn connection has expired. Please reconnect the LinkedIn account and try again.";
  if (error.status === 403) return "The connected LinkedIn account does not have permission to perform this action.";
  if (error.status === 404) return "LinkedIn could not find the requested job or connected account.";
  if (error.status === 422) return detail ? `LinkedIn could not accept this job: ${detail}` : "LinkedIn could not accept some of the job information. Please review the LinkedIn fields and try again.";
  if (error.status === 429) return "LinkedIn is receiving too many requests. Please wait a moment and try again.";
  if (error.status >= 500) return "LinkedIn is temporarily unavailable. Please try again shortly.";
  return detail ? `LinkedIn could not complete this action: ${detail}` : "LinkedIn could not complete this action. Please try again.";
}

function errorResponse(error: unknown) {
  if (error instanceof ZodError) return NextResponse.json({ error: "Please correct the highlighted fields.", fields: error.flatten().fieldErrors }, { status: 400 });
  if (error instanceof OrdsError) {
    console.error("ORDS job operation failed", { message: error.message, status: error.status, details: error.details });
    return NextResponse.json({ error: "We could not save or retrieve the job information right now. Please try again." }, { status: error.status });
  }
  if (error instanceof UnipileError) {
    console.error("Unipile job operation failed", { message: error.message, status: error.status, details: error.details });
    return NextResponse.json({ error: linkedInClientError(error) }, { status: error.status });
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
    const enriched = jobs.map((job) => ({ ...job, applicant_count: counts.get(job.job_posting_id) || 0 }));
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

      const applyUrl = createApplicationUrl(request.nextUrl.origin);
      const update = await createOrdsJob({ ...ordsJobToInput(existing), applyUrl }, { externalJobId: existing.external_job_id, postingStatus: status, publishedAt: existing.published_at });
      if (update.response_status && update.response_status.toUpperCase() !== "SUCCESS") throw new OrdsError(update.response_message || "The candidate application page could not be saved.", 502, update);
      const savedJob = (await listOrdsJobs(jobId))[0];
      if (savedJob?.apply_url !== applyUrl) throw new OrdsError("ORDS did not persist the generated apply_url.", 502, { job_posting_id: jobId, expected_apply_url: applyUrl, saved_apply_url: savedJob?.apply_url ?? null });

      let linkedInWarning: string | null = null;
      if (existing.external_job_id) {
        try {
          await updateLinkedInJobApplicationUrl(existing.external_job_id, applyUrl);
        } catch (error) {
          linkedInWarning = error instanceof UnipileError ? linkedInClientError(error) : "The application page was created, but LinkedIn could not be updated.";
          console.error("LinkedIn application URL update failed after ORDS save", error);
          try { await createOrdsJob({ ...ordsJobToInput(existing), applyUrl }, { externalJobId: existing.external_job_id, postingStatus: status, publishedAt: existing.published_at, publishError: linkedInWarning }); } catch (saveError) { console.error("Could not save the LinkedIn warning", saveError); }
        }
      }
      return NextResponse.json({ jobId, applyUrl, linkedInWarning, message: linkedInWarning ? `Candidate application page created. ${linkedInWarning}` : "Candidate application page created successfully." });
    }
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
    const result = await createOrdsJob(job, { externalJobId: null, postingStatus: "DRAFT" });
    if (result.response_status && result.response_status.toUpperCase() !== "SUCCESS") throw new OrdsError(result.response_message || "ORDS did not create the job.", 502, result);
    const jobId = Number(result.job_posting_id);
    if (!Number.isFinite(jobId) || jobId <= 0) throw new OrdsError("ORDS created the job but did not return its ID.", 502, result);
    if (generatedApplyUrl && Number.isFinite(jobId) && jobId > 0) {
      const applyUrlUpdate = await createOrdsJob({ ...job, localJobId: jobId }, { externalJobId: null, postingStatus: "DRAFT" });
      if (applyUrlUpdate.response_status && applyUrlUpdate.response_status.toUpperCase() !== "SUCCESS") throw new OrdsError(applyUrlUpdate.response_message || "The job was created, but ORDS did not save its application URL.", 502, applyUrlUpdate);
    }
    if (Number.isFinite(jobId) && jobId > 0) {
      const savedJob = (await listOrdsJobs(jobId))[0];
      if (!savedJob || savedJob.apply_url !== job.applyUrl) {
        throw new OrdsError("The job was created, but ORDS did not persist the generated apply_url.", 502, { job_posting_id: jobId, expected_apply_url: job.applyUrl, saved_apply_url: savedJob?.apply_url ?? null });
      }
    }

    let externalJobId: string | null = null;
    let linkedInWarning: string | null = null;
    if (action === "submit" && job.jobBoards.includes("LinkedIn")) {
      try {
        externalJobId = (await createLinkedInJob(job)).id;
      } catch (error) {
        linkedInWarning = error instanceof UnipileError ? linkedInClientError(error) : "The job was saved, but LinkedIn could not create the job draft.";
        console.error("LinkedIn draft creation failed after ORDS save", error);
        try { await createOrdsJob({ ...job, localJobId: jobId }, { externalJobId: null, postingStatus: "DRAFT", publishError: linkedInWarning }); } catch (saveError) { console.error("Could not save the LinkedIn warning", saveError); }
      }
    }
    if (externalJobId) {
      const linkedInUpdate = await createOrdsJob({ ...job, localJobId: jobId }, { externalJobId, postingStatus: "DRAFT" });
      if (linkedInUpdate.response_status && linkedInUpdate.response_status.toUpperCase() !== "SUCCESS") throw new OrdsError(linkedInUpdate.response_message || "The LinkedIn draft was created, but the job record could not be updated.", 502, linkedInUpdate);
    }
    return NextResponse.json({
      jobId,
      applyUrl: job.applyUrl,
      externalJobId,
      linkedInWarning,
      status: "DRAFT",
      message: linkedInWarning ? `Job and candidate application page saved. ${linkedInWarning}` : externalJobId ? "LinkedIn draft and candidate application page created successfully." : (result.response_message || "Job and candidate application page created successfully."),
    });
  } catch (error) { return errorResponse(error); }
}
