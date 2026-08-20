import type { Metadata } from "next";
import { AllJobs } from "./all-jobs";

export const metadata: Metadata = { title: "Job Board" };

export default function JobsPage() {
  return <AllJobs />;
}
