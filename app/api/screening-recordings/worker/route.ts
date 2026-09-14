import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processDueRecordingWorkflows } from "@/lib/screening/recording-workflow";
import { publicRecordingStatus } from "@/lib/screening/recording";

export const runtime="nodejs";
export const maxDuration=120;
function authorized(request:Request){
  const expected=process.env.OCI_WORKER_SECRET||process.env.CRON_SECRET;if(!expected)return false;
  const bearer=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"")||request.headers.get("x-worker-secret")||"";
  const a=Buffer.from(bearer),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);
}
async function run(request:Request){
  if(!authorized(request))return NextResponse.json({error:"Unauthorized."},{status:401});
  try{const body=request.method==="POST"?await request.json().catch(()=>({})) as {runAnalysis?:unknown}:{};const workflows=await processDueRecordingWorkflows(5,body.runAnalysis!==false);return NextResponse.json({processed:workflows.length,recordings:workflows.map((item)=>item?publicRecordingStatus(item):null)},{headers:{"cache-control":"no-store"}});}
  catch(error){console.error("Recording worker failed",error instanceof Error?error.message:"Unknown error");return NextResponse.json({error:"The recording worker could not complete this run."},{status:500});}
}
export const GET=run;
export const POST=run;

