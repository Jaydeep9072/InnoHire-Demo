type StoredQuestion = {
  id?: unknown;
  question_id?: unknown;
  question?: unknown;
  category?: unknown;
  context?: unknown;
};


function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("Stored screening " + label + " are not valid JSON.");
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function questionNumber(item: StoredQuestion, index: number) {
  const storedNumber = Number(item.question_id);
  if (Number.isSafeInteger(storedNumber) && storedNumber > 0) return storedNumber;

  const suffix = String(item.id ?? "").match(/[0-9]+$/)?.[0];
  const idNumber = Number(suffix);
  return Number.isSafeInteger(idNumber) && idNumber > 0 ? idNumber : index + 1;
}

function questionKey(item: StoredQuestion, number: number) {
  const id = String(item.id ?? "").trim();
  return id || "question-" + number;
}

function answerFor(
  payload: unknown,
  key: string,
  number: number,
  index: number,
) {
  if (Array.isArray(payload)) {
    const items = payload.map(record);
    const match = items.find((item) => Number(item?.question_id) === number) ?? items[index];
    return String(match?.answer ?? "");
  }

  const answers = record(payload);
  if (!answers) return "";
  return String(
    answers[key]
      ?? answers["question-" + number]
      ?? answers[String(number)]
      ?? "",
  );
}

export function normalizeStoredScreeningEntries(
  questionsJson: string,
  answersJson: string,
) {
  const parsedQuestions = parseJson(questionsJson, "questions");
  if (!Array.isArray(parsedQuestions)) {
    throw new Error("Stored screening questions must be an array.");
  }

  const storedQuestions = parsedQuestions
    .map(record)
    .filter((item): item is Record<string, unknown> => Boolean(item)) as StoredQuestion[];
  const answerPayload = parseJson(answersJson, "answers");

  const questions = storedQuestions.map((item, index) => {
    const number = questionNumber(item, index);
    return {
      question_id: number,
      question: String(item.question ?? ""),
      category: item.category == null ? undefined : String(item.category),
      context: item.context == null ? undefined : String(item.context),
    };
  });

  const answers = storedQuestions.map((item, index) => {
    const number = questionNumber(item, index);
    return {
      question_id: number,
      answer: answerFor(answerPayload, questionKey(item, number), number, index),
    };
  });

  return { questions, answers };
}
