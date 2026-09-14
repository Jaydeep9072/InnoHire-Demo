import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import * as common from "oci-common";
import * as aispeech from "oci-aispeech";
import * as objectstorage from "oci-objectstorage";

export type OciScreeningConfig = {
  region:string; compartmentId:string; namespaceName:string; inputBucketName:string; outputBucketName:string;
  inputPrefix:string; outputPrefix:string; languageCode:string; modelType:string;
};

function ociErrorDetails(error:unknown){
  if(!error||typeof error!=="object")return {message:String(error)};
  const value=error as Record<string,unknown>;
  return {statusCode:value.statusCode??null,serviceCode:value.serviceCode??value.code??null,opcRequestId:value.opcRequestId??null,message:error instanceof Error?error.message:String(value.message||"Unknown OCI error")};
}
async function loggedOciCall<T>(operation:string,request:unknown,call:()=>Promise<T>,responseSummary:(response:T)=>unknown):Promise<T>{
  console.info(`OCI API request\n${JSON.stringify({operation,request},null,2)}`);
  try{const response=await call();console.info(`OCI API response\n${JSON.stringify({operation,response:responseSummary(response)},null,2)}`);return response;}
  catch(error){console.error(`OCI API response\n${JSON.stringify({operation,error:ociErrorDetails(error)},null,2)}`);throw error;}
}
function required(name:string){const value=process.env[name]?.trim();if(!value)throw new Error(`Missing required OCI setting ${name}.`);return value;}
export function getOciScreeningConfig():OciScreeningConfig {
  return {
    region:required("OCI_REGION"),compartmentId:required("OCI_COMPARTMENT_ID"),namespaceName:required("OCI_OBJECT_NAMESPACE"),
    inputBucketName:required("OCI_SPEECH_INPUT_BUCKET"),outputBucketName:required("OCI_SPEECH_OUTPUT_BUCKET"),
    inputPrefix:(process.env.OCI_SPEECH_INPUT_PREFIX||"si").replace(/^\/+|\/+$/g,""),
    outputPrefix:(process.env.OCI_SPEECH_OUTPUT_PREFIX||"so").replace(/^\/+|\/+$/g,""),
    languageCode:process.env.OCI_SPEECH_LANGUAGE_CODE||"en-IN",modelType:process.env.OCI_SPEECH_MODEL_TYPE||"ORACLE",
  };
}
async function authProvider(){
  const method=(process.env.OCI_AUTH_METHOD||"config").toLowerCase();
  if(method==="instance_principal")return new common.InstancePrincipalsAuthenticationDetailsProviderBuilder().build();
  if(method==="resource_principal")return common.ResourcePrincipalAuthenticationDetailsProvider.builder();
  if(method!=="config")throw new Error("OCI_AUTH_METHOD must be config, instance_principal, or resource_principal.");
  const supplied=process.env.OCI_CONFIG_FILE?.trim();
  const configFile=supplied?.startsWith("~/")||supplied?.startsWith("~\\")?join(homedir(),supplied.slice(2)):supplied;
  return new common.ConfigFileAuthenticationDetailsProvider(configFile,process.env.OCI_CONFIG_PROFILE||"DEFAULT");
}
let clientsPromise:Promise<{speech:aispeech.AIServiceSpeechClient;objects:objectstorage.ObjectStorageClient}>|undefined;
async function clients(){
  if(!clientsPromise)clientsPromise=(async()=>{const provider=await authProvider();const cfg=getOciScreeningConfig();
    const speech=new aispeech.AIServiceSpeechClient({authenticationDetailsProvider:provider});
    const objects=new objectstorage.ObjectStorageClient({authenticationDetailsProvider:provider});
    speech.regionId=cfg.region;objects.regionId=cfg.region;return {speech,objects};})();
  return clientsPromise;
}
export function recordingObjectNames(candidateId:number,screeningId:number,fileName:string,attemptId:string=randomUUID()){
  const cfg=getOciScreeningConfig();const safe=fileName.replace(/[^a-zA-Z0-9._-]+/g,"_").slice(-80),shortAttempt=attemptId.replace(/[^a-zA-Z0-9_-]/g,"").slice(0,16);
  return {attemptId,inputObjectName:`${cfg.inputPrefix}/${screeningId}/${shortAttempt}/${safe}`,outputPrefix:`${cfg.outputPrefix}/${screeningId}/${shortAttempt}/`};
}
export async function putRecording(objectName:string,body:Buffer,requestId:string){
  const cfg=getOciScreeningConfig();const {objects}=await clients();
  const request={namespaceName:cfg.namespaceName,bucketName:cfg.inputBucketName,objectName,contentLength:body.length,contentType:"audio/mp4",ifNoneMatch:"*",opcClientRequestId:requestId,opcMeta:{purpose:"candidate-screening"}};
  return loggedOciCall("ObjectStorage.PutObject",request,()=>objects.putObject({...request,putObjectBody:body}),(response)=>({opcRequestId:response.opcRequestId??null,eTag:response.eTag??null,lastModified:response.lastModified??null}));
}
export async function createSpeechJob(input:{objectName:string;outputPrefix:string;displayName:string;retryToken:string;requestId:string;attemptId:string;candidateId:number;screeningId:number}){
  const cfg=getOciScreeningConfig();const {speech}=await clients();
  const request:aispeech.requests.CreateTranscriptionJobRequest={
    opcRetryToken:input.retryToken,opcRequestId:input.requestId,
    createTranscriptionJobDetails:{
      compartmentId:cfg.compartmentId,displayName:input.displayName,description:"InnoHire candidate screening call transcription",
      additionalTranscriptionFormats:[aispeech.models.CreateTranscriptionJobDetails.AdditionalTranscriptionFormats.Srt],
      modelDetails:{modelType:cfg.modelType,domain:aispeech.models.TranscriptionModelDetails.Domain.Generic,languageCode:cfg.languageCode as aispeech.models.TranscriptionModelDetails.LanguageCode,transcriptionSettings:{diarization:{isDiarizationEnabled:true,numberOfSpeakers:2}}},
      inputLocation:{locationType:"OBJECT_LIST_INLINE_INPUT_LOCATION",objectLocations:[{namespaceName:cfg.namespaceName,bucketName:cfg.inputBucketName,objectNames:[input.objectName]}]},
      outputLocation:{namespaceName:cfg.namespaceName,bucketName:cfg.outputBucketName,prefix:input.outputPrefix},
      freeformTags:{innohireAttemptId:input.attemptId,candidateId:String(input.candidateId),screeningId:String(input.screeningId)},
    },
  };
  return loggedOciCall("Speech.CreateTranscriptionJob",request,()=>speech.createTranscriptionJob(request),(response)=>({opcRequestId:response.opcRequestId??null,transcriptionJob:{id:response.transcriptionJob.id,lifecycleState:response.transcriptionJob.lifecycleState,displayName:response.transcriptionJob.displayName,timeAccepted:response.transcriptionJob.timeAccepted}}));
}
export async function reconcileSpeechJob(displayName:string,attemptId:string){
  const cfg=getOciScreeningConfig();const {speech}=await clients();
  let page:string|undefined;
  for(let requestNumber=0;requestNumber<3;requestNumber++){
    const request={compartmentId:cfg.compartmentId,displayName,limit:50,page};
    const response=await loggedOciCall("Speech.ListTranscriptionJobs",request,()=>speech.listTranscriptionJobs(request),(value)=>({opcRequestId:value.opcRequestId??null,opcNextPage:value.opcNextPage??null,count:value.transcriptionJobCollection.items.length,jobs:value.transcriptionJobCollection.items.map((job)=>({id:job.id,displayName:job.displayName,lifecycleState:job.lifecycleState,timeAccepted:job.timeAccepted}))}));
    const match=response.transcriptionJobCollection.items.find((job)=>job.displayName===displayName&&job.freeformTags?.innohireAttemptId===attemptId);
    if(match)return match;
    page=response.opcNextPage||undefined;if(!page)break;
  }
  return null;
}
export async function getSpeechJobState(jobId:string){
  const {speech}=await clients();
  const jobRequest={transcriptionJobId:jobId};
  const jobResponse=await loggedOciCall("Speech.GetTranscriptionJob",jobRequest,()=>speech.getTranscriptionJob(jobRequest),(value)=>({opcRequestId:value.opcRequestId??null,job:{id:value.transcriptionJob.id,displayName:value.transcriptionJob.displayName,lifecycleState:value.transcriptionJob.lifecycleState,lifecycleDetails:value.transcriptionJob.lifecycleDetails,percentComplete:value.transcriptionJob.percentComplete,timeAccepted:value.transcriptionJob.timeAccepted,timeFinished:value.transcriptionJob.timeFinished}}));
  const job=jobResponse.transcriptionJob;
  const listRequest={transcriptionJobId:jobId,limit:25};
  const listResponse=await loggedOciCall("Speech.ListTranscriptionTasks",listRequest,()=>speech.listTranscriptionTasks(listRequest),(value)=>({opcRequestId:value.opcRequestId??null,count:value.transcriptionTaskCollection.items.length,tasks:value.transcriptionTaskCollection.items.map((task)=>({id:task.id,lifecycleState:task.lifecycleState,percentComplete:task.percentComplete}))}));
  const tasks=await Promise.all(listResponse.transcriptionTaskCollection.items.map(async(item)=>{
    const taskRequest={transcriptionJobId:jobId,transcriptionTaskId:item.id};
    const taskResponse=await loggedOciCall("Speech.GetTranscriptionTask",taskRequest,()=>speech.getTranscriptionTask(taskRequest),(value)=>({opcRequestId:value.opcRequestId??null,task:{id:value.transcriptionTask.id,lifecycleState:value.transcriptionTask.lifecycleState,lifecycleDetails:value.transcriptionTask.lifecycleDetails,percentComplete:value.transcriptionTask.percentComplete,inputLocation:value.transcriptionTask.inputLocation,outputLocation:value.transcriptionTask.outputLocation}}));
    return taskResponse.transcriptionTask;
  }));
  return {job,tasks};
}
async function streamBuffer(value:NodeJS.ReadableStream|ReadableStream){
  if("getReader" in value){const reader=value.getReader();const chunks:Uint8Array[]=[];for(;;){const {done,value:chunk}=await reader.read();if(done)break;if(chunk)chunks.push(chunk);}return Buffer.concat(chunks.map((chunk)=>Buffer.from(chunk)));}
  const chunks:Buffer[]=[];for await(const chunk of value as AsyncIterable<Buffer|string>)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));return Buffer.concat(chunks);
}
export async function getTranscriptObjectJson(namespaceName:string,bucketName:string,objectName:string){
  const {objects}=await clients();const request={namespaceName,bucketName,objectName};
  const response=await loggedOciCall("ObjectStorage.GetObject",request,()=>objects.getObject(request),(value)=>({opcRequestId:value.opcRequestId??null,eTag:value.eTag??null,contentLength:value.contentLength??null,contentType:value.contentType??null,lastModified:value.lastModified??null}));
  const body=await streamBuffer(response.value);if(body.length>25*1024*1024)throw new Error("OCI Speech transcript is larger than 25 MB.");
  return JSON.parse(body.toString("utf8")) as unknown;
}
export function isRetryableOciError(error:unknown){
  const status=typeof error==="object"&&error&&"statusCode" in error?Number((error as {statusCode?:unknown}).statusCode):0;
  return !status||status===408||status===409||status===429||status>=500;
}
