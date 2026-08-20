import { NextResponse } from "next/server";
import { extractJobDescription } from "@/lib/ai/job-description-agent";

export const runtime = "nodejs";
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a document to upload." }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "The document must be 10 MB or smaller." }, { status: 413 });
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !["pdf", "docx", "txt"].includes(extension)) return NextResponse.json({ error: "Upload a PDF, DOCX, or TXT document." }, { status: 415 });
    const buffer = Buffer.from(await file.arrayBuffer());
    let text: string | undefined;
    if (extension === "txt") text = buffer.toString("utf8");
    if (extension === "docx") {
      const mammoth = await import("mammoth");
      text = (await mammoth.extractRawText({ buffer })).value;
    }
    const cleaned = text?.split(String.fromCharCode(0)).join("").replace(/\r\n/g, "\n").trim();
    if (extension !== "pdf" && !cleaned) return NextResponse.json({ error: "No readable text was found in this document." }, { status: 422 });
    const job = await extractJobDescription({ buffer, mimeType: extension === "pdf" ? "application/pdf" : "text/plain", fileName: file.name, text: cleaned });
    return NextResponse.json({ job, fileName: file.name, model: process.env.GEMINI_MODEL || "gemini-2.5-flash" });
  } catch (error) {
    console.error("Document extraction failed", error instanceof Error ? error.message : "Unknown error");
    const message = error instanceof Error ? error.message : "The document could not be read.";
    return NextResponse.json({ error: message }, { status: message.includes("GOOGLE_API_KEY") ? 503 : 500 });
  }
}
