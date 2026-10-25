import { expect, it } from "vitest";
import { createDatabase } from "../../shared/database/client";
import { makeTestAuthContext } from "../../testing/authContext";
import { sharedDtsiPublicationSource } from "./source";
import { compareSharedDtsiVersions } from "./comparison";
import { readSharedDtsiCompatibleEvidence, bindSharedDtsiProposalEvidence } from "./recognition";
import type { ProposalCommand } from "../parameter-governance/proposals/command";
import { createAgentInvocation } from "../auth/trustedInvocation";
import { listSharedDtsiResources } from "./service";

const receipt={schemaVersion:"dts-cpp/v1",image:`gcc@sha256:${"0".repeat(64)}`,platform:"linux/amd64",compilerVersion:"14.2.0",
  language:"c17",encoding:"UTF-8",locale:"C",inputDigest:`sha256:${"1".repeat(64)}`,outputDigest:`sha256:${"2".repeat(64)}`} as const;

async function fixture() {
  const auth=makeTestAuthContext(),resourceId="00000000-0000-4000-8000-000000000001";
  const draft={id:"00000000-0000-4000-8000-000000000002",resourceId,name:"Historical source",revision:1,
    updatedAt:"2026-10-24T00:00:00.000Z",changeDescription:"Publish exact source",
    sourceEvidence:{digest:`sha256:${"3".repeat(64)}`},
    members:[{id:"00000000-0000-4000-8000-000000000003",sourceName:"shared.dtsi",content:'/ { unit { compatible="review,source"; }; };'}]};
  const source=await sharedDtsiPublicationSource(draft);
  const before="00000000-0000-4000-8000-000000000004",after="00000000-0000-4000-8000-000000000005";
  const version=(id:string)=>({id,resourceId,version:1,name:draft.name,changeDescription:draft.changeDescription,
    digest:source.digest,createdAt:new Date(draft.updatedAt),createdByUserId:auth.user.id,manifest:structuredClone(source.manifest)});
  const rows=[version(before),version(after)];
  const db=createDatabase({query:async<Row>(sql:string,values:unknown[]=[])=>{
    expect(sql).toMatch(/^select /);
    const result=sql.startsWith("select count(*)")?[{count:"1"}]
      :sql.startsWith("select r.id as")?[{resourceId,name:draft.name,updatedAt:new Date(draft.updatedAt),sourceName:"shared.dtsi",draftRevision:null,
        currentVersion:{...rows[0]!,createdAt:draft.updatedAt}}]
      :sql.startsWith("select source_name as")?[]
      :sql.includes("from public.shared_dtsi_revisions")?rows.filter(row=>row.id===values[0])
      :sql.includes("from public.shared_dtsi_revision_members")?source.members:null;
    if(!result)throw new Error(`Unexpected query: ${sql}`);
    return {rows:result as Row[],rowCount:result.length};
  }});
  return {auth,resourceId,source,before,after,rows,db};
}

it("compares a historical manifest without the derived selector projection and preserves opaque origin evidence",async()=>{
  const f=await fixture();
  delete f.rows[0]!.manifest.compatibleSelectors;
  // PostgreSQL JSONB object key order is irrelevant; arrays and all immutable values remain exact.
  const old=f.rows[0]!.manifest;
  f.rows[0]!.manifest={...old,members:old.members.map(member=>({role:member.role,sizeBytes:member.sizeBytes,
    checksum:member.checksum,sourceName:member.sourceName,id:member.id}))};
  const result=await compareSharedDtsiVersions(f.db,f.auth,f.resourceId,f.before,f.after);
  expect(result.semantic.before).toContain("review,source");
  expect(result.semantic.before).toBe(result.semantic.after);
  expect((await readSharedDtsiCompatibleEvidence(f.db,f.auth,f.resourceId,f.before)).items[0]?.compatibles).toEqual(["review,source"]);
  expect(f.rows[0]!.manifest.sourceEvidence).toEqual(f.source.manifest.sourceEvidence);
  expect(f.rows[0]!.manifest).not.toHaveProperty("compatibleSelectors");
});

it.each(["receipt","stored projection","source checksum"] as const)("rejects frozen %s drift in comparison and source recognition",async drift=>{
  const f=await fixture(),manifest=f.rows[0]!.manifest;
  if(drift==="receipt")manifest.buildInputs.preprocessing=receipt;
  else if(drift==="stored projection")manifest.compatibleSelectors=["forged,selector"];
  else manifest.members[0]!.checksum=`sha256:${"4".repeat(64)}`;
  await expect(compareSharedDtsiVersions(f.db,f.auth,f.resourceId,f.before,f.after)).rejects.toMatchObject({code:"CONFLICT"});
  await expect(readSharedDtsiCompatibleEvidence(f.db,f.auth,f.resourceId,f.before)).rejects.toMatchObject({code:"CONFLICT"});
});

it("verifies frozen legacy source before caching search selectors and does not cache failures",async()=>{
  const f=await fixture(),manifest=f.rows[0]!.manifest;
  delete manifest.compatibleSelectors;
  manifest.buildInputs.preprocessing=receipt;
  await expect(listSharedDtsiResources(f.db,f.auth,{q:"review,source",offset:0,limit:20})).rejects.toMatchObject({code:"CONFLICT"});
  delete manifest.buildInputs.preprocessing;
  expect((await listSharedDtsiResources(f.db,f.auth,{q:"review,source",offset:0,limit:20})).items).toContainEqual(expect.objectContaining({resourceId:f.resourceId}));
});

it.each(["missing","agent"])("rejects %s human provenance before resolving source-bound proposal evidence",async kind=>{
  const f=await fixture();
  const command={payload:{kind:"source-recognition",sourceReference:{resourceId:f.resourceId,versionId:f.before,nodeLocator:"/unit",compatible:"review,source"}},
    context:{actorKind:"org-admin",principalId:f.auth.user.id,...(kind==="agent"?{invocation:createAgentInvocation(f.auth,
      {sessionId:"t21-source-test",toolCallId:"source-proposal",approval:{required:false}})}:{})}} as unknown as ProposalCommand;
  await expect(bindSharedDtsiProposalEvidence(f.db,command)).rejects.toMatchObject({code:"FORBIDDEN"});
});
