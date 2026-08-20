import type { Metadata } from "next";
import { JobForm } from "./job-form";

export const metadata: Metadata = { title: "Post a job", description: "Create a job and publish it to LinkedIn." };
export default function NewJobPage() { return <JobForm />; }
