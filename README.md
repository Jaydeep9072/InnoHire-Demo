# InnoHire

InnoHire is a recruitment operations application for creating jobs, publishing selected jobs to Oracle Recruiting Cloud, ranking applicants against the job description, and reporting on hiring activity.

## Run locally

1. Use Node.js 22.13 or later.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env.local` and add the ORDS, Unipile, and Oracle Recruiting Cloud values used by your environment.
4. Start the application with `npm run dev`.
5. Open `http://localhost:3000`.

The application displays configuration and empty states when credentials are absent. It never substitutes sample records.

## Main routes

- `/jobs` - view all saved and published jobs from ORDS.
- `/jobs/new` - create drafts, extract PDF/DOCX/TXT job descriptions, and publish to Oracle Recruiting Cloud when that board is selected.
- `/candidates` - view actual candidates ranked by an explainable score.
- `/reports` - view ORDS-derived metrics and export the filtered job report as CSV.
- `/apply/{token}` - public, job-specific candidate application form used as the external LinkedIn apply URL.

## Candidate ingestion

Send validated applicant data to `POST /api/candidates` with the `x-ingestion-secret` header. Its value must match `CANDIDATE_INGESTION_SECRET`. An existing `externalApplicationId` for the same job is updated at the application layer.

Candidate-facing forms submit through `/api/applications/{token}`. The server resolves the job from its stored `apply_url` and calls ORDS without exposing the ingestion secret. Resumes are accepted as PDF files up to 3 MB, stored as base64 in the candidate `resume_text` CLOB, and decoded by `/api/candidates/{candidateId}/resume` when HR opens the resume.

## ORDS integration

The application reads jobs from `/jobs`, candidates from `/candidate`, and the candidate-page job list from `/jobs_title_lov`. Job and candidate submissions are sent through the corresponding ORDS POST endpoints.

Set `APPLICATION_BASE_URL` to the public deployment origin, for example the production Vercel domain. Job creation generates a unique `/apply/{token}` URL and sends it to ORDS as `apply_url`.

## Oracle Recruiting Cloud integration

Set the server-only `ORC_BASE_URL`, `ORC_REQUISITIONS_PATH`, `ORC_USERNAME`, and `ORC_PASSWORD` environment variables. When **Oracle Recruiting Cloud (ORC)** is selected, **Submit job** first saves the InnoHire job through ORDS and then creates the Oracle requisition. Oracle's returned requisition ID is saved as `external_job_id`; failed Oracle submissions remain recoverable InnoHire drafts.

## Interview provider authentication

Google Calendar now exchanges `GOOGLE_CALENDAR_REFRESH_TOKEN` for short-lived access tokens automatically. Complete Google consent once with offline access, then set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and `GOOGLE_CALENDAR_REFRESH_TOKEN`.

Microsoft Teams now uses the Entra client-credentials flow. Grant the app the Microsoft Graph `Calendars.ReadWrite` application permission with admin consent, then set `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, and `MICROSOFT_CALENDAR_USER` to the organizer's user ID or UPN.

Zoom continues to use Server-to-Server OAuth. All provider access tokens are acquired at runtime and cached until shortly before expiration; routine access-token copying is not required.


## Candidate screening storage

The Screening flow expects a server-side ORDS resource at `/ai_screening_analysis`: GET filters by `job_candidate_id`, and POST inserts or updates a screening record. Keep that resource authenticated because it contains candidate answers and evaluation data.

Screening answer analysis uses six job-relevant parameters: role knowledge and problem solving are weighted at 20% each; communication, evidence and ownership, collaboration, and motivation and adaptability are weighted at 15% each. The server calculates the final screening match percentage from these fixed weights.


## OCI call-recording screening

The screening dialog accepts only M4A files up to 100 MB. The server validates the file extension and ISO Base Media File Format signature, uploads the bytes directly to the private OCI input bucket, and creates one asynchronous OCI Speech job for that exact object. Each job requests JSON and SRT output with two-speaker diarization and writes to a compact attempt-specific prefix such as so/{screeningId}/{attempt}/ in the private output bucket.

The existing `ih_job_screening_analysis` record is the durable queue. `call_recording_name`, `transcription_job_id`, and `output_prefix` store searchable OCI metadata. `analyzed_call_recording_json` stores the versioned workflow state, retry token, attempts, lease, exact input/output keys, normalized transcript segments, speaker mapping, evidence references, and final assessment. The audio bytes are never stored in the application database or local filesystem.

Run [db/ih_job_screening_analysis.sql](db/ih_job_screening_analysis.sql) when creating the table. The ORDS `POST /ai_screening_analysis` handler must upsert when `screening_id` is supplied and return that ID. Its GET handler must support `job_candidate_id` filtering and a bounded `limit` query.

Set the OCI variables in `.env.example`. For local development, `OCI_AUTH_METHOD=config` uses an OCI SDK config profile. On OCI compute use `instance_principal`; on OCI Functions or another supported workload use `resource_principal`. Keep both Object Storage buckets private and apply retention rules appropriate for candidate data.

The repository includes a Vercel cron that calls `GET /api/screening-recordings/worker` every minute. Set `CRON_SECRET`; Vercel sends it as a Bearer token. On another platform, schedule the same endpoint with `Authorization: Bearer <OCI_WORKER_SECRET>`. Each invocation claims a short persisted lease and performs bounded work. UI polling only reads durable status and is not responsible for completing the job.

Grant the application principal only the compartment access it needs. Oracle documents the aggregate policies below; replace the subject and compartment placeholders with your deployment values:

```text
Allow dynamic-group <innohire-workers> to manage ai-service-speech-family in compartment <speech-compartment>
Allow dynamic-group <innohire-workers> to manage object-family in compartment <speech-compartment>
```

For a user-based local profile, replace `dynamic-group <innohire-workers>` with `group <speech-users>`. Bucket-specific IAM conditions can narrow Object Storage access further.

After Speech finishes, the worker selects the task whose input metadata contains the persisted input object key, then downloads the single JSON key reported by that task. It never scans for a globally newest object. The first diarized speaker is stored as Speaker 1 and INTERVIEWER; the second is stored as Speaker 2 and APPLICANT. The worker aligns only applicant responses to the saved questions, runs the agreed six-parameter analysis, and stores the labeled transcript, aligned answers, evidence, parameter scores, and final assessment in analyzed_call_recording_json. Missing or unasked responses remain unscored; the match percentage is normalized across assessed rubric weights and is withheld when rubric coverage is below 50 percent.
