import { mkdtemp, rm } from "node:fs/promises";
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
import { registerParameterTopologyRoutes } from "../parameter-topology/routes";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import { registerSharedDtsiRoutes } from "../shared-dtsi/routes";
import { addConfigSetFile, createConfigSet } from "./configSetService";
import { registerParameterFileRoutes } from "./routes";
import { uploadProjectParameterFile } from "./service";
import { createBaseline, type RestorePreviewResult } from "./baselineService";
import { evaluateReleaseReadiness } from "./releaseReadinessService";
import { captureConfigurationSourceState } from "../../testing/parameterCatalog/configurationSource";
import type { SourceRevisionPreview } from "./sourceRevisionService";
import type { MemberAdditionPreview } from "./canonicalMemberAddition";


const ORG = "org-shared-ref", ADMIN = "user-shared-ref", A = "shared-project-a", B = "shared-project-b";
const admin = makeTestAuthContext({ organizationId: ORG, userId: ADMIN, roles: [{ roleId: "admin", projectId: null }] });
const editor = makeTestAuthContext({ organizationId: ORG, userId: "shared-ref-editor", roles: [{ roleId: "hardware-user", projectId: A }] });
const source = '/dts-v1/;\n/include/ "private.dtsi"\n/ { compatible = "test,board"; model = "shared reference"; charger: charger { compatible = "acme,power"; iin_max = <36>; }; };';
const privateSource='/ { common { status = "disabled"; }; };';
const shared = '/ { common: common { status = "okay"; }; charger { iin_max = <42>; }; secondary { compatible = "acme,power"; iin_max = <25>; }; };';
type Preview = { item: MemberAdditionPreview };
type Applied = { item: { fileId: string; fileVersionId: string; configRevisionId: string } };

describe("shared dependency snapshot restoration through the real API role", () => {
  let lane: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>, api: ReturnType<typeof createPostgresDatabase>;
  let storage: ReturnType<typeof createLocalObjectStore>, directory: string;
  const sets: Record<string, string> = {}, token = `shared_ref_${process.pid}`;
  
  function server(auth = admin, sourceStore: ObjectStore = storage) {
    const router = createRouter();
    registerSharedDtsiRoutes(router, { db: api, getCurrentAuthContext: () => auth });
    registerCatalogProjectValueConsumerRoutes(router, { db: api, objectStore: sourceStore, getCurrentAuthContext: () => auth });
    registerParameterTopologyRoutes(router, { db: api, objectStore: sourceStore, getCurrentAuthContext: () => auth, refusalAuditSink: createTrustedRefusalAuditSink(db) });
    registerParameterFileRoutes(router, { db: api, objectStore: sourceStore, getCurrentAuthContext: () => auth,
      refusalAuditSink: createTrustedRefusalAuditSink(db) });
    return createHttpServer(router);
  }
  const post = <T,>(path: string, body: unknown, auth = admin, sourceStore: ObjectStore = storage) => requestJson<T>(server(auth, sourceStore), path, { method: "POST", body: JSON.stringify(body) });
  const path = (project: string) => `/api/v1/projects/${project}/config-sets/${sets[project]}/member-addition`;
  beforeAll(async () => {
    lane = await createEphemeralTestDatabase("shared-restore"); db = createPostgresDatabase(lane.url);
    directory = await mkdtemp(join(tmpdir(), "wiseeff-shared-ref-")); storage = createLocalObjectStore(directory);
    await db.query("insert into organizations(id,name) values ($1,'Shared reference')", [ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Reference admin','Admin',true)", [ADMIN, ORG]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('shared-ref-role',$1,$2,'admin')", [ADMIN, ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ('shared-ref-editor',$1,'Project editor','Engineer',true)", [ORG]);
    await installDriverSourceFixture(db, admin, { subjectId: "csub_acme_power", compatible: "acme,power", businessName: "Shared reference",
      driverName: "Shared charger", idempotencyKey: "shared-ref-register", reason: "Synthetic shared reference acceptance" });
    for (const projectId of [A, B]) {
      await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,$1,$1,'initialized')", [projectId, ORG]);
      const configSetId = sets[projectId] = (await createConfigSet(db, admin, { projectId, name: "Shared reference" })).id;
      const uploaded = await uploadProjectParameterFile(db, storage, admin, { projectId, fileName: "board.dts", bytes: Buffer.from(source) });
      await addConfigSetFile(db, admin, { configSetId, fileId: uploaded.file.id, role: "base", sortOrder: 0 });
      const privateFile=await uploadProjectParameterFile(db,storage,admin,{projectId,fileName:"private.dtsi",bytes:Buffer.from(privateSource)});
      await addConfigSetFile(db,admin,{configSetId,fileId:privateFile.file.id,role:"misc",sortOrder:1});
      const json = await uploadProjectParameterFile(db, storage, admin, { projectId, fileName: "private.json", bytes: Buffer.from('{"local":true}') });
      await addConfigSetFile(db, admin, { configSetId, fileId: json.file.id, role: "thermal", sortOrder: 2 });
      const revision = await ingestConfigRevision(db, { organizationId: ORG, projectId, configSetId, entryFile: "board.dts", includeSearchPaths: ["."], overlayOrder: [],
        members: [{ fileId: uploaded.file.id, fileVersionId: uploaded.version.id, fileName: "board.dts", role: "base", sortOrder: 0, content: source },
          {fileId:privateFile.file.id,fileVersionId:privateFile.version.id,fileName:"private.dtsi",role:"include",sortOrder:1,content:privateSource},
          { fileId: json.file.id, fileVersionId: json.version.id, fileName: "private.json", role: "thermal", sortOrder: 2, format: "json", content: '{"local":true}' }] }, admin);
      const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
      if (!snapshot) throw new Error("Missing Catalog fixture");
      await db.transaction(tx => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), snapshot, { organizationId: ORG, projectId, configSetId, configRevisionId: revision.id }));
    }
    api = createPostgresDatabase((await provisionPublicationRuntimeLogins(lane.url, { mode: "lab", runToken: token })).apiUrl);
    expect((await api.query<{ rolsuper: boolean; rolinherit: boolean }>("select rolsuper,rolinherit from pg_roles where rolname=current_user")).rows[0])
      .toEqual({ rolsuper: false, rolinherit: false });
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('shared-ref-editor-role','shared-ref-editor',$1,$2,'hardware-user')", [ORG, A]);
  }, 120_000);
  afterAll(async () => { await api?.close(); if (lane) await dropLabRuntimeLogins(lane.url, token); await db?.close(); await lane?.drop(); if (directory) await rm(directory, { recursive: true, force: true }); }, 120_000);

  it("restores historical shared bytes, origins and local snapshot values into a new revision while retaining added JSON members", async () => {
    const draft = await post<{item:{resourceId:string;revision:number}}>("/api/v2/shared-dtsi", {name:"Saved defaults",sourceName:"limits.dtsi",content:shared,changeDescription:"Snapshot defaults"});
    expect(draft.status,draft.bodyText).toBe(201);
    const resourceId=draft.body.item.resourceId;
    const publish=async(revision:number)=>{
      const preview=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${resourceId}/publication-preview`,{expectedRevision:revision});
      expect(preview.status,preview.bodyText).toBe(201);
      const version=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${resourceId}/publications`,{previewId:preview.body.item.id,idempotencyKey:preview.body.item.id});
      expect(version.status,version.bodyText).toBe(201);return version.body.item.id;
    };
    const first=await publish(1);
    const applyReference=async(versionId:string,replaceVersionId?:string)=>{
      const input={sharedReference:{resourceId,versionId,...(replaceVersionId?{replaceVersionId}:{})},role:"misc",sortOrder:1};
      const preview=await post<Preview>(`${path(A)}/preview`,input);expect(preview.status,preview.bodyText).toBe(200);
      const applied=await post<Applied>(`${path(A)}/apply`,{...input,proofToken:preview.body.item.proofToken,reason:"Snapshot reference",clientMutationId:versionId});
      expect(applied.status,applied.bodyText).toBe(200);return applied.body.item;
    };
    const initial=await applyReference(first);
    const gate=await evaluateReleaseReadiness(api,admin,{configSetId:sets[A]!},{objectStore:storage});
    expect(gate.canCreateBaseline,JSON.stringify(gate)).toBe(true);
    const baseline=await createBaseline(api,admin,{configSetId:sets[A]!,name:"Complete shared snapshot",gateToken:gate.gateToken,
      acknowledgedWarningIds:gate.warnings.filter(row=>row.acknowledgementRequired).map(row=>row.id)},{},{objectStore:storage});
    const savedBindings=await listCatalogBindingRowsForProject(api,admin,{projectId:A});
    const savedExport=await requestJson<{files:unknown[];manifest:unknown}>(server(),`/api/v1/projects/${A}/config-sets/${sets[A]}/export`);
    const clone=await post<{item:{revision:number}}>(`/api/v2/shared-dtsi/${resourceId}/draft`,{baseVersionId:first});
    const updated=await requestJson<{item:{revision:number}}>(server(),`/api/v2/shared-dtsi/${resourceId}/draft`,{method:"PUT",body:JSON.stringify({
      expectedRevision:clone.body.item.revision,name:"Changed defaults",sourceName:"limits.dtsi",content:shared.replace("<25>","<27>"),changeDescription:"Later defaults"})});
    expect(updated.status,updated.bodyText).toBe(200);
    const second=await publish(updated.body.item.revision), switched=await applyReference(second,first);
    expect((await listCatalogBindingRowsForProject(api,admin,{projectId:A})).map(row=>row.rawValue)).toContain("<27>");
    const inherited=(await listCatalogBindingRowsForProject(api,admin,{projectId:A})).find(row=>row.rawValue==="<27>")!;
    const override={expectedConfigRevisionId:switched.configRevisionId,logicalNodeId:inherited.logicalNodeId,propertyName:"iin_max",action:"set",rawText:"<31>"};
    const prepared=await post<{item:{fileId:string;fileName:string;baseVersionId:string;after:string}}>(`/api/v1/projects/${A}/config-sets/${sets[A]}/local-override/prepare`,override);
    expect(prepared.status,prepared.bodyText).toBe(200);
    const candidate=await post<{item:{id:string}}>(`/api/v1/projects/${A}/parameter-file-candidates`,{fileId:prepared.body.item.fileId,fileName:prepared.body.item.fileName,intent:"source_revision",localOverride:override,
      contentBase64:Buffer.from(prepared.body.item.after).toString("base64"),expectedCurrentVersionId:prepared.body.item.baseVersionId,expectedConfigRevisionId:switched.configRevisionId,clientMutationId:"later-project-difference"});
    expect(candidate.status,candidate.bodyText).toBe(201);
    const overridePreview=await requestJson<{item:SourceRevisionPreview}>(server(),`/api/v1/projects/${A}/parameter-file-candidates/${candidate.body.item.id}/source-preview`);
    expect(overridePreview.status,overridePreview.bodyText).toBe(200);
    expect((await post(`/api/v1/projects/${A}/parameter-file-candidates/${candidate.body.item.id}/source-apply`,{expectedCurrentVersionId:prepared.body.item.baseVersionId,expectedProofToken:overridePreview.body.item.proofToken,reason:"Later project value",clientMutationId:"later-project-difference-apply"})).status).toBe(200);
    const extra=await post<{item:{id:string}}>(`/api/v1/projects/${A}/parameter-file-candidates`,{fileName:"added-after-snapshot.json",contentBase64:Buffer.from('{"retain":true}').toString("base64")});
    expect(extra.status,extra.bodyText).toBe(201);
    const addition={candidateId:extra.body.item.id,role:"thermal",sortOrder:10};
    const additionPreview=await post<Preview>(`${path(A)}/preview`,addition);expect(additionPreview.status,additionPreview.bodyText).toBe(200);
    const added=await post(`${path(A)}/apply`,{...addition,proofToken:additionPreview.body.item.proofToken,reason:"Retained later JSON",clientMutationId:"later-json"});expect(added.status,added.bodyText).toBe(200);
    const previewPath=`/api/v1/projects/${A}/baselines/${baseline.id}/restore-preview`;
    const preview=await requestJson<{item:RestorePreviewResult}>(server(),previewPath);
    expect(preview.status,preview.bodyText).toBe(200);
    expect(preview.body.item.canonical).toMatchObject({canRestore:true,sourceConfigRevisionId:initial.configRevisionId});
    expect(preview.body.item.canonical!.members).toContainEqual(expect.objectContaining({fileName:"added-after-snapshot.json",action:"retain-added"}));
    expect(preview.body.item.canonical!.impact.sourceReplacements).toBe(1);
    const input={proofToken:preview.body.item.canonical!.proofToken,sourceConfigRevisionId:initial.configRevisionId,
      reason:"Restore the complete saved project",confirmCompositionChanges:true,clientMutationId:"restore-shared-snapshot"};
    const rollback=`/api/v1/projects/${A}/baselines/${baseline.id}/rollback`;
    const unchanged=await captureConfigurationSourceState(db,{organizationId:ORG,projectId:A});
    expect((await post(rollback,input,editor)).status).toBe(403);
    await db.query("delete from user_role_bindings where id='shared-ref-role'");
    try { expect((await post(rollback,input)).status).toBe(403); }
    finally { await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('shared-ref-role',$1,$2,'admin')",[ADMIN,ORG]); }
    const brokenStore={...storage,getBounded:async()=>{throw new Error("Missing snapshot object");}};
    expect((await post(rollback,input,admin,brokenStore)).status).toBe(409);
    expect(await captureConfigurationSourceState(db,{organizationId:ORG,projectId:A})).toEqual(unchanged);
    await db.query(`create function fail_snapshot_restore_audit() returns trigger language plpgsql as $$begin
      if new.metadata->>'requestKind'='configuration_restore' then raise exception 'Injected restore transaction failure'; end if; return new; end $$`);
    await db.query("create trigger fail_snapshot_restore_audit before insert on public.audit_events for each row execute function fail_snapshot_restore_audit()");
    try { expect((await post(rollback,input)).status).toBe(500); }
    finally { await db.query("drop trigger fail_snapshot_restore_audit on public.audit_events");await db.query("drop function fail_snapshot_restore_audit()"); }
    expect(await captureConfigurationSourceState(db,{organizationId:ORG,projectId:A})).toEqual(unchanged);
    const attempts=await Promise.all([post<{item:{configRevisionId:string}}>(rollback,input),post<{item:{configRevisionId:string}}>(rollback,{...input,clientMutationId:"restore-concurrent"})]);
    expect(attempts.map(row=>row.status).sort()).toEqual([200,409]);
    const restored=attempts.find(row=>row.status===200)!;
    const winner=attempts[0]!.status===200?input:{...input,clientMutationId:"restore-concurrent"};
    expect((await post(rollback,winner)).body).toEqual(restored.body);
    expect(restored.status,restored.bodyText).toBe(200);
    expect(restored.body.item.configRevisionId).not.toBe(initial.configRevisionId);
    expect(restored.body.item.configRevisionId).not.toBe(switched.configRevisionId);
    const bindings=await listCatalogBindingRowsForProject(api,admin,{projectId:A});
    expect(bindings.map(row=>({id:row.id,rawValue:row.rawValue}))).toEqual(savedBindings.map(row=>({id:row.id,rawValue:row.rawValue})));
    const exported=await requestJson<{files:unknown[]}>(server(),`/api/v1/projects/${A}/config-sets/${sets[A]}/export`);
    expect(exported.status,exported.bodyText).toBe(200);expect(exported.body.files).toEqual(expect.arrayContaining(savedExport.body.files));
    expect(exported.body.files).toContainEqual(expect.objectContaining({name:"added-after-snapshot.json",content:'{"retain":true}'}));
    const files=await requestJson<{items:Array<{fileId:string;sharedReference?:{versionId:string;resourceId:string;readOnly:boolean}}> }>(server(),`/api/v1/projects/${A}/config-sets/${sets[A]}/files`);
    const restoredShared=files.body.items.find(row=>row.sharedReference?.resourceId===resourceId)!;
    expect(restoredShared.sharedReference).toMatchObject({versionId:first,readOnly:true});
    expect((await post(`/api/v1/projects/${A}/parameter-files/${restoredShared.fileId}/versions`,{contentBase64:Buffer.from(shared.replace("<25>","<99>")).toString("base64")})).status).toBe(409);
    const before=await captureConfigurationSourceState(db,{organizationId:ORG,projectId:A});
    const stale=await post(`/api/v1/projects/${A}/baselines/${baseline.id}/rollback`,{...input,clientMutationId:"stale-restore"});
    expect(stale.status,stale.bodyText).toBe(409);
    expect(await captureConfigurationSourceState(db,{organizationId:ORG,projectId:A})).toEqual(before);
  },120_000);
  it("restores exact historical CPP originals and build inputs after a shared header upgrade",async()=>{
    const members=[{sourceName:"macro.dtsi",content:'#include <limit.h>\n#if FLAG\n/ { macro { compatible = "acme,power"; iin_max = <LIMIT>; }; };\n#endif\n'},
      {sourceName:"inc/limit.h",content:"#define LIMIT 28\n"}];
    const created=await post<{item:{resourceId:string}}>("/api/v2/shared-dtsi",{name:"Snapshot CPP",members,buildInputs:{includeSearchPaths:["inc"],defines:{FLAG:"1"}},changeDescription:"Frozen CPP source"});
    expect(created.status,created.bodyText).toBe(201);const resourceId=created.body.item.resourceId;
    const publish=async(revision:number)=>{
      const preview=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${resourceId}/publication-preview`,{expectedRevision:revision});expect(preview.status,preview.bodyText).toBe(201);
      const published=await post<{item:{id:string;members:Array<{id:string;sourceName:string;content:string}>}}>(`/api/v2/shared-dtsi/${resourceId}/publications`,{previewId:preview.body.item.id,idempotencyKey:preview.body.item.id});expect(published.status,published.bodyText).toBe(201);return published.body.item;
    };
    const first=await publish(1);
    const pin=async(versionId:string,replaceVersionId?:string)=>{
      const input={sharedReference:{resourceId,versionId,mountPath:"vendor/macro",...(replaceVersionId?{replaceVersionId}:{})},role:"misc",sortOrder:1};
      const preview=await post<Preview>(`${path(B)}/preview`,input);expect(preview.status,preview.bodyText).toBe(200);
      const applied=await post<Applied>(`${path(B)}/apply`,{...input,proofToken:preview.body.item.proofToken,reason:"Frozen CPP inputs",clientMutationId:versionId});expect(applied.status,applied.bodyText).toBe(200);return applied.body.item;
    };
    const initial=await pin(first.id);
    const gate=await evaluateReleaseReadiness(api,admin,{configSetId:sets[B]!},{objectStore:storage});expect(gate.canCreateBaseline,JSON.stringify(gate)).toBe(true);
    const baseline=await createBaseline(api,admin,{configSetId:sets[B]!,name:"CPP snapshot",gateToken:gate.gateToken,acknowledgedWarningIds:gate.warnings.filter(row=>row.acknowledgementRequired).map(row=>row.id)},{},{objectStore:storage});
    const clone=await post<{item:{revision:number}}>(`/api/v2/shared-dtsi/${resourceId}/draft`,{baseVersionId:first.id});expect(clone.status,clone.bodyText).toBe(201);
    const changed=await requestJson<{item:{revision:number}}>(server(),`/api/v2/shared-dtsi/${resourceId}/draft`,{method:"PUT",body:JSON.stringify({expectedRevision:clone.body.item.revision,name:"Changed header",members:first.members.map(({id,sourceName,content})=>({id,sourceName,content:sourceName==="inc/limit.h"?"#define LIMIT 30\n":content})),buildInputs:{includeSearchPaths:["inc"],defines:{FLAG:"1"}},changeDescription:"Later CPP header"})});
    expect(changed.status,changed.bodyText).toBe(200);const second=await publish(changed.body.item.revision);await pin(second.id,first.id);
    expect((await listCatalogBindingRowsForProject(api,admin,{projectId:B})).map(row=>row.rawValue)).toContain("<30>");
    const preview=await requestJson<{item:RestorePreviewResult}>(server(),`/api/v1/projects/${B}/baselines/${baseline.id}/restore-preview`);expect(preview.status,preview.bodyText).toBe(200);
    const restored=await post(`/api/v1/projects/${B}/baselines/${baseline.id}/rollback`,{proofToken:preview.body.item.canonical!.proofToken,sourceConfigRevisionId:initial.configRevisionId,reason:"Restore exact CPP snapshot",confirmCompositionChanges:true,clientMutationId:"cpp-restore"});expect(restored.status,restored.bodyText).toBe(200);
    expect((await listCatalogBindingRowsForProject(api,admin,{projectId:B})).map(row=>row.rawValue)).toContain("<28>");
    const exported=await requestJson<{manifest:{declaredBuildInputs:unknown;preprocessing:unknown};files:{name:string;content:string}[]}>(server(),`/api/v1/projects/${B}/config-sets/${sets[B]}/export`);expect(exported.status,exported.bodyText).toBe(200);
    expect(exported.body.manifest.declaredBuildInputs).toEqual({includeSearchPaths:["."],defines:{}});expect(exported.body.manifest.preprocessing).toMatchObject({defines:{FLAG:"1"}});
    for(const member of members)expect(exported.body.files).toContainEqual(expect.objectContaining({name:`vendor/macro/${member.sourceName}`,content:member.content}));
  },120_000);
});

