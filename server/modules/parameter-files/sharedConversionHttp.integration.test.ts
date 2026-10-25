import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import { makeTestAuthContext } from "../../testing/authContext";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { installDriverSourceFixture } from "../../testing/parameterCatalog/driverSource";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../catalog-publication/runtime/provisionRuntimeLogins";
import { createLocalObjectStore, type ObjectStore } from "../logs/objectStore";
import { asValueClient, listCatalogBindingRowsForProject, loadPublishedCatalog, syncPublishedCatalogProjectValuesInTransaction } from "../parameter-bindings/catalogProjectValueSync";
import { registerCatalogProjectValueConsumerRoutes } from "../parameter-bindings/catalogProjectValueRoutes";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import { registerSharedDtsiRoutes } from "../shared-dtsi/routes";
import { addConfigSetFile, createConfigSet } from "./configSetService";
import { registerParameterFileRoutes } from "./routes";
import { uploadProjectParameterFile } from "./service";
import type { MemberAdditionPreview } from "./canonicalMemberAddition";
import type { SharedDtsiVersion } from "../contracts/dtoSchemas/sharedDtsi";
import { createBaseline, type RestorePreviewResult } from "./baselineService";
import { evaluateReleaseReadiness } from "./releaseReadinessService";
import type { SourceRevisionPreview } from "./sourceRevisionService";
import { randomUUID } from "node:crypto";
import { insertFileVersion, insertProjectParameterFile, setCurrentVersion } from "./repository";

const ORG="org-private-conversion",USER="conversion-admin",A="conversion-a",B="conversion-b";
const admin=makeTestAuthContext({organizationId:ORG,userId:USER,roles:[{roleId:"admin",projectId:null}]});
const root='/dts-v1/;\n/include/ "power.dtsi"\n/ { compatible = "test,board"; model = "Private conversion"; };\n';
const fragment='/ { charger: charger { compatible = "acme,power"; iin_max = <36>; }; };\n';
const override='/dts-v1/; /plugin/; &charger { iin_max = <48>; };\n';

describe("explicit private source conversion through the real API role",{timeout:120_000},()=>{
  let lane:Awaited<ReturnType<typeof createEphemeralTestDatabase>>,db:ReturnType<typeof createPostgresDatabase>,api:ReturnType<typeof createPostgresDatabase>;
  let directory:string,storage:ReturnType<typeof createLocalObjectStore>;
  let promoted:SharedDtsiVersion;
  const sets:Record<string,string>={},selected:Record<string,{fileId:string;fileVersionId:string;configRevisionId:string}>={};
  const token=`conversion_${process.pid}`;
  function server(auth=admin,sourceStore:ObjectStore=storage){const router=createRouter();
    registerSharedDtsiRoutes(router,{db:api,objectStore:sourceStore,getCurrentAuthContext:()=>auth});
    registerCatalogProjectValueConsumerRoutes(router,{db:api,objectStore:sourceStore,getCurrentAuthContext:()=>auth});
    registerParameterFileRoutes(router,{db:api,objectStore:sourceStore,getCurrentAuthContext:()=>auth,refusalAuditSink:createTrustedRefusalAuditSink(db)});
    return createHttpServer(router);
  }
  const post=<T,>(path:string,body:unknown)=>requestJson<T>(server(),path,{method:"POST",body:JSON.stringify(body)});
  const files=(project:string)=>requestJson<{items:Array<{fileId:string;currentVersionId:string;sharedReference?:unknown}>}>(server(),`/api/v1/projects/${project}/config-sets/${sets[project]}/files`);
  const path=(project:string)=>`/api/v1/projects/${project}/config-sets/${sets[project]}/member-addition`;
  async function publish(resourceId:string,revision:number,key:string){
    const draft=await requestJson<{item:{name:string;members:unknown[];buildInputs:unknown;dependencies:unknown[]}}>(server(),`/api/v2/shared-dtsi/${resourceId}`);
    const {name,members,buildInputs,dependencies}=draft.body.item;
    const saved=await requestJson(server(),`/api/v2/shared-dtsi/${resourceId}/draft`,{method:"PUT",body:JSON.stringify({name,members,buildInputs,dependencies,changeDescription:"Publish exact private source",expectedRevision:revision})});expect(saved.status,saved.bodyText).toBe(200);revision++;
    const preview=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${resourceId}/publication-preview`,{expectedRevision:revision});expect(preview.status,preview.bodyText).toBe(201);
    const result=await post<{item:SharedDtsiVersion}>(`/api/v2/shared-dtsi/${resourceId}/publications`,{previewId:preview.body.item.id,idempotencyKey:key});expect(result.status,result.bodyText).toBe(201);return result.body.item;
  }
  beforeAll(async()=>{
    lane=await createEphemeralTestDatabase("private-conversion");db=createPostgresDatabase(lane.url);
    directory=await mkdtemp(join(tmpdir(),"wiseeff-conversion-"));storage=createLocalObjectStore(directory);
    await db.query("insert into organizations(id,name) values ($1,'Conversion')",[ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Conversion admin','Admin',true)",[USER,ORG]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('conversion-role',$1,$2,'admin')",[USER,ORG]);
    await installDriverSourceFixture(db,admin,{subjectId:"csub_acme_power",compatible:"acme,power",businessName:"Conversion",driverName:"Power",idempotencyKey:"conversion-register",reason:"Private conversion acceptance"});
    for(const projectId of [A,B]){
      await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,$1,$1,'initialized')",[projectId,ORG]);
      const configSetId=sets[projectId]=(await createConfigSet(db,admin,{projectId,name:"Mixed private configuration"})).id;
      const members=[];
      for(const [sortOrder,member] of [{fileName:"board.dts",content:root,role:"base" as const},{fileName:"power.dtsi",content:fragment,role:"include" as const},
        {fileName:"limits.dts",content:override,role:"overlay" as const},{fileName:"private.json",content:'{"keep":true}',role:"thermal" as const}].entries()){
        const uploaded=await uploadProjectParameterFile(db,storage,admin,{projectId,fileName:member.fileName,bytes:Buffer.from(member.content)});
        await addConfigSetFile(db,admin,{configSetId,fileId:uploaded.file.id,role:member.role==="include"?"misc":member.role,sortOrder});
        members.push({...member,fileId:uploaded.file.id,fileVersionId:uploaded.version.id,sortOrder,format:uploaded.file.format});
        if(member.role==="include")selected[projectId]={fileId:uploaded.file.id,fileVersionId:uploaded.version.id,configRevisionId:""};
      }
      const revision=await ingestConfigRevision(db,{organizationId:ORG,projectId,configSetId,entryFile:"board.dts",includeSearchPaths:["."],overlayOrder:["limits.dts"],members},admin);
      expect(revision.status).toBe("resolved");selected[projectId]!.configRevisionId=revision.id;
      const catalog=await loadPublishedCatalog(getRootPostgresPool(db)!);
      await db.transaction(tx=>syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx),catalog!,{organizationId:ORG,projectId,configSetId,configRevisionId:revision.id}));
    }
    api=createPostgresDatabase((await provisionPublicationRuntimeLogins(lane.url,{mode:"lab",runToken:token})).apiUrl);
    expect((await api.query("select rolsuper,rolinherit from pg_roles where rolname=current_user")).rows[0]).toEqual({rolsuper:false,rolinherit:false});
  },120_000);
  afterAll(async()=>{await api?.close();if(lane)await dropLabRuntimeLogins(lane.url,token);await db?.close();await lane?.drop();if(directory)await rm(directory,{recursive:true,force:true});},120_000);

  it("previews and atomically converts the selected private closure, preserving every eligible identity and other project",async()=>{
    const beforeA=await files(A),beforeB=await files(B),beforeBindings=await listCatalogBindingRowsForProject(api,admin,{projectId:A});
    const historyPath=`/api/v2/projects/${A}/parameter-bindings/${beforeBindings[0]!.id}/change-history`;
    const beforeHistory=await requestJson<{items:unknown[]}>(server(),historyPath);expect(beforeHistory.status,beforeHistory.bodyText).toBe(200);
    const gate=await evaluateReleaseReadiness(api,admin,{configSetId:sets[A]!},{objectStore:storage});expect(gate.canCreateBaseline,JSON.stringify(gate)).toBe(true);
    const baseline=await createBaseline(api,admin,{configSetId:sets[A]!,name:"Private snapshot before conversion",gateToken:gate.gateToken,acknowledgedWarningIds:gate.warnings.filter(row=>row.acknowledgementRequired).map(row=>row.id)},{},{objectStore:storage});
    const imported=await post<{item:{resourceId:string}}>(`/api/v2/projects/${A}/config-sets/${sets[A]}/shared-dtsi`,{...selected[A],name:"Published private power"});expect(imported.status,imported.bodyText).toBe(201);
    const version=promoted=await publish(imported.body.item.resourceId,1,"private-conversion-publish");
    expect((await files(A)).body).toEqual(beforeA.body);
    const body={sharedReference:{resourceId:version.resourceId,versionId:version.id,convertPrivate:selected[A]},role:"misc",sortOrder:0};
    const preview=await post<{item:MemberAdditionPreview}>(`${path(A)}/preview`,body);expect(preview.status,preview.bodyText).toBe(200);
    expect(preview.body.item).toMatchObject({sharedConversion:{semanticEqual:true,identitiesRetained:true},impact:{parameterChanges:0,nodeAdditions:0,nodeRemovals:0,retainedBindings:1}});
    expect(preview.body.item.rootEdit).toBeUndefined();expect(preview.body.item.members.map(member=>member.fileId)).toEqual(beforeA.body.items.map(member=>member.fileId));
    expect((await files(A)).body).toEqual(beforeA.body);
    const applied=await post<{item:{configRevisionId:string;fileId:string;fileVersionId:string}}>(`${path(A)}/apply`,{...body,proofToken:preview.body.item.proofToken,reason:"Convert this private closure",clientMutationId:"private-conversion-apply"});expect(applied.status,applied.bodyText).toBe(200);
    expect(applied.body.item).toMatchObject({fileId:selected[A]!.fileId,fileVersionId:selected[A]!.fileVersionId});
    const after=await files(A);expect(after.body.items.map(member=>[member.fileId,member.currentVersionId])).toEqual(beforeA.body.items.map(member=>[member.fileId,member.currentVersionId]));
    expect(after.body.items.filter(member=>member.sharedReference)).toEqual([expect.objectContaining({fileId:selected[A]!.fileId,sharedReference:expect.objectContaining({resourceId:version.resourceId,versionId:version.id,readOnly:true})})]);
    expect((await listCatalogBindingRowsForProject(api,admin,{projectId:A})).map(row=>({id:row.id,logicalNodeId:row.logicalNodeId,rawValue:row.rawValue}))).toEqual(beforeBindings.map(row=>({id:row.id,logicalNodeId:row.logicalNodeId,rawValue:row.rawValue})));
    const history=await requestJson<{items:Array<{oldCurrentValueId:string;newCurrentValueId:string}>}>(server(),historyPath);expect(history.status,history.bodyText).toBe(200);
    expect(history.body.items).toEqual(expect.arrayContaining(beforeHistory.body.items));expect(history.body.items).toContainEqual(expect.objectContaining({oldCurrentValueId:beforeBindings[0]!.currentValueId}));
    expect((await files(B)).body).toEqual(beforeB.body);
    expect((await post(`${path(A)}/apply`,{...body,proofToken:preview.body.item.proofToken,reason:"Convert this private closure",clientMutationId:"private-conversion-apply"})).body).toEqual(applied.body);
    expect((await post(`${path(A)}/apply`,{...body,proofToken:preview.body.item.proofToken,reason:"Stale conversion",clientMutationId:"private-conversion-stale"})).status).toBe(409);
    const originalSharedVersion=(await api.query<{checksum:string;storage_key:string}>("select checksum,storage_key from public.project_parameter_file_versions where id=$1",[selected[A]!.fileVersionId])).rows[0]!;
    expect(originalSharedVersion.checksum).toMatch(/^[a-f0-9]{64}$/u);
    expect(version.members[0]!.checksum).toBe(`sha256:${originalSharedVersion.checksum}`);
    const sharedGate=await evaluateReleaseReadiness(api,admin,{configSetId:sets[A]!},{objectStore:storage});expect(sharedGate.canCreateBaseline,JSON.stringify(sharedGate)).toBe(true);
    const sharedBaseline=await createBaseline(api,admin,{configSetId:sets[A]!,name:"Shared snapshot after conversion",gateToken:sharedGate.gateToken,acknowledgedWarningIds:sharedGate.warnings.filter(row=>row.acknowledgementRequired).map(row=>row.id)},{},{objectStore:storage});
    const objects=await readdir(directory,{recursive:true});
    const refused=await post(`/api/v1/projects/${A}/parameter-file-candidates`,{fileId:selected[A]!.fileId,fileName:"power.dtsi",intent:"source_revision",contentBase64:Buffer.from(fragment).toString("base64"),expectedCurrentVersionId:selected[A]!.fileVersionId,expectedConfigRevisionId:applied.body.item.configRevisionId,clientMutationId:"conversion-readonly"});expect(refused.status,refused.bodyText).toBe(409);
    expect(await readdir(directory,{recursive:true})).toEqual(objects);
    const local=beforeA.body.items[2]!;
    const candidate=await post<{item:{id:string}}>(`/api/v1/projects/${A}/parameter-file-candidates`,{fileId:local.fileId,fileName:"limits.dts",intent:"source_revision",contentBase64:Buffer.from(override.replace("<48>","<55>")).toString("base64"),expectedCurrentVersionId:local.currentVersionId,expectedConfigRevisionId:applied.body.item.configRevisionId,clientMutationId:"conversion-local-edit"});expect(candidate.status,candidate.bodyText).toBe(201);
    const localPreview=await requestJson<{item:SourceRevisionPreview}>(server(),`/api/v1/projects/${A}/parameter-file-candidates/${candidate.body.item.id}/source-preview`);expect(localPreview.status,localPreview.bodyText).toBe(200);
    const localApplied=await post(`/api/v1/projects/${A}/parameter-file-candidates/${candidate.body.item.id}/source-apply`,{expectedCurrentVersionId:local.currentVersionId,expectedProofToken:localPreview.body.item.proofToken,reason:"Private local override survives conversion",clientMutationId:"conversion-local-apply"});expect(localApplied.status,localApplied.bodyText).toBe(200);
    expect((await listCatalogBindingRowsForProject(api,admin,{projectId:A}))[0]!.rawValue).toBe("<55>");
    const sharedRestorePreview=await requestJson<{item:RestorePreviewResult}>(server(),`/api/v1/projects/${A}/baselines/${sharedBaseline.id}/restore-preview`);expect(sharedRestorePreview.status,sharedRestorePreview.bodyText).toBe(200);expect(sharedRestorePreview.body.item.canonical?.canRestore,JSON.stringify(sharedRestorePreview.body)).toBe(true);
    const sharedRestored=await post<{item:{configRevisionId:string}}>(`/api/v1/projects/${A}/baselines/${sharedBaseline.id}/rollback`,{proofToken:sharedRestorePreview.body.item.canonical!.proofToken,sourceConfigRevisionId:applied.body.item.configRevisionId,reason:"Restore converted shared closure and private override",confirmCompositionChanges:true,clientMutationId:"conversion-restore-shared"});expect(sharedRestored.status,sharedRestored.bodyText).toBe(200);
    expect((await files(A)).body.items.filter(member=>member.sharedReference)).toEqual([expect.objectContaining({fileId:selected[A]!.fileId,sharedReference:expect.objectContaining({resourceId:version.resourceId,versionId:version.id,readOnly:true})})]);
    expect((await listCatalogBindingRowsForProject(api,admin,{projectId:A}))[0]).toMatchObject({id:beforeBindings[0]!.id,logicalNodeId:beforeBindings[0]!.logicalNodeId,rawValue:"<48>"});
    expect((await api.query("select checksum,storage_key from public.project_parameter_file_versions where id=$1",[selected[A]!.fileVersionId])).rows[0]).toEqual(originalSharedVersion);
    await expect(api.query("update public.project_parameter_file_versions set parsed_index='{}'::jsonb where id=$1",[selected[A]!.fileVersionId])).rejects.toMatchObject({code:"55000"});
    expect((await post(`/api/v1/projects/${A}/parameter-file-candidates`,{fileId:selected[A]!.fileId,fileName:"power.dtsi",intent:"source_revision",contentBase64:Buffer.from(fragment).toString("base64"),expectedCurrentVersionId:(await files(A)).body.items.find(member=>member.fileId===selected[A]!.fileId)!.currentVersionId,expectedConfigRevisionId:sharedRestored.body.item.configRevisionId,clientMutationId:"restored-shared-readonly"})).status).toBe(409);
    const restorePreview=await requestJson<{item:RestorePreviewResult}>(server(),`/api/v1/projects/${A}/baselines/${baseline.id}/restore-preview`);expect(restorePreview.status,restorePreview.bodyText).toBe(200);expect(restorePreview.body.item.canonical?.canRestore,JSON.stringify(restorePreview.body)).toBe(true);
    const restored=await post<{item:{configRevisionId:string}}>(`/api/v1/projects/${A}/baselines/${baseline.id}/rollback`,{proofToken:restorePreview.body.item.canonical!.proofToken,sourceConfigRevisionId:selected[A]!.configRevisionId,reason:"Restore actual private ownership and bytes",confirmCompositionChanges:true,clientMutationId:"conversion-restore-private"});expect(restored.status,restored.bodyText).toBe(200);
    expect((await files(A)).body.items.every(member=>!member.sharedReference)).toBe(true);
    expect((await listCatalogBindingRowsForProject(api,admin,{projectId:A}))[0]).toMatchObject({id:beforeBindings[0]!.id,rawValue:"<48>"});
    const writable=await post<{item:{id:string}}>(`/api/v1/projects/${A}/parameter-file-candidates`,{fileId:selected[A]!.fileId,fileName:"power.dtsi",intent:"source_revision",contentBase64:Buffer.from(fragment.replace("<36>","<37>")).toString("base64"),expectedCurrentVersionId:selected[A]!.fileVersionId,expectedConfigRevisionId:restored.body.item.configRevisionId,clientMutationId:"restored-private-edit"});expect(writable.status,writable.bodyText).toBe(201);
    const privatePreview=await requestJson<{item:SourceRevisionPreview}>(server(),`/api/v1/projects/${A}/parameter-file-candidates/${writable.body.item.id}/source-preview`);expect(privatePreview.status,privatePreview.bodyText).toBe(200);
    const privateApplied=await post(`/api/v1/projects/${A}/parameter-file-candidates/${writable.body.item.id}/source-apply`,{expectedCurrentVersionId:selected[A]!.fileVersionId,expectedProofToken:privatePreview.body.item.proofToken,reason:"Ordinary private edit after exact restoration",clientMutationId:"restored-private-edit-apply"});expect(privateApplied.status,privateApplied.bodyText).toBe(200);
    await expect(api.query("update public.project_parameter_file_versions set parsed_index='{}'::jsonb where id=$1",[selected[A]!.fileVersionId])).rejects.toMatchObject({code:"55000"});
    expect((await files(B)).body).toEqual(beforeB.body);
  });
  it("refuses missing provenance, hidden default differences, stale or revoked inputs and rolls back the whole conversion and failed private restore",async()=>{
    const before=await files(B),bindings=await listCatalogBindingRowsForProject(api,admin,{projectId:B}),objects=await readdir(directory,{recursive:true});
    const plain=await post<{item:{resourceId:string}}>("/api/v2/shared-dtsi",{name:"Identical unproven copy",sourceName:"power.dtsi",content:fragment,changeDescription:"Identical bytes alone are not provenance"});expect(plain.status,plain.bodyText).toBe(201);
    const unproven=await publish(plain.body.item.resourceId,1,"unproven-same-bytes");
    const body={sharedReference:{resourceId:promoted.resourceId,versionId:promoted.id,convertPrivate:selected[B]},role:"misc",sortOrder:0};
    expect((await post(`${path(B)}/preview`,{...body,sharedReference:{...body.sharedReference,resourceId:unproven.resourceId,versionId:unproven.id}})).status).toBe(409);
    expect((await post(`${path(B)}/preview`,{...body,sharedReference:{...body.sharedReference,convertPrivate:{...selected[B],fileVersionId:selected[A]!.fileVersionId}}})).status).toBe(409);
    const draft=await post<{item:{revision:number;name:string;members:Array<{id:string;sourceName:string;content:string}>}}>(`/api/v2/shared-dtsi/${promoted.resourceId}/draft`,{baseVersionId:promoted.id});expect(draft.status,draft.bodyText).toBe(201);
    const edited=await requestJson(server(),`/api/v2/shared-dtsi/${promoted.resourceId}/draft`,{method:"PUT",body:JSON.stringify({name:draft.body.item.name,members:draft.body.item.members.map(member=>({...member,content:member.content.replace("<36>","<37>")})),expectedRevision:draft.body.item.revision,changeDescription:"Hidden by the same project override"})});expect(edited.status,edited.bodyText).toBe(200);
    const different=await publish(promoted.resourceId,2,"different-hidden-default");
    expect((await post(`${path(B)}/preview`,{...body,sharedReference:{...body.sharedReference,versionId:different.id}})).status).toBe(409);
    const brokenStore:ObjectStore={...storage,getBounded:async()=>{throw new Error("Missing source object");}};
    expect((await requestJson(server(admin,brokenStore),`${path(B)}/preview`,{method:"POST",body:JSON.stringify(body)})).status).toBe(409);
    const preview=await post<{item:MemberAdditionPreview}>(`${path(B)}/preview`,body);expect(preview.status,preview.bodyText).toBe(200);
    const applyBody={...body,proofToken:preview.body.item.proofToken,reason:"Explicitly convert only B now",clientMutationId:"convert-b"};
    expect((await post(`${path(B)}/apply`,{...applyBody,proofToken:"0".repeat(64),clientMutationId:"wrong-conversion-proof"})).status).toBe(409);
    await db.query("delete from user_role_bindings where id='conversion-role'");
    try{expect((await post(`${path(B)}/apply`,applyBody)).status).toBe(403);}finally{await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('conversion-role',$1,$2,'admin')",[USER,ORG]);}
    await db.query(`create function fail_conversion_audit() returns trigger language plpgsql as $$begin
      if new.metadata->>'operation'='convert_private_shared' then raise exception 'Injected conversion audit failure'; end if;return new;end $$`);
    await db.query("create trigger fail_conversion_audit before insert on public.audit_events for each row execute function fail_conversion_audit()");
    try{expect((await post(`${path(B)}/apply`,applyBody)).status).toBe(500);}finally{await db.query("drop trigger fail_conversion_audit on public.audit_events");await db.query("drop function fail_conversion_audit()");}
    expect((await files(B)).body).toEqual(before.body);
    expect((await listCatalogBindingRowsForProject(api,admin,{projectId:B})).map(row=>({id:row.id,value:row.currentValueId}))).toEqual(bindings.map(row=>({id:row.id,value:row.currentValueId})));
    expect(await readdir(directory,{recursive:true})).toEqual(objects);
    const gate=await evaluateReleaseReadiness(api,admin,{configSetId:sets[B]!},{objectStore:storage});expect(gate.canCreateBaseline,JSON.stringify(gate)).toBe(true);
    const baseline=await createBaseline(api,admin,{configSetId:sets[B]!,name:"Private B snapshot",gateToken:gate.gateToken,acknowledgedWarningIds:gate.warnings.filter(row=>row.acknowledgementRequired).map(row=>row.id)},{},{objectStore:storage});
    const attempts=await Promise.all([post(`${path(B)}/apply`,applyBody),post(`${path(B)}/apply`,{...applyBody,clientMutationId:"convert-b-concurrent"})]);expect(attempts.map(result=>result.status).sort()).toEqual([200,409]);
    const winner=attempts[0]!.status===200?applyBody:{...applyBody,clientMutationId:"convert-b-concurrent"};
    expect((await post(`${path(B)}/apply`,winner)).body).toEqual(attempts.find(result=>result.status===200)!.body);
    const readOnly=async()=>expect((await api.query<{restored:boolean}>("select public.shared_dtsi_private_source_is_restored($1) as restored",[selected[B]!.fileId])).rows[0]!.restored).toBe(false);
    await readOnly();
    await expect(api.query("delete from public.project_shared_dtsi_snapshots where file_id=$1",[selected[B]!.fileId])).rejects.toBeDefined();await readOnly();
    const foreign=(await db.query<{id:string}>("select id from public.project_parameter_value_change_requests where project_id=$1 and request_kind='configuration_restore' and status='approved'",[A])).rows[0]!.id;
    await expect(api.query("select public.restore_private_shared_dtsi_source($1,$2)",[foreign,selected[B]!.fileId])).rejects.toBeDefined();await readOnly();
    await expect(api.query("update public.project_parameter_value_change_requests set source_revision_context=source_revision_context||'{\"projectId\":\"conversion-b\"}'::jsonb where id=$1",[foreign])).rejects.toBeDefined();await readOnly();
    const restorePreview=await requestJson<{item:RestorePreviewResult}>(server(),`/api/v1/projects/${B}/baselines/${baseline.id}/restore-preview`);expect(restorePreview.status,restorePreview.bodyText).toBe(200);await readOnly();
    await db.query(`create function fail_private_restore_audit() returns trigger language plpgsql as $$begin
      if new.metadata->>'requestKind'='configuration_restore' then raise exception 'Injected private restore failure'; end if;return new;end $$`);
    await db.query("create trigger fail_private_restore_audit before insert on public.audit_events for each row execute function fail_private_restore_audit()");
    const beforeRestore=await files(B);
    try{expect((await post(`/api/v1/projects/${B}/baselines/${baseline.id}/rollback`,{proofToken:restorePreview.body.item.canonical!.proofToken,sourceConfigRevisionId:selected[B]!.configRevisionId,reason:"A pending or failed private restore cannot unlock shared source",confirmCompositionChanges:true,clientMutationId:"failed-private-restore"})).status).toBe(500);}
    finally{await db.query("drop trigger fail_private_restore_audit on public.audit_events");await db.query("drop function fail_private_restore_audit()");}
    await readOnly();expect((await files(B)).body).toEqual(beforeRestore.body);
  });
  it("converts original CPP paths, BOM/CRLF, active and inactive headers while retaining project overrides and JSON",async()=>{
    const configSetId=(await createConfigSet(db,admin,{projectId:A,name:"Exact CPP private conversion"})).id;
    const sources=[
      {sourceName:"boards/cpp-board.dts",content:'/dts-v1/;\r\n#include "../parts/cpp-power.dtsi"\r\n/ { compatible = "test,board"; model = "CPP conversion"; };\r\n',role:"base" as const},
      {sourceName:"parts/cpp-power.dtsi",content:'\uFEFF#include <cpp-limits.h>\r\n#if 0\r\n#include "../headers/inactive-conversion.h"\r\n#endif\r\n/ { cppPower: charger { compatible = "acme,power"; iin_max = <(BASE + OFFSET)>; }; };\r\n',role:"include" as const},
      {sourceName:"headers/cpp-limits.h",content:'\uFEFF#define BASE 31\r\n',role:"include" as const},
      {sourceName:"headers/inactive-conversion.h",content:'#define INACTIVE 9\r\n',role:"include" as const},
      {sourceName:"overrides/cpp-local.dts",content:'/dts-v1/; /plugin/; &cppPower { iin_max = <48>; };\r\n',role:"overlay" as const},
      {sourceName:"software/cpp-private.json",content:'{"cppPrivate":true}',role:"thermal" as const},
      {sourceName:"headers/unselected-conversion.h",content:'#define UNSELECTED 7\r\n',role:"include" as const}
    ];
    const members=[];
    for(const [sortOrder,source] of sources.entries()){
      const stored=await storage.put({organizationId:ORG,fileName:randomUUID(),contentType:"text/plain",bytes:Buffer.from(source.content)});
      const file=await insertProjectParameterFile(db,{id:randomUUID(),organizationId:ORG,projectId:A,fileName:source.sourceName.split("/").at(-1)!,format:source.sourceName.endsWith(".json")?"json":"dts"});
      const version=await insertFileVersion(db,{id:randomUUID(),fileId:file.id,versionNumber:1,storageKey:stored.storageKey,checksum:stored.checksumSha256,sizeBytes:Buffer.byteLength(source.content),origin:"upload",createdByUserId:USER});
      await setCurrentVersion(db,{fileId:file.id,versionId:version.id});await addConfigSetFile(db,admin,{configSetId,fileId:file.id,role:source.role==="include"?"misc":source.role,sortOrder});
      members.push({...source,fileName:source.sourceName,fileId:file.id,fileVersionId:version.id,format:file.format,sortOrder});
    }
    const declaredBuildInputs={includeSearchPaths:["headers"],defines:{OFFSET:"5"}};
    const revision=await ingestConfigRevision(db,{organizationId:ORG,projectId:A,configSetId,entryFile:sources[0]!.sourceName,
      ...declaredBuildInputs,declaredBuildInputs,overlayOrder:[sources[4]!.sourceName],members},admin);expect(revision.status).toBe("resolved");
    const catalog=await loadPublishedCatalog(getRootPostgresPool(db)!);await db.transaction(tx=>syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx),catalog!,{organizationId:ORG,projectId:A,configSetId,configRevisionId:revision.id}));
    const root=members[0]!,filePath=`/api/v1/projects/${A}/config-sets/${configSetId}/files`;
    const before=(await requestJson<{items:unknown[]}>(server(),filePath)).body.items,objects=await readdir(directory,{recursive:true});
    const imported=await post<{item:{resourceId:string}}>(`/api/v2/projects/${A}/config-sets/${configSetId}/shared-dtsi`,{configRevisionId:revision.id,fileId:root.fileId,fileVersionId:root.fileVersionId,name:"Original CPP conversion"});expect(imported.status,imported.bodyText).toBe(201);
    const version=await publish(imported.body.item.resourceId,1,"cpp-conversion-publish");expect(version.members.map(member=>member.sourceName).sort()).toEqual(sources.slice(0,4).map(member=>member.sourceName).sort());
    for(const member of version.members)expect(member.content).toBe(sources.find(source=>source.sourceName===member.sourceName)!.content);
    const input={sharedReference:{resourceId:version.resourceId,versionId:version.id,convertPrivate:{configRevisionId:revision.id,fileId:root.fileId,fileVersionId:root.fileVersionId}},role:"misc",sortOrder:0};
    const endpoint=`/api/v1/projects/${A}/config-sets/${configSetId}/member-addition`;
    const derived=await post<{item:{name:string;revision:number;members:unknown[]}}>(`/api/v2/shared-dtsi/${version.resourceId}/draft`,{baseVersionId:version.id});expect(derived.status,derived.bodyText).toBe(201);
    const changedSettings=await requestJson(server(),`/api/v2/shared-dtsi/${version.resourceId}/draft`,{method:"PUT",body:JSON.stringify({name:derived.body.item.name,members:derived.body.item.members,buildInputs:{...declaredBuildInputs,defines:{OFFSET:"6"}},changeDescription:"A different CPP default is still hidden by the project override",expectedRevision:1})});expect(changedSettings.status,changedSettings.bodyText).toBe(200);
    const changed=await publish(version.resourceId,2,"cpp-different-settings");
    expect((await post(`${endpoint}/preview`,{...input,sharedReference:{...input.sharedReference,versionId:changed.id}})).status).toBe(409);
    const preview=await post<{item:MemberAdditionPreview}>(`${endpoint}/preview`,input);expect(preview.status,preview.bodyText).toBe(200);
    expect(preview.body.item.sharedConversion?.files.map(member=>member.sourceName).sort()).toEqual(sources.slice(0,4).map(member=>member.sourceName).sort());
    expect(preview.body.item).toMatchObject({entryFile:root.sourceName,includeSearchPaths:["headers"],overlayOrder:[sources[4]!.sourceName],impact:{parameterChanges:0,nodeAdditions:0,nodeRemovals:0}});
    const noCopyStore:ObjectStore={...storage,put:async()=>{throw new Error("Conversion must retain exact immutable objects");}};
    const applied=await requestJson(server(admin,noCopyStore),`${endpoint}/apply`,{method:"POST",body:JSON.stringify({...input,proofToken:preview.body.item.proofToken,reason:"Preserve exact CPP source and local ownership",clientMutationId:"cpp-conversion-apply"})});expect(applied.status,applied.bodyText).toBe(200);
    const after=(await requestJson<{items:Array<{fileId:string;currentVersionId:string;sharedReference?:unknown}>}>(server(),filePath)).body.items;
    expect(after.filter(member=>member.sharedReference).map(member=>member.fileId).sort()).toEqual(members.slice(0,4).map(member=>member.fileId).sort());
    expect(after.map(member=>({fileId:member.fileId,currentVersionId:member.currentVersionId}))).toEqual((before as Array<{fileId:string;currentVersionId:string}>).map(member=>({fileId:member.fileId,currentVersionId:member.currentVersionId})));
    expect(await readdir(directory,{recursive:true})).toEqual(objects);
  });
  it("restores private ownership immediately when every original version is identical and only the canonical restore receipt distinguishes current history",async()=>{
    const configSetId=(await createConfigSet(db,admin,{projectId:A,name:"Unchanged whole-source private restore"})).id;
    const content='/dts-v1/; / { compatible = "test,board"; model = "Private ownership restore"; charger: charger { compatible = "acme,power"; iin_max = <36>; }; };';
    const uploaded=await uploadProjectParameterFile(db,storage,admin,{projectId:A,fileName:"immediate-private.dts",bytes:Buffer.from(content)});
    await addConfigSetFile(db,admin,{configSetId,fileId:uploaded.file.id,role:"base",sortOrder:0});
    const revision=await ingestConfigRevision(db,{organizationId:ORG,projectId:A,configSetId,entryFile:"immediate-private.dts",includeSearchPaths:["."],overlayOrder:[],members:[{fileId:uploaded.file.id,fileVersionId:uploaded.version.id,fileName:"immediate-private.dts",role:"base",sortOrder:0,content}]},admin);
    const catalog=await loadPublishedCatalog(getRootPostgresPool(db)!);await db.transaction(tx=>syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx),catalog!,{organizationId:ORG,projectId:A,configSetId,configRevisionId:revision.id}));
    const gate=await evaluateReleaseReadiness(api,admin,{configSetId},{objectStore:storage});expect(gate.canCreateBaseline,JSON.stringify(gate)).toBe(true);
    const baseline=await createBaseline(api,admin,{configSetId,name:"All original private versions",gateToken:gate.gateToken,acknowledgedWarningIds:gate.warnings.filter(row=>row.acknowledgementRequired).map(row=>row.id)},{},{objectStore:storage});
    const selected={configRevisionId:revision.id,fileId:uploaded.file.id,fileVersionId:uploaded.version.id};
    const imported=await post<{item:{resourceId:string}}>(`/api/v2/projects/${A}/config-sets/${configSetId}/shared-dtsi`,{...selected,name:"Immediate private restoration"});expect(imported.status,imported.bodyText).toBe(201);
    const version=await publish(imported.body.item.resourceId,1,"immediate-private-publication");
    const endpoint=`/api/v1/projects/${A}/config-sets/${configSetId}/member-addition`,input={sharedReference:{resourceId:version.resourceId,versionId:version.id,convertPrivate:selected},role:"misc",sortOrder:0};
    const preview=await post<{item:MemberAdditionPreview}>(`${endpoint}/preview`,input);expect(preview.status,preview.bodyText).toBe(200);
    expect((await post(`${endpoint}/apply`,{...input,proofToken:preview.body.item.proofToken,reason:"Explicitly convert unchanged root",clientMutationId:"immediate-private-conversion"})).status).toBe(200);
    const restore=await requestJson<{item:RestorePreviewResult}>(server(),`/api/v1/projects/${A}/baselines/${baseline.id}/restore-preview`);expect(restore.status,restore.bodyText).toBe(200);
    const restored=await post(`/api/v1/projects/${A}/baselines/${baseline.id}/rollback`,{proofToken:restore.body.item.canonical!.proofToken,sourceConfigRevisionId:revision.id,reason:"Restore exact private ownership without changing any source bytes",confirmCompositionChanges:true,clientMutationId:"immediate-private-restore"});expect(restored.status,restored.bodyText).toBe(200);
    const files=await requestJson<{items:Array<{fileId:string;currentVersionId:string;sharedReference?:unknown}>}>(server(),`/api/v1/projects/${A}/config-sets/${configSetId}/files`);expect(files.body.items).toEqual([expect.objectContaining({fileId:uploaded.file.id,currentVersionId:uploaded.version.id})]);expect(files.body.items[0]!.sharedReference).toBeUndefined();
    expect((await api.query<{restored:boolean}>("select public.shared_dtsi_private_source_is_restored($1) as restored",[uploaded.file.id])).rows[0]!.restored).toBe(true);
  });
});
