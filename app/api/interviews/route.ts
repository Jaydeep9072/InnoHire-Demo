import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { scheduleInterview } from "@/lib/interviews/scheduler";

export const runtime = "nodejs";

const schema = z.object({
  provider: z.enum(["google", "teams", "zoom"]),
  candidateName: z.string().trim().min(1).max(500),
  candidateEmail: z.string().trim().email().max(500),
  jobTitle: z.string().trim().min(1).max(500),
  startAt: z.string().datetime(),
});

export async function POST(request: Request) {
  try { return NextResponse.json(await scheduleInterview(schema.parse(await request.json()))); }
  catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: "Enter a valid candidate email, date, time, and meeting provider." }, { status: 400 });
    console.error("Interview scheduling failed", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json({ error: error instanceof Error ? error.message : "The interview could not be scheduled." }, { status: 500 });
  }
}
