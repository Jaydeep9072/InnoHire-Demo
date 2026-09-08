import { Buffer } from "node:buffer";

export function screeningResume(value: string): string | Buffer {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("A resume is required to generate resume-based questions.");
  const dataUrl = /^data:application\/pdf(?:;[^,]*)?;base64,([\s\S]*)$/i.exec(trimmed);
  const encoded = (dataUrl?.[1] ?? trimmed).replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const pdf = Buffer.from(encoded, "base64");
  if (pdf.subarray(0, 5).toString("ascii") === "%PDF-") {
    if (pdf.length > 3 * 1024 * 1024) throw new Error("The resume exceeds the 3 MB screening limit.");
    return pdf;
  }
  if (dataUrl || /^data:/i.test(trimmed) || /^[A-Za-z0-9+/=_-]+$/.test(trimmed)) {
    throw new Error("The stored resume could not be read. Upload a valid PDF resume before screening.");
  }
  if (trimmed.length > 100_000) throw new Error("The resume text is too long to screen. Upload a shorter resume.");
  return trimmed;
}
