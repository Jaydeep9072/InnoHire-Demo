# InnoHire

InnoHire is a three-screen recruitment operations application for creating and publishing LinkedIn jobs, ranking applicants against the job description, and reporting on hiring activity.

## Run locally

1. Use Node.js 22.13 or later.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env.local` and add the ORDS and Unipile values.
4. Start the application with `npm run dev`.
5. Open `http://localhost:3000`.

The application displays configuration and empty states when credentials are absent. It never substitutes sample records.

## Main routes

- `/jobs` — view all saved and published jobs from ORDS.
- `/jobs/new` — create drafts, extract PDF/DOCX/TXT job descriptions, and publish to LinkedIn through Unipile.
- `/candidates` — view actual candidates ranked by an explainable score.
- `/reports` — view ORDS-derived metrics and export the filtered job report as CSV.
- `/apply/{token}` — public, job-specific candidate application form used as the external LinkedIn apply URL.

## Candidate ingestion

Send validated applicant data to `POST /api/candidates` with the `x-ingestion-secret` header. Its value must match `CANDIDATE_INGESTION_SECRET`. An existing `externalApplicationId` for the same job is updated at the application layer.

Candidate-facing forms submit through `/api/applications/{token}`. The server resolves the job from its stored `apply_url` and calls ORDS without exposing the ingestion secret. Résumés are accepted as PDF files up to 3 MB, stored as base64 in the candidate `resume_text` CLOB, and decoded by `/api/candidates/{candidateId}/resume` when HR opens the résumé.

## ORDS integration

The application reads jobs from `/jobs`, candidates from `/candidate`, and the candidate-page job list from `/jobs_title_lov`. Job and candidate submissions are sent through the corresponding ORDS POST endpoints.

Set `APPLICATION_BASE_URL` to the public deployment origin, for example the production Vercel domain. Job creation generates a unique `/apply/{token}` URL and sends it to ORDS as `apply_url`.
