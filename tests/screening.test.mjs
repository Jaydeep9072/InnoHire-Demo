import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
async function loadTypeScript(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  const resolved = outputText.replace('from "zod"', `from "${pathToFileURL(require.resolve("zod")).href}"`);
  return import(`data:text/javascript;base64,${Buffer.from(resolved).toString("base64")}`);
}
const { screeningResume } = await loadTypeScript("../lib/screening/resume.ts");
const { screeningSubmissionSchema, validateScreeningBank, validateScreeningAnalysis } = await loadTypeScript("../lib/screening/schema.ts");
const { normalizeStoredScreeningEntries } = await loadTypeScript("../lib/screening/ords-payload.ts");
const makeBank = (counts = { HR: 6, Resume: 2, "Job description": 2 }) => ({ questions: ["HR", "Resume", "Job description"].flatMap((category) => Array.from({ length: counts[category] }, (_, index) => ({
  category, question: `Describe a real ${category} situation number ${index + 1} and explain your actions and outcome.`, context: "Relevant source evidence",
}))) });

test("screening accepts 10 medium screening questions with four to six HR questions", () => {
  assert.equal(validateScreeningBank(makeBank({ HR: 4, Resume: 3, "Job description": 3 })).questions.length, 10);
  assert.equal(validateScreeningBank(makeBank({ HR: 5, Resume: 3, "Job description": 2 })).questions.length, 10);
  assert.equal(validateScreeningBank(makeBank()).questions.length, 10);
  assert.throws(() => validateScreeningBank(makeBank({ HR: 3, Resume: 4, "Job description": 3 })), /four to six HR/);
  assert.throws(() => validateScreeningBank(makeBank({ HR: 4, Resume: 4, "Job description": 2 })), /balanced remainder/);
  const duplicate = makeBank();
  duplicate.questions[1].question = duplicate.questions[0].question.toUpperCase() + "!";
  assert.throws(() => validateScreeningBank(duplicate), /duplicate/);
  assert.throws(() => validateScreeningBank({ questions: makeBank().questions.slice(1) }));
  const noEvidence = makeBank();
  noEvidence.questions[4].context = "";
  assert.throws(() => validateScreeningBank(noEvidence));
  const oversized = makeBank();
  oversized.questions[0].question = "Describe this screening situation clearly and concisely ".repeat(6);
  assert.throws(() => validateScreeningBank(oversized));
});

test("screening submission allows unanswered questions", () => {
  const questions = makeBank().questions.map((question, index) => ({ ...question, id: `question-${index + 1}` }));
  const parsed = screeningSubmissionSchema.parse({ questions, answers: { "question-1": "One available answer" } });
  assert.equal(parsed.answers["question-1"], "One available answer");
  assert.equal(parsed.answers["question-2"], undefined);
});
test("screening storage accepts generated and legacy ORDS question identifiers", () => {
  const generated = normalizeStoredScreeningEntries(
    JSON.stringify([{ id: "question-4", question: "Generated question", category: "HR" }]),
    JSON.stringify({ "question-4": "Generated answer" }),
  );
  assert.deepEqual(generated.questions, [{ question_id: 4, question: "Generated question", category: "HR", context: undefined }]);
  assert.deepEqual(generated.answers, [{ question_id: 4, answer: "Generated answer" }]);

  const legacy = normalizeStoredScreeningEntries(
    JSON.stringify([{ question_id: 7, question: "Stored question", category: "Resume" }]),
    JSON.stringify([{ question_id: 7, answer: "Stored answer" }]),
  );
  assert.deepEqual(legacy.questions, [{ question_id: 7, question: "Stored question", category: "Resume", context: undefined }]);
  assert.deepEqual(legacy.answers, [{ question_id: 7, answer: "Stored answer" }]);

  const missingId = normalizeStoredScreeningEntries(
    JSON.stringify([{ question: "Question without an ID" }]),
    JSON.stringify([]),
  );
  assert.equal(missingId.questions[0].question_id, 1);
  assert.equal(missingId.answers[0].answer, "");
});

test("screening reads PDF base64, data URLs, and legacy resume text", () => {
  const pdf = Buffer.from("%PDF-1.7\nScreening test");
  assert.deepEqual(screeningResume(pdf.toString("base64")), pdf);
  assert.deepEqual(screeningResume("data:application/pdf;base64," + pdf.toString("base64")), pdf);
  assert.equal(screeningResume("  Built inventory reports and improved monthly reconciliation.  "), "Built inventory reports and improved monthly reconciliation.");
});

test("screening rejects absent, corrupt, and oversized resumes", () => {
  assert.throws(() => screeningResume(" "), /resume is required/);
  assert.throws(() => screeningResume("data:application/pdf;base64,aGVsbG8="), /valid PDF/);
  assert.throws(() => screeningResume(Buffer.from("not a PDF").toString("base64")), /valid PDF/);
  assert.throws(() => screeningResume("Resume text ".repeat(10000)), /too long/);
  const large = Buffer.alloc(3 * 1024 * 1024 + 1);
  large.write("%PDF-");
  assert.throws(() => screeningResume(large.toString("base64")), /3 MB/);
});


test("screening analysis calculates the weighted match on the server", () => {
  const questionIds = Array.from({ length: 10 }, (_, index) => `question-${index + 1}`);
  const analysis = validateScreeningAnalysis({
    responseAnalyses: questionIds.map((questionId) => ({ questionId, score: 80, analysis: "The answer provides specific and relevant detail.", evidence: "A concrete action and outcome were stated." })),
    parameterScores: [
      { parameter: "Role knowledge", score: 90, rationale: "Strong role-specific knowledge." },
      { parameter: "Problem solving", score: 80, rationale: "Explains a sound approach." },
      { parameter: "Communication", score: 70, rationale: "Clear and relevant." },
      { parameter: "Evidence and ownership", score: 60, rationale: "Some specific ownership." },
      { parameter: "Collaboration", score: 50, rationale: "Limited stakeholder detail." },
      { parameter: "Motivation and adaptability", score: 40, rationale: "Some motivation and learning evidence." },
    ],
    summary: "A grounded summary for human review.",
    strengths: ["Role knowledge"],
    developmentAreas: ["Collaboration detail"],
    riskFlags: [],
    confidencePercentage: 92,
  }, questionIds);
  assert.equal(analysis.overallMatchPercentage, 67);
  assert.throws(() => validateScreeningAnalysis({ ...analysis, responseAnalyses: analysis.responseAnalyses.slice(1) }, questionIds));
});

const { normalizeOciTranscript, proposeSpeakerMapping, assignSpeakerRoles, labelSpeakerRoles, alignApplicantAnswers, canReuploadRecording, canReuseRecordingAttempt, ociSpeechFailureMessage } = await loadTypeScript("../lib/screening/recording.ts");

test("OCI transcript normalization preserves speaker and timestamp evidence", () => {
  const transcript = normalizeOciTranscript({ transcriptions: [{ tokens: [
    { token: "Describe your Oracle migration experience?", startTime: 0, endTime: 1, confidence: 0.99, speakerIndex: 0 },
    { token: "I led three migrations.", startTime: 1.3, endTime: 2.4, confidence: 0.93, speakerIndex: 1 },
    { token: "Why do you want this role?", startTime: 3, endTime: 4, confidence: 0.96, speakerIndex: 0 },
    { token: "The integration scope matches my work.", startTime: 4.2, endTime: 5.5, confidence: 0.91, speakerIndex: 1 },
  ] }] });
  assert.equal(transcript.segments.length, 4);
  assert.equal(transcript.durationMs, 5500);
  assert.ok(transcript.averageConfidence > 0.9);
  const questions = [
    { id: "question-1", category: "Resume", question: "Describe your Oracle migration experience.", context: "Resume" },
    { id: "question-2", category: "HR", question: "Why do you want this role?", context: "Motivation" },
  ];
  const mapping = proposeSpeakerMapping(transcript.segments, questions);
  assert.equal(mapping.interviewerSpeakerId, "0");
  assert.equal(mapping.applicantSpeakerId, "1");
  assert.equal(mapping.status, "REQUIRES_REVIEW");
  const aligned = alignApplicantAnswers(transcript.segments, questions, { ...mapping, status: "CONFIRMED" });
  assert.match(aligned[0].answer, /three migrations/);
  assert.deepEqual(aligned[0].evidenceSegmentIds, ["segment-2"]);
  assert.match(aligned[1].answer, /integration scope/);
});

test("OCI unsupported M4A failures have an actionable message", () => {
  const message = ociSpeechFailureMessage("FILE_NOT_SUPPORTED: The provided file is not supported or corrupted", "FAILED");
  assert.match(message, /M4A/);
  assert.match(message, /AAC audio at 16 kHz or higher/);
  assert.match(message, /reupload/i);
});
test("completed and failed recording attempts can be reuploaded", () => {
  assert.equal(canReuseRecordingAttempt({ attemptId: "same-file", stage: "TRANSCRIBING" }, "same-file"), true);
  assert.equal(canReuseRecordingAttempt({ attemptId: "same-file", stage: "FAILED" }, "same-file"), false);
  assert.equal(canReuseRecordingAttempt({ attemptId: "same-file", stage: "COMPLETED" }, "same-file"), false);
  assert.equal(canReuseRecordingAttempt({ attemptId: "same-file", stage: "ANALYSIS_PENDING", speechLifecycleState: "SUCCEEDED" }, "same-file"), false);
  assert.equal(canReuploadRecording({ stage: "ANALYSIS_PENDING", speechLifecycleState: "SUCCEEDED" }), true);
  assert.equal(canReuploadRecording({ stage: "TRANSCRIBING", speechLifecycleState: "IN_PROGRESS" }), false);
});
test("OCI speakers are stored as Speaker 1 interviewer and Speaker 2 applicant", () => {
  const segments = [
    { id: "segment-1", speakerId: "SPEAKER_01", startMs: 0, endMs: 1000, confidence: 0.9, text: "Question" },
    { id: "segment-2", speakerId: "SPEAKER_02", startMs: 1100, endMs: 2200, confidence: 0.9, text: "Answer" },
  ];
  const mapping = assignSpeakerRoles(segments);
  assert.deepEqual(mapping, { interviewerSpeakerId: "SPEAKER_01", applicantSpeakerId: "SPEAKER_02", status: "CONFIRMED", method: "FIXED_ORDER", confidence: 1 });
  assert.deepEqual(labelSpeakerRoles(segments, mapping).map(({ speakerNumber, role }) => ({ speakerNumber, role })), [
    { speakerNumber: 1, role: "INTERVIEWER" },
    { speakerNumber: 2, role: "APPLICANT" },
  ]);
});

test("recording status endpoint refreshes OCI without running AI", async () => {
  const source = await readFile(new URL("../app/api/candidates/[candidateId]/screening/recording/route.ts", import.meta.url), "utf8");
  assert.match(source, /processRecordingRecord\(record,randomUUID\(\),false\)/);
  assert.match(source, /SUBMITTED/);
  assert.match(source, /TRANSCRIBING/);
});

test("OCI client logs status API requests and responses without media bodies", async () => {
  const source = await readFile(new URL("../lib/oci/screening-speech.ts", import.meta.url), "utf8");
  assert.match(source, /Speech\.GetTranscriptionJob/);
  assert.match(source, /Speech\.GetTranscriptionTask/);
  assert.match(source, /OCI API request/);
  assert.match(source, /OCI API response/);
  assert.match(source, /loggedOciCall\("ObjectStorage\.PutObject",request/);
  assert.doesNotMatch(source, /const request=\{[^;]*putObjectBody/s);
});
test("OCI transcript normalization rejects unsupported output instead of inventing content", () => {
  assert.throws(() => normalizeOciTranscript({ transcriptions: [{ transcription: "No timestamps or speaker labels" }] }), /timestamped segments or tokens/);
});
