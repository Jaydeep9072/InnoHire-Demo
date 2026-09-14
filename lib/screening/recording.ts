import type { ScreeningAnalysis, ScreeningQuestion } from "./schema";

export const recordingStages = ["SUBMISSION_PENDING","SUBMISSION_UNCERTAIN","SUBMITTED","TRANSCRIBING","AWAITING_SPEAKER_REVIEW","ANALYSIS_PENDING","ANALYZING","COMPLETED","FAILED"] as const;
export type RecordingStage = (typeof recordingStages)[number];
export type TranscriptSegment = { id:string; speakerId:string; speakerNumber?:1|2; role?:"INTERVIEWER"|"APPLICANT"; startMs:number; endMs:number; confidence:number|null; text:string };
export type SpeakerMapping = { interviewerSpeakerId:string; applicantSpeakerId:string; status:"REQUIRES_REVIEW"|"CONFIRMED"; method:"QUESTION_ALIGNMENT"|"FIXED_ORDER"|"MANUAL"; confidence:number };
export type RecordingQuestionAssessment = { questionId:string; status:"ASSESSED"|"NOT_ASKED"|"NO_APPLICANT_ANSWER"|"INSUFFICIENT_EVIDENCE"; score:number|null; analysis:string; evidenceSegmentIds:string[] };
export type RecordingParameterAssessment = { parameter:ScreeningAnalysis["parameterScores"][number]["parameter"]; status:"ASSESSED"|"INSUFFICIENT_EVIDENCE"; score:number|null; rationale:string; evidenceSegmentIds:string[] };
export type RecordingAssessment = { questionAssessments:RecordingQuestionAssessment[]; parameterAssessments:RecordingParameterAssessment[]; summary:string; strengths:string[]; developmentAreas:string[]; riskFlags:string[]; confidencePercentage:number; coveragePercentage:number; overallMatchPercentage:number|null };
export type RecordingWorkflow = {
  version:1; attemptId:string; candidateId:number; screeningId:number; stage:RecordingStage; fileName:string;
  input:{namespaceName:string;bucketName:string;objectName:string;eTag?:string};
  output:{namespaceName:string;bucketName:string;prefix:string;objectNames?:string[]};
  opcRetryToken:string; opcRequestId:string; displayName:string; transcriptionJobId?:string; transcriptionTaskId?:string;
  speechLifecycleState?:string; speechLifecycleDetails?:string; percentComplete?:number;
  retries:{submission:number;polling:number;analysis:number}; nextAttemptAt?:string; lease?:{owner:string;expiresAt:string};
  createdAt:string; updatedAt:string; submittedAt?:string; completedAt?:string;
  error?:{code:string;message:string;retryable:boolean;at:string};
  transcript?:{sourceObjectName:string;segments:TranscriptSegment[];durationMs:number;averageConfidence:number|null};
  transcriptParserVersion?:2; speakerMapping?:SpeakerMapping; alignedAnswers?:AlignedAnswer[]; assessment?:RecordingAssessment;
};

function record(value:unknown):Record<string,unknown>|null { return value && typeof value==="object" && !Array.isArray(value) ? value as Record<string,unknown> : null; }
function array(value:unknown):unknown[] { return Array.isArray(value)?value:[]; }
function text(value:unknown):string { return typeof value==="string"?value.trim():""; }
function number(value:unknown):number|null { const parsed=typeof value==="number"?value:typeof value==="string"&&value.trim()?Number.parseFloat(value):Number.NaN; return Number.isFinite(parsed)?parsed:null; }
function speaker(value:unknown):string { return typeof value==="string"||typeof value==="number"?String(value).trim():""; }
function timeMs(value:unknown,key:string):number|null { const parsed=number(value); if(parsed==null)return null; return /ms|millisecond/i.test(key)?Math.max(0,Math.round(parsed)):Math.max(0,Math.round(parsed*1000)); }
type Token={text:string;speakerId:string;startMs:number;endMs:number;confidence:number|null};
function tokenFrom(value:unknown,fallbackSpeaker:string):Token|null {
  const item=record(value); if(!item)return null;
  const tokenText=text(item.token??item.text??item.word); if(!tokenText)return null;
  const starts=["startTimeInMilliseconds","startTimeInMs","startTimeInSeconds","startTime","start"], ends=["endTimeInMilliseconds","endTimeInMs","endTimeInSeconds","endTime","end"];
  const sk=starts.find((key)=>item[key]!=null), ek=ends.find((key)=>item[key]!=null);
  const startMs=sk?timeMs(item[sk],sk):null, endMs=ek?timeMs(item[ek],ek):null; if(startMs==null||endMs==null)return null;
  return {text:tokenText,speakerId:speaker(item.speakerId??item.speaker??item.speakerLabel??item.speakerIndex??item.speakerIndex)||fallbackSpeaker||"unknown",startMs,endMs:Math.max(startMs,endMs),confidence:number(item.confidence??item.confidenceScore)};
}
function directSegments(root:Record<string,unknown>):TranscriptSegment[] {
  const values=[root.segments,root.transcriptionSegments,root.utterances].find(Array.isArray);
  return array(values).flatMap((value,index)=>{
    const item=record(value); if(!item)return []; const segmentText=text(item.text??item.transcription??item.transcript); if(!segmentText)return [];
    const starts=["startTimeInMilliseconds","startTimeInMs","startTimeInSeconds","startTime","start"],ends=["endTimeInMilliseconds","endTimeInMs","endTimeInSeconds","endTime","end"];
    const sk=starts.find((key)=>item[key]!=null),ek=ends.find((key)=>item[key]!=null);
    const startMs=sk?timeMs(item[sk],sk):null,endMs=ek?timeMs(item[ek],ek):null;if(startMs==null||endMs==null)return [];
    return [{id:`segment-${index+1}`,speakerId:speaker(item.speakerId??item.speaker??item.speakerLabel)||"unknown",startMs,endMs:Math.max(startMs,endMs),confidence:number(item.confidence??item.confidenceScore),text:segmentText}];
  });
}
function collectTokens(root:Record<string,unknown>):Token[] {
  const containers=[root.tokens,...array(root.transcriptions).flatMap((value)=>{const item=record(value);return item?[item.tokens,...array(item.transcriptions).map((nested)=>record(nested)?.tokens)]:[];}),...array(root.results).map((value)=>record(value)?.tokens)];
  return containers.flatMap((container)=>array(container).map((value)=>tokenFrom(value,"")).filter((value):value is Token=>Boolean(value)));
}
function tokensToSegments(tokens:Token[]):TranscriptSegment[] {
  const result:TranscriptSegment[]=[];
  for(const token of [...tokens].sort((a,b)=>a.startMs-b.startMs)){
    const previous=result.at(-1);
    if(previous&&previous.speakerId===token.speakerId&&token.startMs-previous.endMs<=1500){
      previous.text=`${previous.text} ${token.text}`.replace(/\s+([,.!?;:])/g,"$1").trim();previous.endMs=Math.max(previous.endMs,token.endMs);
      const values=[previous.confidence,token.confidence].filter((value):value is number=>value!=null);previous.confidence=values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;
    } else result.push({id:`segment-${result.length+1}`,speakerId:token.speakerId,startMs:token.startMs,endMs:token.endMs,confidence:token.confidence,text:token.text});
  }
  return result;
}
export function normalizeOciTranscript(value:unknown){
  const root=record(value);if(!root)throw new Error("OCI Speech returned a transcript that is not a JSON object.");
  const found=directSegments(root);const segments=found.length?found:tokensToSegments(collectTokens(root));
  if(!segments.length)throw new Error("OCI Speech transcript JSON did not contain supported timestamped segments or tokens.");
  const confidences=segments.map((item)=>item.confidence).filter((value):value is number=>value!=null);
  return {segments,durationMs:Math.max(...segments.map((item)=>item.endMs)),averageConfidence:confidences.length?confidences.reduce((sum,value)=>sum+value,0)/confidences.length:null};
}
function words(value:string){return new Set(value.toLowerCase().match(/[a-z0-9]+/g)?.filter((word)=>word.length>2)||[]);}
function similarity(left:string,right:string){const a=words(left),b=words(right);if(!a.size||!b.size)return 0;let shared=0;for(const word of a)if(b.has(word))shared++;return shared/Math.max(1,Math.min(a.size,b.size));}
export function proposeSpeakerMapping(segments:TranscriptSegment[],questions:ScreeningQuestion[]):SpeakerMapping{
  const speakerIds=[...new Set(segments.map((item)=>item.speakerId))];if(speakerIds.length!==2)throw new Error(`Expected exactly two diarized speakers but OCI returned ${speakerIds.length}.`);
  const scores=speakerIds.map((speakerId)=>({speakerId,score:segments.filter((item)=>item.speakerId===speakerId).reduce((sum,segment)=>sum+Math.max(...questions.map((q)=>similarity(segment.text,q.question))),0)})).sort((a,b)=>b.score-a.score);
  const total=scores[0].score+scores[1].score,confidence=total>0?Math.min(1,Math.max(0,(scores[0].score-scores[1].score)/total)):0;
  return {interviewerSpeakerId:scores[0].speakerId,applicantSpeakerId:scores[1].speakerId,status:"REQUIRES_REVIEW",method:"QUESTION_ALIGNMENT",confidence};
}
export type AlignedAnswer={questionId:string;status:RecordingQuestionAssessment["status"];answer:string;evidenceSegmentIds:string[]};
export function canReuseRecordingAttempt(existing:Pick<RecordingWorkflow,"attemptId"|"stage">|null,attemptId:string){return Boolean(existing&&existing.attemptId===attemptId&&existing.stage!=="FAILED");}
export function ociSpeechFailureMessage(details:string|undefined,state:string){const value=(details||"").trim();if(/FILE_NOT_SUPPORTED|not supported or corrupted/i.test(value))return "OCI Speech could not read this M4A. The file may be corrupted or use an unsupported audio codec or sample rate. Re-export it as M4A with AAC audio at 16 kHz or higher, then reupload it.";if(/sample.?rate/i.test(value))return "OCI Speech rejected the recording sample rate. Re-export it as M4A with AAC audio at 16 kHz or higher, then reupload it.";return value||`OCI Speech job ${state.toLowerCase()}.`;}
export function assignSpeakerRoles(segments:TranscriptSegment[]):SpeakerMapping{
  const speakerIds=[...new Set(segments.map((item)=>item.speakerId).filter(Boolean))];
  if(speakerIds.length!==2)throw new Error("Expected exactly two diarized speakers but OCI returned "+speakerIds.length+".");
  const ordinal=(value:string)=>{const matches=value.match(/[0-9]+/g);return matches?.length?Number(matches.at(-1)):Number.POSITIVE_INFINITY;};
  const ordered=[...speakerIds].sort((left,right)=>ordinal(left)-ordinal(right)||left.localeCompare(right,undefined,{numeric:true}));
  return {interviewerSpeakerId:ordered[0],applicantSpeakerId:ordered[1],status:"CONFIRMED",method:"FIXED_ORDER",confidence:1};
}
export function labelSpeakerRoles(segments:TranscriptSegment[],mapping:SpeakerMapping):TranscriptSegment[]{
  return segments.map((segment)=>segment.speakerId===mapping.interviewerSpeakerId
    ? {...segment,speakerNumber:1,role:"INTERVIEWER"}
    : segment.speakerId===mapping.applicantSpeakerId
      ? {...segment,speakerNumber:2,role:"APPLICANT"}
      : segment);
}
export function alignApplicantAnswers(segments:TranscriptSegment[],questions:ScreeningQuestion[],mapping:SpeakerMapping):AlignedAnswer[]{
  const matches=segments.map((segment,index)=>{
    if(segment.speakerId!==mapping.interviewerSpeakerId)return null;
    const ranked=questions.map((question)=>({question,score:similarity(segment.text,question.question)})).sort((a,b)=>b.score-a.score);
    return ranked[0]&&ranked[0].score>=0.14?{segmentIndex:index,questionId:ranked[0].question.id,score:ranked[0].score}:null;
  }).filter((item):item is {segmentIndex:number;questionId:string;score:number}=>Boolean(item)).sort((a,b)=>a.segmentIndex-b.segmentIndex);
  const best=new Map<string,(typeof matches)[number]>();for(const match of matches){const current=best.get(match.questionId);if(!current||match.score>current.score)best.set(match.questionId,match);}
  return questions.map((question)=>{const match=best.get(question.id);if(!match)return {questionId:question.id,status:"NOT_ASKED" as const,answer:"",evidenceSegmentIds:[]};
    const next=matches.find((item)=>item.segmentIndex>match.segmentIndex)?.segmentIndex??segments.length;
    const answerSegments=segments.slice(match.segmentIndex+1,next).filter((segment)=>segment.speakerId===mapping.applicantSpeakerId);const answer=answerSegments.map((segment)=>segment.text).join(" ").trim();
    return {questionId:question.id,status:answer?"ASSESSED" as const:"NO_APPLICANT_ANSWER" as const,answer,evidenceSegmentIds:answerSegments.map((segment)=>segment.id)};
  });
}
export function isRecordingWorkflow(value:unknown):value is RecordingWorkflow {const item=record(value);return Boolean(item&&item.version===1&&typeof item.attemptId==="string"&&typeof item.stage==="string"&&recordingStages.includes(item.stage as RecordingStage));}
export function publicRecordingStatus(workflow:RecordingWorkflow|null){
  if(!workflow)return null;
  return {attemptId:workflow.attemptId,stage:workflow.stage,fileName:workflow.fileName,transcriptionJobId:workflow.transcriptionJobId,percentComplete:workflow.percentComplete,speechLifecycleState:workflow.speechLifecycleState,speechLifecycleDetails:workflow.speechLifecycleDetails,error:workflow.error,transcript:workflow.transcript,speakerMapping:workflow.speakerMapping,alignedAnswers:workflow.alignedAnswers,assessment:workflow.assessment,createdAt:workflow.createdAt,updatedAt:workflow.updatedAt};
}

export type PublicRecording = Exclude<ReturnType<typeof publicRecordingStatus>, null>;
