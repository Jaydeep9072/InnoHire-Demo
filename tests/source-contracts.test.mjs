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

test("Oracle Recruiting Cloud credentials and payload construction stay server-side", async () => {
  const [client, form, route] = await Promise.all([
    readFile(new URL("lib/oracle-recruiting/client.ts", root), "utf8"),
    readFile(new URL("app/jobs/new/job-form.tsx", root), "utf8"),
    readFile(new URL("app/api/jobs/route.ts", root), "utf8"),
  ]);
  assert.match(client, /process\.env\.ORC_USERNAME/);
  assert.match(client, /process\.env\.ORC_PASSWORD/);
  assert.match(client, /ExternalDescriptionHTML:\s*encodeHtml\(input\.jobDescription\)/);
  assert.match(client, /ExternalRespHTML:\s*encodeHtml\(input\.responsibilities\)/);
  assert.match(client, /ExternalQualHTML:\s*""/);
  assert.match(client, /MinimumYearsOfExperience:\s*input\.minimumExperience/);
  assert.match(client, /NumberOfOpenings:\s*input\.openingsCount/);
  assert.match(client, /Oracle Recruiting Cloud POST request/);
  assert.match(client, /Oracle Recruiting Cloud POST response/);
  assert.match(client, /BASE64 HTML/);
  assert.match(route, /action === "submit" && isOracleRecruitingBoardSelected\(job\.jobBoards\)/);
  assert.match(route, /Oracle requisition ORDS persistence check/);
  assert.match(route, /String\(savedJob\?\.external_job_id \|\| ""\) === externalJobId/);
  assert.doesNotMatch(form, /ORC_USERNAME|ORC_PASSWORD|authorization:\s*`Basic/);
});

test("candidate matching excludes protected-characteristic inputs", async () => {
  const scoring = await readFile(new URL("lib/candidate-matching/score.ts", root), "utf8");
  assert.doesNotMatch(scoring, /\bage\b|gender|religion|ethnicity|disability|marital|photo/i);
});

test("selected job boards use the canonical comma-separated job_boards field", async () => {
  const [ords, jobsList, jobDetail] = await Promise.all([
    readFile(new URL("lib/ords/client.ts", root), "utf8"),
    readFile(new URL("app/jobs/all-jobs.tsx", root), "utf8"),
    readFile(new URL("app/jobs/[jobId]/page.tsx", root), "utf8"),
  ]);
  assert.match(ords, /job_boards:\s*\[\.\.\.new Set\(input\.jobBoards[\s\S]*?\.join\(","\) \|\| null/);
  assert.doesNotMatch(ords, /^\s+job_board:/m);
  const channelLine = jobsList.split("\n").find((line) => line.includes('data-label="Channel"'));
  assert.ok(channelLine);
  assert.doesNotMatch(channelLine, /external_job_id|LinkedIn/);
  assert.match(jobDetail, /Detail label="External job ID"/);
});

test("Google and Microsoft meeting access tokens are acquired automatically", async () => {
  const [scheduler, exampleEnvironment] = await Promise.all([
    readFile(new URL("lib/interviews/scheduler.ts", root), "utf8"),
    readFile(new URL(".env.example", root), "utf8"),
  ]);

  assert.match(scheduler, /oauth2\.googleapis\.com\/token/);
  assert.match(scheduler, /grant_type: ['"]refresh_token['"]/);
  assert.match(scheduler, /GOOGLE_CALENDAR_REFRESH_TOKEN/);
  assert.match(scheduler, /login\.microsoftonline\.com/);
  assert.match(scheduler, /grant_type: ['"]client_credentials['"]/);
  assert.match(scheduler, /https:\/\/graph\.microsoft\.com\/\.default/);
  assert.match(scheduler, /MICROSOFT_CALENDAR_USER/);
  assert.doesNotMatch(exampleEnvironment, /GOOGLE_CALENDAR_ACCESS_TOKEN|MICROSOFT_GRAPH_ACCESS_TOKEN/);
});
