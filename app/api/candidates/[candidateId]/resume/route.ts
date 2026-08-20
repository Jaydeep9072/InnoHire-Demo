import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";
import { getOrdsCandidateResume, OrdsError } from "@/lib/ords/client";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ candidateId: string }> }) {
  try {
    const candidateId = Number((await params).candidateId);
    if (!Number.isInteger(candidateId) || candidateId <= 0) return NextResponse.json({ error: "Invalid candidate." }, { status: 400 });
    const encoded = await getOrdsCandidateResume(candidateId);
    if (!encoded) return NextResponse.json({ error: "A résumé is not available for this candidate." }, { status: 404 });
    const pdf = Buffer.from(encoded, "base64");
    if (!pdf.length || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") return NextResponse.json({ error: "The stored résumé is not a valid PDF." }, { status: 422 });
    return new NextResponse(pdf, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="candidate-${candidateId}-resume.pdf"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (error) {
    if (error instanceof OrdsError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "The résumé could not be opened." }, { status: 500 });
  }
}
