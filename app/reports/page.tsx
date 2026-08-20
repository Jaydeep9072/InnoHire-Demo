import type { Metadata } from "next";
import { ReportsDashboard } from "./reports-dashboard";

export const metadata: Metadata = { title: "Reports", description: "Track job, applicant, and candidate-match outcomes." };
export default function ReportsPage() { return <ReportsDashboard />; }
