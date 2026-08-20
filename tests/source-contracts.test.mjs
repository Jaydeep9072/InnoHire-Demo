import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Oracle inserts use the required table sequences", async () => {
  const [jobs, candidates] = await Promise.all([
    readFile(new URL("lib/oracle/jobs.ts", root), "utf8"),
    readFile(new URL("lib/oracle/candidates.ts", root), "utf8"),
  ]);
  assert.match(jobs, /job_postings_seq\.nextval/i);
  assert.match(candidates, /job_candidates_seq\.nextval/i);
  assert.doesNotMatch(`${jobs}\n${candidates}`, /INSERT[\s\S]*?VALUES\s*\(\s*:\s*(?:id|job_posting_id|job_candidate_id)/i);
});

test("Unipile credentials stay server-side", async () => {
  const [client, form] = await Promise.all([
    readFile(new URL("lib/unipile/client.ts", root), "utf8"),
    readFile(new URL("app/jobs/new/job-form.tsx", root), "utf8"),
  ]);
  assert.match(client, /process\.env\.UNIPILE_API_KEY/);
  assert.match(client, /"x-api-key"/);
  assert.doesNotMatch(form, /UNIPILE_API_KEY|x-api-key/);
});

test("candidate matching excludes protected-characteristic inputs", async () => {
  const scoring = await readFile(new URL("lib/candidate-matching/score.ts", root), "utf8");
  assert.doesNotMatch(scoring, /\bage\b|gender|religion|ethnicity|disability|marital|photo/i);
});
