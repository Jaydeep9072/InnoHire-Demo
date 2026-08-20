import type { Metadata } from "next";
import { CandidatePipeline } from "./candidate-pipeline";

export const metadata: Metadata = { title: "Candidates", description: "Review candidates ranked against each job description." };
export default function CandidatesPage() { return <CandidatePipeline />; }
