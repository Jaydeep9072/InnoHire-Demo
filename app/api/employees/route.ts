import { NextResponse } from "next/server";
import { listOrdsEmployees, OrdsError } from "@/lib/ords/client";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ employees: await listOrdsEmployees() });
  } catch (error) {
    if (error instanceof OrdsError) console.error("ORDS employees lookup failed", { status: error.status, message: error.message, details: error.details });
    else console.error("Employees lookup failed", error);
    return NextResponse.json({ error: "The employee list could not be loaded right now." }, { status: 502 });
  }
}
