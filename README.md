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

- `/jobs` — view all saved and published jobs from ORDS.
- `/jobs/new` — create drafts, extract PDF/DOCX/TXT job descriptions, and publish to Oracle Recruiting Cloud when that board is selected.
- `/candidates` — view actual candidates ranked by an explainable score.
- `/reports` — view ORDS-derived metrics and export the filtered job report as CSV.
- `/apply/{token}` — public, job-specific candidate application form used as the external LinkedIn apply URL.

## Candidate ingestion

Send validated applicant data to `POST /api/candidates` with the `x-ingestion-secret` header. Its value must match `CANDIDATE_INGESTION_SECRET`. An existing `externalApplicationId` for the same job is updated at the application layer.

Candidate-facing forms submit through `/api/applications/{token}`. The server resolves the job from its stored `apply_url` and calls ORDS without exposing the ingestion secret. Résumés are accepted as PDF files up to 3 MB, stored as base64 in the candidate `resume_text` CLOB, and decoded by `/api/candidates/{candidateId}/resume` when HR opens the résumé.

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
