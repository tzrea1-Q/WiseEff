import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import { getAuthContext } from "../auth/repository";
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
import type { TopologyTree } from "../../../src/domain/parameter-topology/types";

const ORG = "org-shared-ref", ADMIN = "user-shared-ref", A = "shared-project-a", B = "shared-project-b";
const admin = makeTestAuthContext({ organizationId: ORG, userId: ADMIN, roles: [{ roleId: "admin", projectId: null }] });
const editor = makeTestAuthContext({ organizationId: ORG, userId: "shared-ref-editor", roles: [{ roleId: "hardware-user", projectId: A }] });
const reviewer = makeTestAuthContext({organizationId:ORG,userId:"local-reviewer",roles:[{roleId:"admin",projectId:null},{roleId:"software-committer",projectId:A}]});
const source = '/dts-v1/; / { compatible = "test,board"; model = "shared reference"; charger: charger { compatible = "acme,power"; iin_max = <36>; }; };';
const shared = '/ { common: common { status = "okay"; }; charger { iin_max = <42>; }; secondary { compatible = "acme,power"; iin_max = <25>; }; };';
type Preview = { item: { proofToken: string; entryFile: string; members: unknown[] } };
type Applied = { item: { fileId: string; fileVersionId: string; configRevisionId: string } };

describe("project local overrides through the real API role", () => {
  let lane: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>, api: ReturnType<typeof createPostgresDatabase>;
  let storage: ReturnType<typeof createLocalObjectStore>, directory: string;
  const sets: Record<string, string> = {}, token = `shared_ref_${process.pid}`;
  const jsonFiles: Record<string, { fileId: string; versionId: string }> = {};
  function server(auth = admin, sourceStore: ObjectStore = storage) {
    const router = createRouter();
    registerSharedDtsiRoutes(router, { db: api, getCurrentAuthContext: () => getAuthContext(api,auth.user.id) });
    registerCatalogProjectValueConsumerRoutes(router, { db: api, objectStore: sourceStore, getCurrentAuthContext: () => getAuthContext(api,auth.user.id) });
    registerParameterTopologyRoutes(router, { db: api, objectStore: sourceStore, getCurrentAuthContext: () => getAuthContext(api,auth.user.id), refusalAuditSink: createTrustedRefusalAuditSink(db) });
    registerParameterFileRoutes(router, { db: api, objectStore: sourceStore, getCurrentAuthContext: () => getAuthContext(api,auth.user.id),
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
    await db.query("insert into users(id,organization_id,name,title,is_active) values ('local-reviewer',$1,'Local reviewer','Reviewer',true)",[ORG]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id,project_id) values ('local-reviewer-admin','local-reviewer',$1,'admin',null),('local-reviewer-software','local-reviewer',$1,'software-committer',$2)",[ORG,A]);
    await installDriverSourceFixture(db, admin, { subjectId: "csub_acme_power", compatible: "acme,power", businessName: "Shared reference",
      driverName: "Shared charger", idempotencyKey: "shared-ref-register", reason: "Synthetic shared reference acceptance" });
    for (const projectId of [A, B]) {
      await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,$1,$1,'initialized')", [projectId, ORG]);
      const configSetId = sets[projectId] = (await createConfigSet(db, admin, { projectId, name: "Shared reference" })).id;
      const uploaded = await uploadProjectParameterFile(db, storage, admin, { projectId, fileName: "board.dts", bytes: Buffer.from(source) });
      await addConfigSetFile(db, admin, { configSetId, fileId: uploaded.file.id, role: "base", sortOrder: 0 });
      const json = await uploadProjectParameterFile(db, storage, admin, { projectId, fileName: "private.json", bytes: Buffer.from('{"local":true}') });
      jsonFiles[projectId] = { fileId: json.file.id, versionId: json.version.id };
      await addConfigSetFile(db, admin, { configSetId, fileId: json.file.id, role: "thermal", sortOrder: 2 });
      const revision = await ingestConfigRevision(db, { organizationId: ORG, projectId, configSetId, entryFile: "board.dts", includeSearchPaths: ["."], overlayOrder: [],
        members: [{ fileId: uploaded.file.id, fileVersionId: uploaded.version.id, fileName: "board.dts", role: "base", sortOrder: 0, content: source },
          { fileId: json.file.id, fileVersionId: json.version.id, fileName: "private.json", role: "thermal", sortOrder: 2, format: "json", content: '{"local":true}' }] }, admin);
      const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
      if (!snapshot) throw new Error("Missing Catalog fixture");
      await db.transaction(tx => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), snapshot, { organizationId: ORG, projectId, configSetId, configRevisionId: revision.id }));
    }
    await db.query("insert into public.project_members(organization_id,project_id,user_id,roles) values ($1,$2,'shared-ref-editor',ARRAY['hardware-user']::text[]),($1,$2,'local-reviewer',ARRAY['software-committer']::text[])",[ORG,A]);
    api = createPostgresDatabase((await provisionPublicationRuntimeLogins(lane.url, { mode: "lab", runToken: token })).apiUrl);
    expect((await api.query<{ rolsuper: boolean; rolinherit: boolean }>("select rolsuper,rolinherit from pg_roles where rolname=current_user")).rows[0])
      .toEqual({ rolsuper: false, rolinherit: false });
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('shared-ref-editor-role','shared-ref-editor',$1,$2,'hardware-user')", [ORG, A]);
  }, 120_000);
  afterAll(async () => { await api?.close(); if (lane) await dropLabRuntimeLogins(lane.url, token); await db?.close(); await lane?.drop(); if (directory) await rm(directory, { recursive: true, force: true }); }, 120_000);

  it("preserves inherited Binding identity through local override and removal, isolating the other project", async () => {
    const draft = await post<{ item: { resourceId: string; revision: number } }>("/api/v2/shared-dtsi", { name: "Limits", sourceName: "limits.dtsi", content: shared, changeDescription: "Fixture" });
    const id = draft.body.item.resourceId;
    const publication = await post<{ item: { id: string } }>(`/api/v2/shared-dtsi/${id}/publication-preview`, { expectedRevision: draft.body.item.revision });
    const version = await post<{ item: { id: string } }>(`/api/v2/shared-dtsi/${id}/publications`, { previewId: publication.body.item.id, idempotencyKey: "local-v1" });
    for (const project of [A,B]) {
      const body = { sharedReference: { resourceId:id, versionId:version.body.item.id }, role:"misc",sortOrder:1 };
      const preview = await post<Preview>(`${path(project)}/preview`,body);
      expect(preview.status,preview.bodyText).toBe(200);
      const applied = await post<Applied>(`${path(project)}/apply`,{...body,proofToken:preview.body.item.proofToken,reason:"Reference",clientMutationId:project});
      expect(applied.status,applied.bodyText).toBe(200);
    }
    const beforeA = await listCatalogBindingRowsForProject(api,admin,{projectId:A});
    const beforeB = await listCatalogBindingRowsForProject(api,admin,{projectId:B});
    const inherited = beforeA.find(row=>row.rawValue==="<25>")!;
    const members = await requestJson<{items:Array<{fileId:string;currentVersionId:string;role:string}>}>(server(),`/api/v1/projects/${A}/config-sets/${sets[A]}/files`);
    const root = members.body.items.find(row=>row.role==="base")!;
    const original = await requestJson(server(),`/api/v1/projects/${A}/parameter-files/${root.fileId}/versions/${root.currentVersionId}/content`);
    async function edit(content:string,mutation:string) {
      const revisions = await api.query<{id:string}>("select id from dts_config_revisions where config_set_id=$1 order by revision_number desc limit 1",[sets[A]]);
      const files = await requestJson<{items:Array<{fileId:string;currentVersionId:string}>}>(server(),`/api/v1/projects/${A}/config-sets/${sets[A]}/files`);
      const baseVersion=files.body.items.find(row=>row.fileId===root.fileId)!.currentVersionId;
      const candidate=await post<{item:{id:string}}>(`/api/v1/projects/${A}/parameter-file-candidates`,{fileId:root.fileId,fileName:"board.dts",intent:"source_revision",contentBase64:Buffer.from(content).toString("base64"),expectedCurrentVersionId:baseVersion,expectedConfigRevisionId:revisions.rows[0]!.id,clientMutationId:mutation});
      expect(candidate.status,candidate.bodyText).toBe(201);
      const preview=await requestJson<{item:SourceRevisionPreview}>(server(),`/api/v1/projects/${A}/parameter-file-candidates/${candidate.body.item.id}/source-preview`);
      expect(preview.status,preview.bodyText).toBe(200);
      const body={expectedCurrentVersionId:baseVersion,expectedProofToken:preview.body.item.proofToken,reason:"Project override",clientMutationId:mutation+"-apply"};
      const result=await post(`/api/v1/projects/${A}/parameter-file-candidates/${candidate.body.item.id}/source-apply`,body);
      expect(result.status,result.bodyText).toBe(200);
      expect((await post(`/api/v1/projects/${A}/parameter-file-candidates/${candidate.body.item.id}/source-apply`,body)).body).toEqual(result.body);
      return result;
    }
    async function prepare(action: "set" | "remove-override", rawText?: string) {
      const revisions = await api.query<{id:string}>("select id from dts_config_revisions where config_set_id=$1 order by revision_number desc limit 1",[sets[A]]);
      const topology = await requestJson<{item:TopologyTree}>(server(),`/api/v2/projects/${A}/config-sets/${sets[A]}/revisions/${revisions.rows[0]!.id}/topology`);
      if(topology.body.item.view!=="effective")throw new Error("Expected effective graph");
      const node=topology.body.item.nodes.find(row=>row.locator==="/secondary")!;
      const final=node.effects.filter(row=>row.propertyName==="iin_max").at(-1)!;
      const body={expectedConfigRevisionId:revisions.rows[0]!.id,logicalNodeId:node.logicalNodeId,propertyName:"iin_max",propertyOccurrenceId:final.propertyOccurrenceId,action,...(rawText?{rawText}:{})};
      const path=`/api/v1/projects/${A}/config-sets/${sets[A]}/local-override/prepare`;
      expect((await post(path,body,editor)).status).toBe(200);
      expect((await post(path,{...body,expectedConfigRevisionId:"stale"})).status).toBe(409);
      const result=await post<{item:{before:string;after:string;afterValue:string|null;fileId:string}}>(path,body);
      expect(result.status,result.bodyText).toBe(200);
      expect(result.body.item.fileId).toBe(root.fileId);
      return result.body.item;
    }
    const set=await prepare("set","<31>");
    expect(set.before).toBe(original.bodyText);expect(set.afterValue).toBe("<31>");
    await edit(set.after,"set-local");
    const overridden=await listCatalogBindingRowsForProject(api,admin,{projectId:A});
    expect(overridden.find(row=>row.id===inherited.id)?.rawValue).toBe("<31>");
    expect(overridden.map(row=>row.id).sort()).toEqual(beforeA.map(row=>row.id).sort());
    await edit(set.after+'\n&{/secondary} { iin_max = <32>; };\n',"second-local-layer");
    const lowerLocal=await prepare("remove-override");
    expect(lowerLocal.afterValue).toBe("<31>");
    expect(lowerLocal.after).not.toContain("<32>");
    expect(lowerLocal.after).toContain("<31>");
    expect(lowerLocal.after).not.toContain("/delete-property/ iin_max");
    await edit(lowerLocal.after,"remove-second-layer");
    const removal=await prepare("remove-override");
    expect(removal.afterValue).toBe("<25>");
    await edit(removal.after,"remove-local");
    const removed=await listCatalogBindingRowsForProject(api,admin,{projectId:A});
    expect(removed.find(row=>row.id===inherited.id)).toMatchObject({rawValue:"<25>",sourceOccurrenceId:inherited.sourceOccurrenceId});
    expect(removed.filter(row=>row.id!==inherited.id).map(row=>[row.id,row.rawValue])).toEqual(beforeA.filter(row=>row.id!==inherited.id).map(row=>[row.id,row.rawValue]));
    const intentional=await prepare("set","<25>");
    expect(intentional.after).not.toBe(intentional.before);
    await edit(intentional.after,"intentional-equal-override");
    const equalRemoval=await prepare("remove-override");expect(equalRemoval.afterValue).toBe("<25>");
    await edit(equalRemoval.after,"remove-intentional-equal");
    const exported=await requestJson<{files:Array<{name:string;content:string}>}>(server(),`/api/v1/projects/${A}/config-sets/${sets[A]}/export`);
    expect(exported.body.files.find(file=>file.name==="limits.dtsi")?.content).toBe(shared);
    const history=await requestJson<{items:Array<{oldCurrentValueId:string;newCurrentValueId:string;successAuditRef:string}>}>(server(),`/api/v2/projects/${A}/parameter-bindings/${inherited.id}/change-history`);
    expect(history.status,history.bodyText).toBe(200);expect(history.body.items.length).toBeGreaterThanOrEqual(4);
    expect(history.body.items.every(item=>Boolean(item.successAuditRef))).toBe(true);
    await edit(removal.after+'\n&{/secondary} { unregistered_raw = <7>; };\n',"raw-property");
    const rawRevision=(await api.query<{id:string}>("select id from dts_config_revisions where config_set_id=$1 order by revision_number desc limit 1",[sets[A]])).rows[0]!.id;
    const rawNode=(await requestJson<{item:TopologyTree}>(server(),`/api/v2/projects/${A}/config-sets/${sets[A]}/revisions/${rawRevision}/topology`)).body.item;
    if(rawNode.view!=="effective")throw new Error("Expected effective graph");
    const rawInput={expectedConfigRevisionId:rawRevision,logicalNodeId:rawNode.nodes.find(node=>node.locator==="/secondary")!.logicalNodeId,propertyName:"unregistered_raw",action:"remove-override"};
    const rawPath=`/api/v1/projects/${A}/config-sets/${sets[A]}/local-override/prepare`;
    expect((await post(rawPath,rawInput,editor)).status).toBe(403);
    const rawRemoval=await post<{item:{after:string;afterValue:string|null;localOverride?:unknown}}>(rawPath,rawInput);
    expect(rawRemoval.status,rawRemoval.bodyText).toBe(200);expect(rawRemoval.body.item.afterValue).toBeNull();expect(rawRemoval.body.item.localOverride).toBeUndefined();
    await edit(rawRemoval.body.item.after,"remove-raw-property");
    expect((await listCatalogBindingRowsForProject(api,admin,{projectId:A})).map(row=>row.id)).toEqual(beforeA.map(row=>row.id));
    expect(await listCatalogBindingRowsForProject(api,admin,{projectId:B})).toEqual(beforeB);
  },60_000);
  it("lets an ordinary editor submit only the exact property patch for an independent reviewer", async()=>{
    const revision=(await api.query<{id:string}>("select id from dts_config_revisions where config_set_id=$1 order by revision_number desc limit 1",[sets[A]])).rows[0]!.id;
    const topology=await requestJson<{item:TopologyTree}>(server(),`/api/v2/projects/${A}/config-sets/${sets[A]}/revisions/${revision}/topology`);
    if(topology.body.item.view!=="effective")throw new Error("Expected effective graph");
    const node=topology.body.item.nodes.find(row=>row.locator==="/secondary")!;
    const final=node.effects.filter(row=>row.propertyName==="iin_max").at(-1)!;
    const input={expectedConfigRevisionId:revision,logicalNodeId:node.logicalNodeId,propertyName:"iin_max",propertyOccurrenceId:final.propertyOccurrenceId,action:"set",rawText:"<33>"};
    const preparationPath=`/api/v1/projects/${A}/config-sets/${sets[A]}/local-override/prepare`;
    const prepared=await post<{item:{fileId:string;fileName:string;baseVersionId:string;before:string;after:string}}>(preparationPath,input,editor);
    expect(prepared.status,prepared.bodyText).toBe(200);
    const candidatePath=`/api/v1/projects/${A}/parameter-file-candidates`;
    const body={fileId:prepared.body.item.fileId,fileName:prepared.body.item.fileName,intent:"source_revision",localOverride:input,
      expectedCurrentVersionId:prepared.body.item.baseVersionId,expectedConfigRevisionId:revision,contentBase64:Buffer.from(prepared.body.item.after).toString("base64"),clientMutationId:"editor-local"};
    expect((await post(candidatePath,{...body,localOverride:undefined},editor)).status).toBe(403);
    for(const [forged,status] of [
      [{...body,contentBase64:Buffer.from(prepared.body.item.after+'\n&{/charger} { iin_max = <99>; };').toString("base64"),clientMutationId:"forged-extra"},403],
      [{...body,localOverride:{...input,logicalNodeId:topology.body.item.nodes.find(row=>row.locator==="/charger")!.logicalNodeId},clientMutationId:"forged-node"},409],
      [{...body,localOverride:{...input,propertyName:"unregistered_raw"},clientMutationId:"forged-property"},403]
    ] as const)expect((await post(candidatePath,forged,editor)).status).toBe(status);
    const candidate=await post<{item:{id:string}}>(candidatePath,body,editor);expect(candidate.status,candidate.bodyText).toBe(201);
    expect((await post(candidatePath,body,editor)).body).toEqual(candidate.body);
    const preview=await requestJson<{item:SourceRevisionPreview}>(server(editor),`${candidatePath}/${candidate.body.item.id}/source-preview`);
    expect(preview.status,preview.bodyText).toBe(200);
    const submit={expectedCurrentVersionId:body.expectedCurrentVersionId,expectedProofToken:preview.body.item.proofToken,assignedToUserId:reviewer.user.id,reason:"Editor requests one project override",clientMutationId:"editor-submit"};
    expect((await post(`${candidatePath}/${candidate.body.item.id}/source-apply`,{...submit,assignedToUserId:undefined},editor)).status).toBe(403);
    await db.query("delete from public.project_members where user_id='shared-ref-editor' and project_id=$1",[A]);
    expect((await post(`${candidatePath}/${candidate.body.item.id}/source-submit`,submit,editor)).status).toBe(403);
    await db.query("insert into public.project_members(organization_id,project_id,user_id,roles) values ($1,$2,'shared-ref-editor',ARRAY['hardware-user']::text[])",[ORG,A]);
    expect((await post(`${candidatePath}/${candidate.body.item.id}/source-submit`,{...submit,assignedToUserId:ADMIN},reviewer)).status).toBe(403);
    const submitted=await post<{item:{requestId:string}}>(`${candidatePath}/${candidate.body.item.id}/source-submit`,submit,editor);
    expect(submitted.status,submitted.bodyText).toBe(200);
    const valuesBefore=await listCatalogBindingRowsForProject(api,admin,{projectId:A});
    const inherited=valuesBefore.find(row=>row.sourceNodePath==="/secondary" || row.sourceNodePath==="secondary")!;expect(inherited.rawValue).toBe("<25>");
    const requestPath=`/api/v2/projects/${A}/source-revision-requests/${submitted.body.item.requestId}/review`;
    const decision={decision:"approve",proofDigest:preview.body.item.proofToken};
    expect((await post(requestPath,decision,editor)).status).toBe(403);
    const membersBeforeFailure=await requestJson(server(),`/api/v1/projects/${A}/config-sets/${sets[A]}/files`);
    await db.query(`create function public.fail_local_override_audit_test() returns trigger language plpgsql as $$ begin
      if new.action='value-change-applied' and new.metadata->>'sourceOperation'='project-local-override' then raise exception 'Injected local override audit failure'; end if; return new; end $$`);
    await db.query("create trigger fail_local_override_audit_test before insert on public.audit_events for each row execute function public.fail_local_override_audit_test()");
    try {expect((await post(requestPath,decision,reviewer)).status).toBe(500);}
    finally {await db.query("drop trigger fail_local_override_audit_test on public.audit_events");await db.query("drop function public.fail_local_override_audit_test()");}
    expect((await requestJson(server(),`/api/v1/projects/${A}/config-sets/${sets[A]}/files`)).body).toEqual(membersBeforeFailure.body);
    expect(await listCatalogBindingRowsForProject(api,admin,{projectId:A})).toEqual(valuesBefore);
    const pending=await requestJson<{item:{status:string}}>(server(reviewer),requestPath.replace(/\/review$/,""));expect(pending.body.item.status).toBe("pending");
    const applied=await post(requestPath,decision,reviewer);expect(applied.status,applied.bodyText).toBe(200);
    expect((await post(requestPath,decision,reviewer)).body).toEqual(applied.body);
    const after=await listCatalogBindingRowsForProject(api,admin,{projectId:A});
    expect(after.find(row=>row.id===inherited.id)?.rawValue).toBe("<33>");
    const currentRevision=(await api.query<{id:string}>("select id from dts_config_revisions where config_set_id=$1 order by revision_number desc limit 1",[sets[A]])).rows[0]!.id;
    const removeInput={...input,expectedConfigRevisionId:currentRevision,action:"remove-override",rawText:undefined,propertyOccurrenceId:undefined};
    const removal=await post<{item:{fileId:string;fileName:string;baseVersionId:string;after:string;afterValue:string}}>(preparationPath,removeInput,editor);
    expect(removal.status,removal.bodyText).toBe(200);expect(removal.body.item.afterValue).toBe("<25>");
    const removeCandidate=await post<{item:{id:string}}>(candidatePath,{...body,localOverride:removeInput,expectedCurrentVersionId:removal.body.item.baseVersionId,
      expectedConfigRevisionId:currentRevision,contentBase64:Buffer.from(removal.body.item.after).toString("base64"),clientMutationId:"editor-remove"},editor);
    expect(removeCandidate.status,removeCandidate.bodyText).toBe(201);
    const removePreview=await requestJson<{item:SourceRevisionPreview}>(server(editor),`${candidatePath}/${removeCandidate.body.item.id}/source-preview`);
    expect(removePreview.status,removePreview.bodyText).toBe(200);
    const removeSubmit=await post<{item:{requestId:string}}>(`${candidatePath}/${removeCandidate.body.item.id}/source-submit`,{...submit,expectedCurrentVersionId:removal.body.item.baseVersionId,
      expectedProofToken:removePreview.body.item.proofToken,clientMutationId:"editor-remove-submit"},editor);
    expect(removeSubmit.status,removeSubmit.bodyText).toBe(200);
    const removed=await post(`/api/v2/projects/${A}/source-revision-requests/${removeSubmit.body.item.requestId}/review`,{decision:"approve",proofDigest:removePreview.body.item.proofToken},reviewer);
    expect(removed.status,removed.bodyText).toBe(200);
    expect((await listCatalogBindingRowsForProject(api,admin,{projectId:A})).find(row=>row.id===inherited.id)?.rawValue).toBe("<25>");
  });

  it("overrides and removes one inherited macro value without rewriting its header or sibling instance", async()=>{
    const macroSource='#include "limits.h"\n/ { cppFirst { compatible = "acme,power"; iin_max = <SHARED_CAP>; }; cppSecond { compatible = "acme,power"; iin_max = <SHARED_CAP>; }; };';
    const header='#define SHARED_CAP 25\n';
    const draft=await post<{item:{resourceId:string;revision:number}}>("/api/v2/shared-dtsi",{name:"CPP override",members:[{sourceName:"cpp-defaults.dtsi",content:macroSource},{sourceName:"limits.h",content:header}],changeDescription:"Original macro source"});
    expect(draft.status,draft.bodyText).toBe(201);const resourceId=draft.body.item.resourceId;
    const publication=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${resourceId}/publication-preview`,{expectedRevision:draft.body.item.revision});
    expect(publication.status,publication.bodyText).toBe(201);
    const version=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${resourceId}/publications`,{previewId:publication.body.item.id,idempotencyKey:"cpp-override-v1"});
    expect(version.status,version.bodyText).toBe(201);
    const addition={sharedReference:{resourceId,versionId:version.body.item.id},role:"misc",sortOrder:10};
    const composed=await post<Preview>(`${path(A)}/preview`,addition);expect(composed.status,composed.bodyText).toBe(200);
    const added=await post<Applied>(`${path(A)}/apply`,{...addition,proofToken:composed.body.item.proofToken,reason:"CPP in complete project",clientMutationId:"cpp-project"});
    expect(added.status,added.bodyText).toBe(200);
    const before=await listCatalogBindingRowsForProject(api,admin,{projectId:A});
    const first=before.find(row=>row.sourceNodePath==="cppFirst" || row.sourceNodePath==="/cppFirst")!;
    const second=before.find(row=>row.sourceNodePath==="cppSecond" || row.sourceNodePath==="/cppSecond")!;
    expect(first.rawValue).toBe("<25>");expect(second.rawValue).toBe("<25>");expect(first.id).not.toBe(second.id);
    const membersBefore=(await requestJson<{items:Array<{fileId:string;currentVersionId:string;sharedReference?:unknown}>}>(server(),`/api/v1/projects/${A}/config-sets/${sets[A]}/files`)).body.items.filter(member=>member.sharedReference);
    async function change(action:"set"|"remove-override") {
      const revision=(await api.query<{id:string}>("select id from dts_config_revisions where config_set_id=$1 order by revision_number desc limit 1",[sets[A]])).rows[0]!.id;
      const input={expectedConfigRevisionId:revision,logicalNodeId:first.logicalNodeId,propertyName:"iin_max",action,...(action==="set"?{rawText:"<31>"}:{})};
      const prepared=await post<{item:{fileId:string;fileName:string;baseVersionId:string;before:string;after:string;afterValue:string}}>(`/api/v1/projects/${A}/config-sets/${sets[A]}/local-override/prepare`,input);
      expect(prepared.status,prepared.bodyText).toBe(200);expect(prepared.body.item.afterValue).toBe(action==="set"?"<31>":"<25>");
      const candidate=await post<{item:{id:string}}>(`/api/v1/projects/${A}/parameter-file-candidates`,{fileId:prepared.body.item.fileId,fileName:prepared.body.item.fileName,
        intent:"source_revision",localOverride:input,contentBase64:Buffer.from(prepared.body.item.after).toString("base64"),expectedCurrentVersionId:prepared.body.item.baseVersionId,expectedConfigRevisionId:revision,clientMutationId:`cpp-${action}`});
      expect(candidate.status,candidate.bodyText).toBe(201);
      const preview=await requestJson<{item:SourceRevisionPreview}>(server(),`/api/v1/projects/${A}/parameter-file-candidates/${candidate.body.item.id}/source-preview`);
      expect(preview.status,preview.bodyText).toBe(200);
      const applied=await post(`/api/v1/projects/${A}/parameter-file-candidates/${candidate.body.item.id}/source-apply`,{expectedCurrentVersionId:prepared.body.item.baseVersionId,
        expectedProofToken:preview.body.item.proofToken,reason:"One original project override",clientMutationId:`cpp-${action}-apply`});
      expect(applied.status,applied.bodyText).toBe(200);
    }
    await change("set");
    let values=await listCatalogBindingRowsForProject(api,admin,{projectId:A});
    expect(values.find(row=>row.id===first.id)?.rawValue).toBe("<31>");expect(values.find(row=>row.id===second.id)?.rawValue).toBe("<25>");
    await change("remove-override");
    values=await listCatalogBindingRowsForProject(api,admin,{projectId:A});
    expect(values.find(row=>row.id===first.id)).toMatchObject({rawValue:"<25>",sourceOccurrenceId:first.sourceOccurrenceId});
    expect(values.find(row=>row.id===second.id)?.rawValue).toBe("<25>");
    const membersAfter=(await requestJson<{items:Array<{fileId:string;currentVersionId:string;sharedReference?:unknown}>}>(server(),`/api/v1/projects/${A}/config-sets/${sets[A]}/files`)).body.items.filter(member=>member.sharedReference);
    expect(membersAfter).toEqual(membersBefore);
    const exported=await requestJson<{files:Array<{name:string;content:string}>}>(server(),`/api/v1/projects/${A}/config-sets/${sets[A]}/export`);
    expect(exported.body.files.find(file=>file.name==="limits.h")?.content).toBe(header);
    expect(exported.body.files.find(file=>file.name==="cpp-defaults.dtsi")?.content).toBe(macroSource);
  },120_000);

});
