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
import { registerParameterTopologyRoutes } from "../parameter-topology/routes";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import { registerSharedDtsiRoutes } from "../shared-dtsi/routes";
import { addConfigSetFile, createConfigSet } from "./configSetService";
import { registerParameterFileRoutes } from "./routes";
import { uploadProjectParameterFile } from "./service";
import type { SourceRevisionPreview } from "./sourceRevisionService";
import type { MemberAdditionPreview } from "./canonicalMemberAddition";
import type { SharedDtsiVersion } from "../contracts/dtoSchemas/sharedDtsi";

const ORG = "org-shared-ref", ADMIN = "user-shared-ref", A = "shared-project-a", B = "shared-project-b";
const admin = makeTestAuthContext({ organizationId: ORG, userId: ADMIN, roles: [{ roleId: "admin", projectId: null }] });
const editor = makeTestAuthContext({ organizationId: ORG, userId: "shared-ref-editor", roles: [{ roleId: "hardware-user", projectId: A }] });
const source = '/dts-v1/;\n/include/ "private.dtsi"\n/ { compatible = "test,board"; model = "shared reference"; charger: charger { compatible = "acme,power"; iin_max = <36>; }; };';
const privateSource='/ { common { status = "disabled"; }; };';
const shared = '/ { common: common { status = "okay"; }; charger { iin_max = <42>; }; secondary { compatible = "acme,power"; iin_max = <25>; }; };';
type Preview = { item: MemberAdditionPreview };
type Applied = { item: { fileId: string; fileVersionId: string; configRevisionId: string } };

describe("shared reference version switches through the real API role", () => {
  let lane: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>, api: ReturnType<typeof createPostgresDatabase>;
  let storage: ReturnType<typeof createLocalObjectStore>, directory: string;
  const sets: Record<string, string> = {}, token = `shared_ref_${process.pid}`;
  let resourceId: string, versionId: string, nativeHeadVersionId:string, appliedA: Applied["item"];
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
    lane = await createEphemeralTestDatabase("shared-ref"); db = createPostgresDatabase(lane.url);
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

  it("upgrades only A and switching to an older dependency creates a new revision retaining local overrides and Binding history", async () => {
    const draft = await post<{item:{resourceId:string;revision:number}}>("/api/v2/shared-dtsi", {name:"Switch limits",sourceName:"limits.dtsi",content:shared,changeDescription:"First defaults"});
    expect(draft.status,draft.bodyText).toBe(201); resourceId=draft.body.item.resourceId;
    const publish=async(revision:number,key:string)=>{
      const p=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${resourceId}/publication-preview`,{expectedRevision:revision});
      expect(p.status,p.bodyText).toBe(201);
      const v=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${resourceId}/publications`,{previewId:p.body.item.id,idempotencyKey:key});
      expect(v.status,v.bodyText).toBe(201);return v.body.item.id;
    };
    versionId=await publish(1,"switch-v1");
    const initial={sharedReference:{resourceId,versionId},role:"misc",sortOrder:1};
    for(const project of [A,B]) {
      const preview=await post<Preview>(`${path(project)}/preview`,initial);
      expect(preview.status,preview.bodyText).toBe(200);
      const applied=await post<Applied>(`${path(project)}/apply`,{...initial,proofToken:preview.body.item.proofToken,reason:"Pin v1",clientMutationId:`initial-${project}`});
      expect(applied.status,applied.bodyText).toBe(200);
      if(project===A)appliedA=applied.body.item;
    }
    const files=(await requestJson<{items:{fileId:string;fileName:string;currentVersionId:string;role:string}[]}>(server(),`/api/v1/projects/${A}/config-sets/${sets[A]}/files`)).body.items;
    const root=files.find(file=>file.role==="base")!;
    const rootContent=await requestJson(server(),`/api/v1/projects/${A}/parameter-files/${root.fileId}/versions/${root.currentVersionId}/content`);
    const reordered=rootContent.bodyText.replace('/include/ "limits.dtsi"',"").replace('/include/ "private.dtsi"','/include/ "private.dtsi"\n/include/ "limits.dtsi"');
    const sourceCandidate=await post<{item:{id:string}}>(`/api/v1/projects/${A}/parameter-file-candidates`,{fileId:root.fileId,fileName:root.fileName,intent:"source_revision",contentBase64:Buffer.from(reordered).toString("base64"),expectedCurrentVersionId:root.currentVersionId,expectedConfigRevisionId:appliedA.configRevisionId,clientMutationId:"explicit-include-order"});expect(sourceCandidate.status,sourceCandidate.bodyText).toBe(201);
    const sourcePreview=await requestJson<{item:SourceRevisionPreview}>(server(),`/api/v1/projects/${A}/parameter-file-candidates/${sourceCandidate.body.item.id}/source-preview`);expect(sourcePreview.status,sourcePreview.bodyText).toBe(200);
    const reorderedResult=await post<Applied>(`/api/v1/projects/${A}/parameter-file-candidates/${sourceCandidate.body.item.id}/source-apply`,{expectedCurrentVersionId:root.currentVersionId,expectedProofToken:sourcePreview.body.item.proofToken,reason:"Keep this explicit project include precedence",clientMutationId:"explicit-include-order-apply"});expect(reorderedResult.status,reorderedResult.bodyText).toBe(200);
    appliedA.configRevisionId=reorderedResult.body.item.configRevisionId;
    const before=await listCatalogBindingRowsForProject(api,admin,{projectId:A});
    const originalB=await requestJson<{manifest:Record<string,unknown>;files:unknown[]}>(server(),`/api/v1/projects/${B}/config-sets/${sets[B]}/export`);
    const clone=await post<{item:{revision:number}}>(`/api/v2/shared-dtsi/${resourceId}/draft`,{baseVersionId:versionId});
    const saved=await requestJson<{item:{revision:number}}>(server(),`/api/v2/shared-dtsi/${resourceId}/draft`,{method:"PUT",body:JSON.stringify({expectedRevision:clone.body.item.revision,name:"Switch limits",sourceName:"limits.dtsi",content:shared.replace("<42>","<44>").replace("<25>","<27>").replace('status = "okay"','status = "disabled"'),changeDescription:"Changed defaults and node status"})});
    const next=await publish(saved.body.item.revision,"switch-v2");
    nativeHeadVersionId=next;
    const switchTo=async(targetVersionId:string,key:string)=>{
      const body={sharedReference:{resourceId,versionId:targetVersionId,replaceVersionId:key==="upgrade"?versionId:next},role:"misc",sortOrder:1};
      const preview=await post<Preview>(`${path(A)}/preview`,body);
      expect(preview.status,preview.bodyText).toBe(200);
      expect(preview.body.item.rootEdit?.after).toBe(preview.body.item.rootEdit?.before);
      expect(preview.body.item.sharedSwitch?.build).toMatchObject({mode:"release",passed:true});
      expect(preview.body.item.sharedSwitch?.effective).toContainEqual(expect.objectContaining({node:"/charger",property:"iin_max",before:"<36>",after:"<36>",oldShared:key==="upgrade"?"<42>":"<44>",targetShared:key==="upgrade"?"<44>":"<42>",localOverride:true}));
      expect((await post(`${path(A)}/preview`,body,editor)).status).toBe(403);
      const confirm={...body,proofToken:preview.body.item.proofToken,reason:"Keep private charger decision",clientMutationId:key};
      if(key==="upgrade") {
        const filesBefore=(await requestJson(server(),`/api/v1/projects/${A}/config-sets/${sets[A]}/files`)).body;
        const originalObjects=await readdir(directory,{recursive:true});
        let puts=0;
        const failingStore:ObjectStore={...storage,put:async input=>{if(++puts===2)throw new Error("Injected switch storage failure");return storage.put(input);}};
        expect((await post(`${path(A)}/apply`,confirm,admin,failingStore)).status).toBe(500);
        expect((await requestJson(server(),`/api/v1/projects/${A}/config-sets/${sets[A]}/files`)).body).toEqual(filesBefore);
        expect(await readdir(directory,{recursive:true})).toEqual(originalObjects);
        await db.query(`create function fail_shared_switch_audit() returns trigger language plpgsql as $$begin
          if new.metadata->>'operation'='switch_shared_version' then raise exception 'Injected switch audit failure'; end if; return new; end $$`);
        await db.query("create trigger fail_shared_switch_audit before insert on public.audit_events for each row execute function fail_shared_switch_audit()");
        try {expect((await post(`${path(A)}/apply`,confirm)).status).toBe(500);}
        finally {await db.query("drop trigger fail_shared_switch_audit on public.audit_events");await db.query("drop function fail_shared_switch_audit()");}
        expect((await requestJson(server(),`/api/v1/projects/${A}/config-sets/${sets[A]}/files`)).body).toEqual(filesBefore);
        expect(await readdir(directory,{recursive:true})).toEqual(originalObjects);
        expect((await listCatalogBindingRowsForProject(api,admin,{projectId:A})).map(row=>({id:row.id,rawValue:row.rawValue}))).toEqual(before.map(row=>({id:row.id,rawValue:row.rawValue})));
        await db.query("delete from user_role_bindings where id='shared-ref-role'");
        expect((await post(`${path(A)}/apply`,confirm)).status).toBe(403);
        await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('shared-ref-role',$1,$2,'admin')",[ADMIN,ORG]);
      }
      const attempts=await Promise.all([post<Applied>(`${path(A)}/apply`,confirm),post<Applied>(`${path(A)}/apply`,{...confirm,clientMutationId:key+"-concurrent"})]);
      expect(attempts.map(item=>item.status).sort()).toEqual([200,409]);
      const applied=attempts.find(item=>item.status===200)!;
      expect(applied.status,applied.bodyText).toBe(200);
      const winner=attempts[0]!.status===200?confirm:{...confirm,clientMutationId:key+"-concurrent"};
      expect((await post(`${path(A)}/apply`,winner)).body).toEqual(applied.body);
      expect((await post(`${path(A)}/apply`,{...confirm,clientMutationId:key+"-stale"})).status).toBe(409);
      return applied.body.item;
    };
    const upgraded=await switchTo(next,"upgrade");
    expect(upgraded.configRevisionId).not.toBe(appliedA.configRevisionId);
    const after=await listCatalogBindingRowsForProject(api,admin,{projectId:A});
    expect(after.map(row=>row.rawValue).sort()).toEqual(["<27>","<36>"]);
    expect(after.map(row=>row.id).sort()).toEqual(before.map(row=>row.id).sort());
    const inherited=after.find(row=>row.rawValue==="<27>")!;
    const override=async(revision:string,action:"set"|"remove-override")=>{
      const input={expectedConfigRevisionId:revision,logicalNodeId:inherited.logicalNodeId,propertyName:"iin_max",action,...(action==="set"?{rawText:"<31>"}:{})};
      const prepared=await post<{item:{fileId:string;fileName:string;baseVersionId:string;after:string}}>(`/api/v1/projects/${A}/config-sets/${sets[A]}/local-override/prepare`,input);expect(prepared.status,prepared.bodyText).toBe(200);
      const candidate=await post<{item:{id:string}}>(`/api/v1/projects/${A}/parameter-file-candidates`,{fileId:prepared.body.item.fileId,fileName:prepared.body.item.fileName,intent:"source_revision",localOverride:input,
        contentBase64:Buffer.from(prepared.body.item.after).toString("base64"),expectedCurrentVersionId:prepared.body.item.baseVersionId,expectedConfigRevisionId:revision,clientMutationId:`switch-override-${action}`});expect(candidate.status,candidate.bodyText).toBe(201);
      const preview=await requestJson<{item:SourceRevisionPreview}>(server(),`/api/v1/projects/${A}/parameter-file-candidates/${candidate.body.item.id}/source-preview`);expect(preview.status,preview.bodyText).toBe(200);
      const applied=await post<Applied>(`/api/v1/projects/${A}/parameter-file-candidates/${candidate.body.item.id}/source-apply`,{expectedCurrentVersionId:prepared.body.item.baseVersionId,expectedProofToken:preview.body.item.proofToken,reason:"Combined shared version and project override",clientMutationId:`switch-override-apply-${action}`});expect(applied.status,applied.bodyText).toBe(200);return applied.body.item;
    };
    await override(upgraded.configRevisionId,"set");
    const unchangedB=(await requestJson<{manifest:Record<string,unknown>;files:unknown[]}>(server(),`/api/v1/projects/${B}/config-sets/${sets[B]}/export`)).body;
    expect(unchangedB.files).toEqual(originalB.body.files);
    expect({...unchangedB.manifest,exportedAt:null}).toEqual({...originalB.body.manifest,exportedAt:null});
    const older=await switchTo(versionId,"older");
    expect(older.configRevisionId).not.toBe(appliedA.configRevisionId);
    expect(older.configRevisionId).not.toBe(upgraded.configRevisionId);
    expect((await listCatalogBindingRowsForProject(api,admin,{projectId:A})).map(row=>row.rawValue).sort()).toEqual(["<31>","<36>"]);
    await override(older.configRevisionId,"remove-override");
    const final=await listCatalogBindingRowsForProject(api,admin,{projectId:A});
    expect(final.map(row=>row.rawValue).sort()).toEqual(["<25>","<36>"]);
    expect(final.map(row=>row.id).sort()).toEqual(before.map(row=>row.id).sort());
  },120_000);

  it("switches the complete CPP source closure using exact originals and frozen declared inputs while retaining historical sources",async()=>{
    const content='#include <limit.h>\n#if FLAG\n/ { macro { compatible = "acme,power"; iin_max = <LIMIT>; }; };\n#endif\n/include/ "extra.dtsi"\n';
    const members=[{sourceName:"macro.dtsi",content},{sourceName:"inc/limit.h",content:"#define LIMIT 28\n"},{sourceName:"extra.dtsi",content:'/ { extra { status = "okay"; }; };\n'}];
    const created=await post<{item:{resourceId:string}}>("/api/v2/shared-dtsi",{name:"Pinned CPP switch",members,buildInputs:{includeSearchPaths:["inc"],defines:{FLAG:"1"}},changeDescription:"Original CPP closure"});
    expect(created.status,created.bodyText).toBe(201);const resource=created.body.item.resourceId;
    const publish=async(revision:number)=>{
      const preview=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${resource}/publication-preview`,{expectedRevision:revision});expect(preview.status,preview.bodyText).toBe(201);
      const result=await post<{item:SharedDtsiVersion}>(`/api/v2/shared-dtsi/${resource}/publications`,{previewId:preview.body.item.id,idempotencyKey:`cpp-switch-${revision}`});expect(result.status,result.bodyText).toBe(201);return result.body.item;
    };
    const first=await publish(1);
    const initial={sharedReference:{resourceId:resource,versionId:first.id,mountPath:"vendor/macro"},role:"misc",sortOrder:1};
    const initialPreview=await post<Preview>(`${path(A)}/preview`,initial);expect(initialPreview.status,initialPreview.bodyText).toBe(200);
    const initialApply=await post<Applied>(`${path(A)}/apply`,{...initial,proofToken:initialPreview.body.item.proofToken,reason:"CPP fixed originals",clientMutationId:"cpp-initial"});expect(initialApply.status,initialApply.bodyText).toBe(200);
    const initialFiles=await requestJson<{items:{fileId:string;fileName:string;currentVersionId:string}[]}>(server(),`/api/v1/projects/${A}/config-sets/${sets[A]}/files`);
    const extra=initialFiles.body.items.find(file=>file.fileName==="vendor/macro/extra.dtsi")!;
    const clone=await post<{item:{revision:number}}>(`/api/v2/shared-dtsi/${resource}/draft`,{baseVersionId:first.id});
    const changed=first.members.filter(member=>member.sourceName!=="extra.dtsi").map(member=>({id:member.id,sourceName:member.sourceName,content:member.sourceName==="inc/limit.h"?"#define LIMIT 30\n":member.content.replace('/include/ "extra.dtsi"\n',"")}));
    const saved=await requestJson<{item:{revision:number}}>(server(),`/api/v2/shared-dtsi/${resource}/draft`,{method:"PUT",body:JSON.stringify({expectedRevision:clone.body.item.revision,name:"Pinned CPP switch",members:changed,buildInputs:{includeSearchPaths:["inc"],defines:{FLAG:"1"}},changeDescription:"Header changed and unused source removed"})});expect(saved.status,saved.bodyText).toBe(200);
    const next=await publish(saved.body.item.revision);
    for(const [index,target] of [next,first].entries()) {
      const body={sharedReference:{resourceId:resource,versionId:target.id,replaceVersionId:index===0?first.id:next.id},role:"misc",sortOrder:1};
      const preview=await post<Preview>(`${path(A)}/preview`,body);expect(preview.status,preview.bodyText).toBe(200);
      expect(preview.body.item.sharedSwitch?.build.defines).toEqual({FLAG:"1"});
      expect(preview.body.item.sharedSwitch?.effective).toContainEqual(expect.objectContaining({node:"/macro",property:"iin_max",before:index===0?"<28>":"<30>",after:index===0?"<30>":"<28>"}));
      const applied=await post<Applied>(`${path(A)}/apply`,{...body,proofToken:preview.body.item.proofToken,reason:"Use exact CPP closure",clientMutationId:`cpp-switch-${index}`});expect(applied.status,applied.bodyText).toBe(200);
      const oldContent=await requestJson(server(),`/api/v1/projects/${A}/parameter-files/${extra.fileId}/versions/${extra.currentVersionId}/content`);expect(oldContent.status,oldContent.bodyText).toBe(200);expect(oldContent.bodyText).toBe(members[2]!.content);
      const refused=await post(`/api/v1/projects/${A}/parameter-files/${extra.fileId}/versions`,{contentBase64:Buffer.from('/ { extra { status = "disabled"; }; };').toString("base64")});expect(refused.status,refused.bodyText).toBe(409);
      const exported=await requestJson<{manifest:{declaredBuildInputs:unknown;preprocessing:unknown};files:{name:string;content:string}[]}>(server(),`/api/v1/projects/${A}/config-sets/${sets[A]}/export`);expect(exported.status,exported.bodyText).toBe(200);
      expect(exported.body.manifest.declaredBuildInputs).toEqual({includeSearchPaths:["."],defines:{}});
      expect(exported.body.manifest.preprocessing).toMatchObject({defines:{FLAG:"1"}});
      for(const member of target.members)expect(exported.body.files).toContainEqual(expect.objectContaining({name:`vendor/macro/${member.sourceName}`,content:member.content}));
      const historical=await requestJson<{item:SharedDtsiVersion}>(server(),`/api/v2/shared-dtsi/${resource}/versions/${first.id}`);expect(historical.body.item.members).toEqual(first.members);
    }
  },120_000);

  it("blocks missing external references and incompatible values without changing the current composition",async()=>{
    const original=(await requestJson(server(),`/api/v1/projects/${A}/config-sets/${sets[A]}/files`)).body;
    for(const [index,content] of [shared+'\n&missing_target { status = "okay"; };\n',shared.replace("<25>",'"incompatible"')].entries()) {
      const clone=await post<{item:{revision:number}}>(`/api/v2/shared-dtsi/${resourceId}/draft`,{baseVersionId:nativeHeadVersionId});expect(clone.status,clone.bodyText).toBe(201);
      const saved=await requestJson<{item:{revision:number}}>(server(),`/api/v2/shared-dtsi/${resourceId}/draft`,{method:"PUT",body:JSON.stringify({expectedRevision:clone.body.item.revision,name:"Blocked switch",sourceName:"limits.dtsi",content,changeDescription:"Needs project conflict resolution"})});expect(saved.status,saved.bodyText).toBe(200);
      const preview=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${resourceId}/publication-preview`,{expectedRevision:saved.body.item.revision});expect(preview.status,preview.bodyText).toBe(201);
      const target=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${resourceId}/publications`,{previewId:preview.body.item.id,idempotencyKey:`blocked-${index}`});expect(target.status,target.bodyText).toBe(201);
      nativeHeadVersionId=target.body.item.id;
      const checked=await post(`${path(A)}/preview`,{sharedReference:{resourceId,versionId:target.body.item.id,replaceVersionId:versionId},role:"misc",sortOrder:1});
      expect(checked.status,checked.bodyText).toBe(400);
      expect((await requestJson(server(),`/api/v1/projects/${A}/config-sets/${sets[A]}/files`)).body).toEqual(original);
    }
  },120_000);
});
