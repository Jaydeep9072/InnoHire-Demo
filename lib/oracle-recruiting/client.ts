import type { JobInput } from "@/types/domain";
import { randomUUID } from "node:crypto";

const DEFAULT_REQUISITIONS_PATH = "/hcmRestApi/resources/11.13.18.05/recruitingJobRequisitions";

const ORC_JOB_BOARD = "Oracle Recruiting Cloud (ORC)";

const ORC_DEFAULTS = {
  RecruitingType: "ORA_PROFESSIONAL",
  HiringManagerId: 300000049043637,
  RecruiterId: 300000049306574,
  PrimaryLocationId: 100002000029784,
  OrganizationId: 300000047013770,
  CandidateSelectionProcessId: 300000161356718,
  ExternalApplicationFlowId: 300000151668689,
  StateId: 21,
  PhaseId: 4,
  UnlimitedOpenings: "N",
  PipelineRequisition: "N",
  SkillSectionId: 300000234777684,
  SkillRequiredFlag: true,
  SkillImportance: 5,
} as const;

type OracleRecruitingResponse = Record<string, unknown>;

export class OracleRecruitingError extends Error {
  constructor(message: string, public status = 502, public details?: unknown) {
    super(message);
    this.name = "OracleRecruitingError";
  }
}

function configuration() {
  const username = process.env.ORC_USERNAME;
  const password = process.env.ORC_PASSWORD;
  if (!username || !password) throw new OracleRecruitingError("Oracle Recruiting Cloud credentials are not configured.", 503);
  return {
    username,
    password,
    baseUrl: process.env.ORC_BASE_URL, 
    requisitionsPath:  DEFAULT_REQUISITIONS_PATH,
  };
}

function encodeHtml(value: string) {
  return Buffer.from(value, "utf8").toString("base64");
}

function requiredSkills(value: string) {
  const seen = new Set<string>();
  return value
    .split(/[,;\n|]/)
    .map((skill) => skill.trim())
    .filter((skill) => {
      if (!skill) return false;
      const normalized = skill.toLocaleLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}

export function isOracleRecruitingBoardSelected(jobBoards: string[]) {
  return jobBoards.some((board) => board.trim().toLocaleLowerCase() === ORC_JOB_BOARD.toLocaleLowerCase());
}

export function toOracleRecruitingPayload(input: JobInput) {
  return {
    Title: input.title,
    RecruitingType: ORC_DEFAULTS.RecruitingType,
    HiringManagerId: ORC_DEFAULTS.HiringManagerId,
    RecruiterId: ORC_DEFAULTS.RecruiterId,
    PrimaryLocationId: ORC_DEFAULTS.PrimaryLocationId,
    OrganizationId: ORC_DEFAULTS.OrganizationId,
    CandidateSelectionProcessId: ORC_DEFAULTS.CandidateSelectionProcessId,
    ExternalApplicationFlowId: ORC_DEFAULTS.ExternalApplicationFlowId,
    StateId: ORC_DEFAULTS.StateId,
    PhaseId: ORC_DEFAULTS.PhaseId,
    UnlimitedOpenings: ORC_DEFAULTS.UnlimitedOpenings,
    NumberOfOpenings: input.openingsCount,
    OtherRequisitionTitle: input.title,
    PipelineRequisition: ORC_DEFAULTS.PipelineRequisition,
    ExternalDescriptionHTML: encodeHtml(input.jobDescription),
    ExternalRespHTML: encodeHtml(input.responsibilities),
    ExternalQualHTML: "",
    skills: requiredSkills(input.requiredSkills).map((skill) => ({
      SectionId: ORC_DEFAULTS.SkillSectionId,
      Skills: skill,
      MinimumYearsOfExperience: input.minimumExperience,
      RequiredFlag: ORC_DEFAULTS.SkillRequiredFlag,
      Importance: ORC_DEFAULTS.SkillImportance,
    })),
  };
}

function responseMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  for (const key of ["detail", "title", "message", "errorMessage"]) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
  }
  return "";
}

function requisitionId(payload: OracleRecruitingResponse) {
  for (const key of ["RequisitionId", "requisitionId", "Id", "id"]) {
    const value = payload[key];
    if (typeof value === "string" || typeof value === "number") return String(value);
  }
  return null;
}

function requestPayloadForLog(payload: ReturnType<typeof toOracleRecruitingPayload>) {
  return {
    ...payload,
    ExternalDescriptionHTML: `[BASE64 HTML: ${payload.ExternalDescriptionHTML.length} characters]`,
    ExternalRespHTML: `[BASE64 HTML: ${payload.ExternalRespHTML.length} characters]`,
    ExternalQualHTML: `[BASE64 HTML: ${payload.ExternalQualHTML.length} characters]`,
  };
}

function responseForLog(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return typeof payload === "string" ? `[NON-JSON RESPONSE: ${payload.length} characters]` : payload;
  }
  const record = payload as Record<string, unknown>;
  return Object.fromEntries(
    ["RequisitionId", "RequisitionNumber", "Title", "StateId", "PhaseId", "detail", "message", "errorCode"]
      .filter((key) => record[key] !== undefined)
      .map((key) => [key, record[key]]),
  );
}

export async function createOracleRecruitingRequisition(input: JobInput) {
  const { username, password, baseUrl, requisitionsPath } = configuration();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  const url = `${baseUrl}${requisitionsPath.startsWith("/") ? requisitionsPath : `/${requisitionsPath}`}`;
  const requestId = randomUUID();
  const requestPayload = toOracleRecruitingPayload(input);

  console.info("Oracle Recruiting Cloud POST request", {
    requestId,
    url,
    payload: requestPayloadForLog(requestPayload),
  });

  try {
    const response = await fetch(url, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`,
      },
      body: JSON.stringify(requestPayload),
    });
    const body = await response.text();
    let payload: unknown = null;
    try { payload = body ? JSON.parse(body) : null; }
    catch { payload = body; }
    console.info("Oracle Recruiting Cloud POST response", {
      requestId,
      url,
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get("content-type"),
      payload: responseForLog(payload),
    });
    if (!response.ok) {
      const providerMessage = responseMessage(payload);
      throw new OracleRecruitingError(`Oracle Recruiting Cloud rejected the requisition (${response.status})${providerMessage ? `: ${providerMessage}` : "."}`, response.status, payload);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new OracleRecruitingError("Oracle Recruiting Cloud returned an invalid response.", 502);
    const externalJobId = requisitionId(payload as OracleRecruitingResponse);
    if (!externalJobId) throw new OracleRecruitingError("Oracle Recruiting Cloud created the requisition but did not return its ID.", 502, payload);
    console.info("Oracle Recruiting Cloud requisition created", { requestId, externalJobId });
    return { externalJobId, payload: payload as OracleRecruitingResponse };
  } catch (error) {
    if (error instanceof OracleRecruitingError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      console.error("Oracle Recruiting Cloud POST timed out", { requestId, url });
      throw new OracleRecruitingError("The Oracle Recruiting Cloud request timed out.", 504);
    }
    console.error("Oracle Recruiting Cloud POST transport error", {
      requestId,
      url,
      message: error instanceof Error ? error.message : "Unknown transport error",
    });
    throw new OracleRecruitingError(`Oracle Recruiting Cloud could not be reached${error instanceof Error && error.message ? `: ${error.message}` : "."}`);
  } finally {
    clearTimeout(timer);
  }
}
