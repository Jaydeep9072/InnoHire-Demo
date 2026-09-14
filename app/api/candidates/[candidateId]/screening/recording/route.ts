import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getLatestOrdsScreening } from "@/lib/ords/client";
import { confirmRecordingSpeakers, processRecordingRecord, startRecordingWorkflow, workflowFromRecord } from "@/lib/screening/recording-workflow";
import { publicRecordingStatus } from "@/lib/screening/recording";

export const runtime = "nodejs";
export const maxDuration = 120;
const headers = { "cache-control": "private, no-store" };
function candidateIdFrom(value: string) { const id = Number(value); return Number.isSafeInteger(id) && id > 0 ? id : null }
function errorResponse(error: unknown, status = 500) { const message = error instanceof Error ? error.message : "The recording request failed."; const client = /Only \.m4a|valid M4A|between 1 byte|Save or reopen|awaiting speaker/.test(message); return NextResponse.json({ error: message }, { status: client ? 422 : status, headers }); }

export async function GET(_: Request, { params }: { params: Promise<{ candidateId: string }> }) {
  const candidateId = candidateIdFrom((await params).candidateId); if (!candidateId) return NextResponse.json({ error: "Invalid candidate." }, { status: 400, headers });
  try { const record = await getLatestOrdsScreening(candidateId), stored = record && workflowFromRecord(record); if (!record || !stored) return NextResponse.json({ error: "No call recording workflow was found." }, { status: 404, headers }); const refreshable=["SUBMISSION_PENDING","SUBMISSION_UNCERTAIN","SUBMITTED","TRANSCRIBING"].includes(stored.stage); const workflow=refreshable?await processRecordingRecord(record,randomUUID(),false):stored; return NextResponse.json({ recording: publicRecordingStatus(workflow) }, { headers }); }
  catch (error) { return errorResponse(error) }
}
export async function POST(request: Request, { params }: { params: Promise<{ candidateId: string }> }) {
  const candidateId = candidateIdFrom((await params).candidateId); if (!candidateId) return NextResponse.json({ error: "Invalid candidate." }, { status: 400, headers });
  try { const form = await request.formData(), file = form.get("recording"), screeningId = Number(form.get("screeningId")); if (!(file instanceof File)) return NextResponse.json({ error: "Choose an M4A call recording." }, { status: 400, headers }); if (!Number.isSafeInteger(screeningId) || screeningId <= 0) return NextResponse.json({ error: "Save or reopen the screening before uploading a recording." }, { status: 422, headers }); const workflow = await startRecordingWorkflow(candidateId, screeningId, file); return NextResponse.json({ recording: publicRecordingStatus(workflow), statusUrl: `/api/candidates/${candidateId}/screening/recording` }, { status: 202, headers }); }
  catch (error) { return errorResponse(error) }
}
export async function PATCH(request: Request, { params }: { params: Promise<{ candidateId: string }> }) {
  const candidateId = candidateIdFrom((await params).candidateId); if (!candidateId) return NextResponse.json({ error: "Invalid candidate." }, { status: 400, headers });
  try { const body = await request.json() as { screeningId?: unknown; action?: unknown }; const screeningId = Number(body.screeningId); if (!Number.isSafeInteger(screeningId) || screeningId <= 0) return NextResponse.json({ error: "Invalid screening." }, { status: 400, headers }); if (body.action !== "confirm-speakers" && body.action !== "swap-and-confirm-speakers") return NextResponse.json({ error: "Invalid speaker review action." }, { status: 400, headers }); const workflow = await confirmRecordingSpeakers(candidateId, screeningId, body.action === "swap-and-confirm-speakers"); return NextResponse.json({ recording: publicRecordingStatus(workflow), message: "Speaker roles confirmed. Recording analysis is queued." }, { status: 202, headers }); }
  catch (error) { return errorResponse(error) }
}
