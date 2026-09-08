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
const { validateScreeningBank, validateScreeningAnalysis } = await loadTypeScript("../lib/screening/schema.ts");
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
