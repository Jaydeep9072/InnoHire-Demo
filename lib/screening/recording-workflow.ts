import { createHash, randomUUID } from "node:crypto";
import { analyzeRecordingAnswers } from "@/lib/ai/recording-screening-analysis";
import { createSpeechJob, getOciScreeningConfig, getSpeechJobState, getTranscriptObjectJson, putRecording, recordingObjectNames, reconcileSpeechJob } from "@/lib/oci/screening-speech";
import { getLatestOrdsScreening, listOrdsCandidates, listOrdsJobs, listOrdsScreeningRecords, saveOrdsScreening, type OrdsScreeningRecord } from "@/lib/ords/client";
import { screeningParameters, type ScreeningQuestion } from "@/lib/screening/schema";
import { alignApplicantAnswers, assignSpeakerRoles, canReuseRecordingAttempt, labelSpeakerRoles, normalizeOciTranscript, ociSpeechFailureMessage, recordingStages, type RecordingWorkflow } from "@/lib/screening/recording";

const TERMINAL=new Set(["COMPLETED","FAILED"]);
const MAX_UPLOAD_BYTES=100*1024*1024;

function parseJson<T>(value:string|null,fallback:T):T{if(!value)return fallback;try{return JSON.parse(value) as T}catch{return fallback}}
export function workflowFromRecord(record:OrdsScreeningRecord):RecordingWorkflow|null{
  const value=parseJson<unknown>(record.analyzed_call_recording_json,null);
  if(value&&typeof value==="object"&&"stage" in value&&recordingStages.includes(String((value as {stage:unknown}).stage) as RecordingWorkflow["stage"])){
    const workflow=value as RecordingWorkflow;
    if(workflow.stage==="FAILED"&&!workflow.transcriptParserVersion&&workflow.error?.code==="WORKFLOW_STEP_FAILED"&&workflow.error.message.includes("Expected exactly two diarized speakers"))return {...workflow,stage:"SUBMITTED",transcriptParserVersion:2,nextAttemptAt:undefined,error:undefined,updatedAt:new Date().toISOString()};
    return workflow;
  }
  if(!record.transcription_job_id||!record.output_prefix)return null;
  const now=record.updated_at||record.created_at||new Date().toISOString();
  const parts=record.output_prefix.split("/").filter(Boolean),fromPrefix=parts.at(-1)||"";
  const attemptId=/^[a-zA-Z0-9_-]{8,64}$/.test(fromPrefix)?fromPrefix:createHash("sha256").update(record.transcription_job_id).digest("hex").slice(0,32);
  const token=createHash("sha256").update("legacy:"+record.transcription_job_id).digest("hex");
  const stableUuid=token.slice(0,8)+"-"+token.slice(8,12)+"-4"+token.slice(13,16)+"-a"+token.slice(17,20)+"-"+token.slice(20,32);
  return {version:1,attemptId,candidateId:record.job_candidate_id,screeningId:record.screening_id,stage:"SUBMITTED",fileName:record.call_recording_name||"recording.m4a",input:{namespaceName:process.env.OCI_OBJECT_NAMESPACE||"",bucketName:process.env.OCI_SPEECH_INPUT_BUCKET||"",objectName:""},output:{namespaceName:process.env.OCI_OBJECT_NAMESPACE||"",bucketName:process.env.OCI_SPEECH_OUTPUT_BUCKET||"",prefix:record.output_prefix},opcRetryToken:stableUuid,opcRequestId:stableUuid,displayName:"innohire-"+record.job_candidate_id+"-"+record.screening_id+"-"+attemptId,retries:{submission:0,polling:0,analysis:0},transcriptionJobId:record.transcription_job_id,createdAt:now,updatedAt:now,submittedAt:record.started_at||now};
}
function questionsFromRecord(record:OrdsScreeningRecord):ScreeningQuestion[]{
  return parseJson<Array<Record<string,unknown>>>(record.questions_json,[]).map((item,index)=>({
    id:String(item.id||`question-${item.question_id||index+1}`),
    category:item.category==="HR"||item.category==="Resume"||item.category==="Job description"?item.category:"Job description",
    question:String(item.question||""),context:String(item.context||"Saved screening question"),
  }));
}
function answersFromRecord(record:OrdsScreeningRecord,questions:ScreeningQuestion[]){
  const raw=parseJson<unknown>(record.answers_json,{});
  if(Array.isArray(raw))return Object.fromEntries(raw.map((item,index)=>{const row=item as Record<string,unknown>;return [questions[index]?.id||`question-${row.question_id||index+1}`,String(row.answer||"")]}));
  return raw&&typeof raw==="object"?raw as Record<string,string>:{};
}
function alignedAnswerOverrides(record:OrdsScreeningRecord,workflow:RecordingWorkflow):Partial<OrdsScreeningRecord>{
  if(!workflow.alignedAnswers)return {};
  const questions=questionsFromRecord(record),existing=answersFromRecord(record,questions);
  const transcriptAnswers=Object.fromEntries(workflow.alignedAnswers.filter((item)=>item.answer.trim()).map((item)=>[item.questionId,item.answer]));
  const answers={...existing,...transcriptAnswers};
  const answeredCount=questions.filter((question)=>String(answers[question.id]||"").trim()).length;
  return {answers_json:JSON.stringify(answers),answered_count:answeredCount,completion_percentage:questions.length?Math.round(answeredCount/questions.length*100):0};
}
async function persist(record:OrdsScreeningRecord,workflow:RecordingWorkflow,overrides:Partial<OrdsScreeningRecord>={}){
  const result=await saveOrdsScreening({...record,...overrides,screening_id:record.screening_id,call_recording_name:workflow.fileName,transcription_job_id:workflow.transcriptionJobId||null,output_prefix:workflow.output.prefix,analyzed_call_recording_json:JSON.stringify(workflow)});
  return Number(result.screening_id||result.SCREENING_ID||record.screening_id);
}
function isM4a(buffer:Buffer){return buffer.length>=12&&buffer.subarray(4,8).toString("ascii")==="ftyp";}
function publicError(error:unknown){return error instanceof Error?error.message:"The recording workflow failed.";}
function nextRetry(count:number){return new Date(Date.now()+Math.min(30*60_000,Math.pow(2,count)*30_000)).toISOString();}

export async function startRecordingWorkflow(candidateId:number,screeningId:number,file:File){
  if(!file.name.toLowerCase().endsWith(".m4a"))throw new Error("Only .m4a call recordings are accepted.");
  if(file.size<=0||file.size>MAX_UPLOAD_BYTES)throw new Error("The M4A recording must be between 1 byte and 100 MB.");
  const record=await getLatestOrdsScreening(candidateId);
  if(!record||record.screening_id!==screeningId)throw new Error("Save or reopen the screening before uploading a call recording.");
  const bytes=Buffer.from(await file.arrayBuffer());if(!isM4a(bytes))throw new Error("The selected file is not a valid M4A/MP4 audio container.");
  const contentAttemptId=createHash("sha256").update(String(candidateId)).update(":").update(String(screeningId)).update(bytes).digest("hex").slice(0,32);
  const existing=workflowFromRecord(record);if(canReuseRecordingAttempt(existing,contentAttemptId))return existing;
  const attemptId=existing?.stage==="FAILED"?createHash("sha256").update(contentAttemptId).update(":").update(randomUUID()).digest("hex").slice(0,32):contentAttemptId;
  const cfg=getOciScreeningConfig(),names=recordingObjectNames(candidateId,screeningId,file.name,attemptId),now=new Date().toISOString();
  let workflow:RecordingWorkflow={version:1,transcriptParserVersion:2,attemptId:names.attemptId,candidateId,screeningId,stage:"SUBMISSION_PENDING",fileName:file.name,input:{namespaceName:cfg.namespaceName,bucketName:cfg.inputBucketName,objectName:names.inputObjectName},output:{namespaceName:cfg.namespaceName,bucketName:cfg.outputBucketName,prefix:names.outputPrefix},opcRetryToken:randomUUID(),opcRequestId:randomUUID(),displayName:`innohire-${candidateId}-${screeningId}-${names.attemptId}`,retries:{submission:0,polling:0,analysis:0},createdAt:now,updatedAt:now};
  await persist(record,workflow,{screening_status:"DRAFT"});
  try {
    const uploaded=await putRecording(workflow.input.objectName,bytes,workflow.opcRequestId);
    workflow={...workflow,input:{...workflow.input,eTag:uploaded.eTag},updatedAt:new Date().toISOString()};
    await persist(record,workflow);
  } catch(error) {
    workflow={...workflow,stage:"FAILED",updatedAt:new Date().toISOString(),error:{code:"OCI_UPLOAD_FAILED",message:publicError(error),retryable:false,at:new Date().toISOString()}};
    await persist(record,workflow);
    return workflow;
  }
  try {
    const created=await createSpeechJob({objectName:workflow.input.objectName,outputPrefix:workflow.output.prefix,displayName:workflow.displayName,retryToken:workflow.opcRetryToken,requestId:workflow.opcRequestId,attemptId:workflow.attemptId,candidateId,screeningId});
    workflow={...workflow,stage:"SUBMITTED",transcriptionJobId:created.transcriptionJob.id,speechLifecycleState:created.transcriptionJob.lifecycleState,submittedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),error:undefined};
  } catch(error) {
    workflow={...workflow,stage:"SUBMISSION_UNCERTAIN",retries:{...workflow.retries,submission:1},nextAttemptAt:nextRetry(1),updatedAt:new Date().toISOString(),error:{code:"OCI_SUBMISSION_UNCERTAIN",message:publicError(error),retryable:true,at:new Date().toISOString()}};
  }
  await persist(record,workflow);return workflow;
}
async function reconcileSubmission(record:OrdsScreeningRecord,workflow:RecordingWorkflow){
  const existing=await reconcileSpeechJob(workflow.displayName,workflow.attemptId);
  if(existing)return {...workflow,stage:"SUBMITTED" as const,transcriptionJobId:existing.id,speechLifecycleState:existing.lifecycleState,submittedAt:existing.timeAccepted?.toISOString()||workflow.submittedAt||new Date().toISOString(),nextAttemptAt:undefined,error:undefined,updatedAt:new Date().toISOString()};
  if(Date.now()-new Date(workflow.createdAt).getTime()>23*60*60_000)throw new Error("The OCI retry token is near expiry and no matching Speech job was found. Upload the recording again.");
  const created=await createSpeechJob({objectName:workflow.input.objectName,outputPrefix:workflow.output.prefix,displayName:workflow.displayName,retryToken:workflow.opcRetryToken,requestId:workflow.opcRequestId,attemptId:workflow.attemptId,candidateId:workflow.candidateId,screeningId:workflow.screeningId});
  return {...workflow,stage:"SUBMITTED" as const,transcriptionJobId:created.transcriptionJob.id,speechLifecycleState:created.transcriptionJob.lifecycleState,submittedAt:new Date().toISOString(),nextAttemptAt:undefined,error:undefined,updatedAt:new Date().toISOString()};
}
async function progressSpeech(record:OrdsScreeningRecord,workflow:RecordingWorkflow){
  if(!workflow.transcriptionJobId)throw new Error("The persisted workflow has no OCI Speech job ID.");
  const state=await getSpeechJobState(workflow.transcriptionJobId);
  const matching=workflow.input.objectName?state.tasks.filter((task)=>task!.inputLocation?.objectNames?.includes(workflow.input.objectName)):state.tasks;
  const task=matching.length===1?matching[0]:undefined;
  const base={...workflow,stage:"TRANSCRIBING" as const,speechLifecycleState:state.job.lifecycleState,speechLifecycleDetails:task?.lifecycleDetails||state.job.lifecycleDetails,percentComplete:task?.percentComplete??state.job.percentComplete,updatedAt:new Date().toISOString(),error:undefined};
  if(task&&(task.lifecycleState==="FAILED"||task.lifecycleState==="CANCELED"))return {...base,stage:"FAILED" as const,error:{code:"OCI_SPEECH_FAILED",message:ociSpeechFailureMessage(task.lifecycleDetails,task.lifecycleState),retryable:false,at:new Date().toISOString()}};
  if(state.job.lifecycleState==="FAILED"||state.job.lifecycleState==="CANCELED")return {...base,stage:"FAILED" as const,error:{code:"OCI_SPEECH_FAILED",message:ociSpeechFailureMessage(state.job.lifecycleDetails,state.job.lifecycleState),retryable:false,at:new Date().toISOString()}};
  if(state.job.lifecycleState!=="SUCCEEDED")return base;
  if(matching.length!==1)throw new Error("Expected one Speech task for the uploaded object but found "+matching.length+".");
  if(task!.lifecycleState!=="SUCCEEDED")return base;
  const inputNames=task!.inputLocation?.objectNames||[];
  if(inputNames.length!==1)throw new Error("Expected one input object in the Speech task but found "+inputNames.length+".");
  const input={namespaceName:task!.inputLocation?.namespaceName||workflow.input.namespaceName,bucketName:task!.inputLocation?.bucketName||workflow.input.bucketName,objectName:inputNames[0],eTag:workflow.input.eTag};
  const outputNames=task!.outputLocation?.objectNames||[];const jsonNames=outputNames.filter((name)=>name.toLowerCase().endsWith(".json"));
  if(jsonNames.length!==1)throw new Error(`Expected one JSON transcript in the task output but found ${jsonNames.length}.`);
  const raw=await getTranscriptObjectJson(task!.outputLocation?.namespaceName||workflow.output.namespaceName,task!.outputLocation?.bucketName||workflow.output.bucketName,jsonNames[0]);
  const transcript=normalizeOciTranscript(raw),speakerMapping=assignSpeakerRoles(transcript.segments),segments=labelSpeakerRoles(transcript.segments,speakerMapping),alignedAnswers=alignApplicantAnswers(segments,questionsFromRecord(record),speakerMapping);
  return {...base,stage:"ANALYSIS_PENDING" as const,transcriptParserVersion:2 as const,input,transcriptionTaskId:task!.id,output:{namespaceName:task!.outputLocation?.namespaceName||workflow.output.namespaceName,bucketName:task!.outputLocation?.bucketName||workflow.output.bucketName,prefix:workflow.output.prefix,objectNames:outputNames},transcript:{sourceObjectName:jsonNames[0],...transcript,segments},speakerMapping,alignedAnswers,percentComplete:100};
}
async function completeAnalysis(record:OrdsScreeningRecord,workflow:RecordingWorkflow){
  if(!workflow.transcript||!workflow.speakerMapping||workflow.speakerMapping.status!=="CONFIRMED")throw new Error("Confirm the speaker mapping before analysis.");
  const candidate=(await listOrdsCandidates()).find((item)=>item.job_candidate_id===record.job_candidate_id);if(!candidate)throw new Error("Candidate not found.");
  const job=(await listOrdsJobs(record.job_posting_id)).find((item)=>item.job_posting_id===record.job_posting_id);if(!job)throw new Error("Job not found.");
  const questions=questionsFromRecord(record),assessment=await analyzeRecordingAnswers({candidate,job,questions,segments:workflow.transcript.segments,speakerMapping:workflow.speakerMapping});
  const aligned=alignApplicantAnswers(workflow.transcript.segments,questions,workflow.speakerMapping),existingAnswers=answersFromRecord(record,questions);
  const answers={...existingAnswers,...Object.fromEntries(aligned.filter((item)=>item.answer).map((item)=>[item.questionId,item.answer]))};
  const score=(name:(typeof screeningParameters)[number])=>assessment.parameterAssessments.find((item)=>item.parameter===name)?.score??null;
  const category=(name:ScreeningQuestion["category"])=>{const values=questions.filter((q)=>q.category===name).map((q)=>assessment.questionAssessments.find((a)=>a.questionId===q.id)?.score).filter((v):v is number=>v!=null);return values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length):null};
  const completed={...workflow,stage:"COMPLETED" as const,alignedAnswers:aligned,assessment,completedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),lease:undefined,error:undefined};
  await persist(record,completed,{screening_status:"COMPLETED",answers_json:JSON.stringify(answers),response_analysis_json:JSON.stringify(assessment.questionAssessments),parameter_scores_json:JSON.stringify(assessment.parameterAssessments),hr_score:category("HR"),resume_score:category("Resume"),job_description_score:category("Job description"),role_knowledge_score:score("Role knowledge"),problem_solving_score:score("Problem solving"),communication_score:score("Communication"),evidence_ownership_score:score("Evidence and ownership"),collaboration_score:score("Collaboration"),motivation_adaptability_score:score("Motivation and adaptability"),overall_match_percentage:assessment.overallMatchPercentage,analysis_confidence_percentage:assessment.confidencePercentage,overall_analysis:assessment.summary,strengths_json:JSON.stringify(assessment.strengths),development_areas_json:JSON.stringify(assessment.developmentAreas),risk_flags_json:JSON.stringify(assessment.riskFlags),analyzed_at:new Date().toISOString()});
  return completed;
}
export async function confirmRecordingSpeakers(candidateId:number,screeningId:number,swap:boolean){
  const record=await getLatestOrdsScreening(candidateId),workflow=record&&workflowFromRecord(record);
  if(!record||record.screening_id!==screeningId||!workflow?.speakerMapping||!workflow.transcript)throw new Error("A transcript awaiting speaker review was not found.");
  const mapping=workflow.speakerMapping;const confirmed={...workflow,stage:"ANALYSIS_PENDING" as const,speakerMapping:{interviewerSpeakerId:swap?mapping.applicantSpeakerId:mapping.interviewerSpeakerId,applicantSpeakerId:swap?mapping.interviewerSpeakerId:mapping.applicantSpeakerId,status:"CONFIRMED" as const,method:"MANUAL" as const,confidence:1},updatedAt:new Date().toISOString(),nextAttemptAt:undefined,error:undefined};
  await persist(record,confirmed);return confirmed;
}
export async function processRecordingRecord(record:OrdsScreeningRecord,owner=randomUUID(),runAnalysis=true){
  let workflow=workflowFromRecord(record);if(!workflow||TERMINAL.has(workflow.stage))return workflow;
  if(workflow.nextAttemptAt&&new Date(workflow.nextAttemptAt)>new Date())return workflow;
  if(workflow.lease&&new Date(workflow.lease.expiresAt)>new Date())return workflow;
  workflow={...workflow,lease:{owner,expiresAt:new Date(Date.now()+2*60_000).toISOString()},updatedAt:new Date().toISOString()};await persist(record,workflow);
  try{
    if(workflow.stage==="SUBMISSION_UNCERTAIN"||workflow.stage==="SUBMISSION_PENDING")workflow=await reconcileSubmission(record,workflow);
    else if(workflow.stage==="SUBMITTED"||workflow.stage==="TRANSCRIBING")workflow=await progressSpeech(record,workflow);
    else if(workflow.stage==="AWAITING_SPEAKER_REVIEW"){
      if(!workflow.transcript)throw new Error("The stored recording workflow has no transcript.");
      const speakerMapping=assignSpeakerRoles(workflow.transcript.segments);
      workflow={...workflow,stage:"ANALYSIS_PENDING",transcript:{...workflow.transcript,segments:labelSpeakerRoles(workflow.transcript.segments,speakerMapping)},speakerMapping,nextAttemptAt:undefined,error:undefined,updatedAt:new Date().toISOString()};
    }
    else if(workflow.stage==="ANALYSIS_PENDING"||workflow.stage==="ANALYZING"){if(!workflow.transcript||!workflow.speakerMapping)throw new Error("The stored recording workflow is missing its transcript or speaker mapping.");const questions=questionsFromRecord(record),alignedAnswers=workflow.alignedAnswers||alignApplicantAnswers(workflow.transcript.segments,questions,workflow.speakerMapping);workflow={...workflow,alignedAnswers,stage:"ANALYSIS_PENDING",nextAttemptAt:undefined,error:undefined,updatedAt:new Date().toISOString()};await persist(record,workflow,alignedAnswerOverrides(record,workflow));if(!runAnalysis){workflow={...workflow,lease:undefined,updatedAt:new Date().toISOString()};await persist(record,workflow,{...alignedAnswerOverrides(record,workflow),...(workflow.stage==="FAILED"?{screening_status:"FAILED" as const}:{})});return workflow;}workflow={...workflow,stage:"ANALYZING",updatedAt:new Date().toISOString()};await persist(record,workflow,alignedAnswerOverrides(record,workflow));workflow=await completeAnalysis(record,workflow);return workflow;}
    workflow={...workflow,lease:undefined,updatedAt:new Date().toISOString()};await persist(record,workflow,{...alignedAnswerOverrides(record,workflow),...(workflow.stage==="FAILED"?{screening_status:"FAILED" as const}:{})});return workflow;
  }catch(error){
    const retryable=!String(publicError(error)).includes("Expected exactly two")&&!String(publicError(error)).includes("retry token")&&!String(publicError(error)).includes("No applicant answers");
    const key=workflow.stage==="SUBMISSION_PENDING"||workflow.stage==="SUBMISSION_UNCERTAIN"?"submission":workflow.stage==="ANALYSIS_PENDING"||workflow.stage==="ANALYZING"?"analysis":"polling";
    const count=workflow.retries[key]+1,canRetry=retryable&&count<=5;
    workflow={...workflow,stage:canRetry?workflow.stage:"FAILED",retries:{...workflow.retries,[key]:count},nextAttemptAt:canRetry?nextRetry(count):undefined,lease:undefined,updatedAt:new Date().toISOString(),error:{code:"WORKFLOW_STEP_FAILED",message:publicError(error),retryable:canRetry,at:new Date().toISOString()}};
    await persist(record,workflow);return workflow;
  }
}
export async function processDueRecordingWorkflows(limit=5,runAnalysis=true){
  const records=(await listOrdsScreeningRecords()).filter((record)=>{const workflow=workflowFromRecord(record);return workflow&&!TERMINAL.has(workflow.stage)}).slice(0,Math.max(1,Math.min(limit,10)));
  const results=[];for(const record of records)results.push(await processRecordingRecord(record,randomUUID(),runAnalysis));return results;
}
