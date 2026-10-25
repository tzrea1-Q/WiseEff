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
import { previewProjectDeletion } from "../projects/deletionPreview";
import { purgeProject } from "../projects/purge";
import { createUserInvocation } from "../auth/trustedInvocation";
import { getAuthContext } from "../auth/repository";
import type { SourceRevisionPreview } from "./sourceRevisionService";
import type { TopologyTree } from "../../../src/domain/parameter-topology/types";

const ORG = "org-shared-ref", ADMIN = "user-shared-ref", A = "shared-project-a", B = "shared-project-b";
const admin = makeTestAuthContext({ organizationId: ORG, userId: ADMIN, roles: [{ roleId: "admin", projectId: null }] });
const editor = makeTestAuthContext({ organizationId: ORG, userId: "shared-ref-editor", roles: [{ roleId: "hardware-user", projectId: A }] });
const source = '/dts-v1/; / { compatible = "test,board"; model = "shared reference"; charger: charger { compatible = "acme,power"; iin_max = <36>; }; };';
const shared = '/ { common: common { status = "okay"; }; charger { iin_max = <42>; }; secondary { compatible = "acme,power"; iin_max = <25>; }; };';
type Preview = { item: { proofToken: string; entryFile: string; members: unknown[] } };
type Applied = { item: { fileId: string; fileVersionId: string; configRevisionId: string } };

describe("fixed shared references through the real API role", () => {
  let lane: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>, api: ReturnType<typeof createPostgresDatabase>;
  let storage: ReturnType<typeof createLocalObjectStore>, directory: string;
  const sets: Record<string, string> = {}, token = `shared_ref_${process.pid}`;
  const jsonFiles: Record<string, { fileId: string; versionId: string }> = {};
  let resourceId: string, versionId: string, appliedA: Applied["item"], appliedB: Applied["item"];
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
    api = createPostgresDatabase((await provisionPublicationRuntimeLogins(lane.url, { mode: "lab", runToken: token })).apiUrl);
    expect((await api.query<{ rolsuper: boolean; rolinherit: boolean }>("select rolsuper,rolinherit from pg_roles where rolname=current_user")).rows[0])
      .toEqual({ rolsuper: false, rolinherit: false });
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('shared-ref-editor-role','shared-ref-editor',$1,$2,'hardware-user')", [ORG, A]);
  }, 120_000);
  afterAll(async () => { await api?.close(); if (lane) await dropLabRuntimeLogins(lane.url, token); await db?.close(); await lane?.drop(); if (directory) await rm(directory, { recursive: true, force: true }); }, 120_000);

  it("materializes exact immutable project-owned sources without silently following publication", async () => {
    const draft = await post<{ item: { resourceId: string; revision: number } }>("/api/v2/shared-dtsi", { name: "Charger limits", sourceName: "limits.dtsi", content: shared, changeDescription: "Initial shared source" });
    expect(draft.status, draft.bodyText).toBe(201);
    resourceId = draft.body.item.resourceId;
    const publication = await post<{ item: { id: string } }>(`/api/v2/shared-dtsi/${resourceId}/publication-preview`, { expectedRevision: draft.body.item.revision });
    const version = await post<{ item: { id: string } }>(`/api/v2/shared-dtsi/${resourceId}/publications`, { previewId: publication.body.item.id, idempotencyKey: "shared-ref-v1" });
    expect(version.status, version.bodyText).toBe(201);
    versionId = version.body.item.id;
    const body = { sharedReference: { resourceId, versionId: version.body.item.id }, role: "misc", sortOrder: 1 };
    const preview = await post<Preview>(`${path(A)}/preview`, body);
    expect(preview.status, preview.bodyText).toBe(200);
    expect(preview.body.item.entryFile).toBe("board.dts");
    const applied = await post<Applied>(`${path(A)}/apply`, { ...body, proofToken: preview.body.item.proofToken, reason: "Use fixed reviewed source", clientMutationId: "shared-ref-a" });
    expect(applied.status, applied.bodyText).toBe(200);
    appliedA = applied.body.item;
    const files = await requestJson<{ items: Array<{ fileId: string; sharedReference?: { resourceId: string; versionId: string; memberId: string; readOnly: boolean } }> }>(server(), `/api/v1/projects/${A}/config-sets/${sets[A]}/files`);
    expect(files.body.items.find(file => file.fileId === applied.body.item.fileId)?.sharedReference).toMatchObject({ resourceId, versionId: version.body.item.id, readOnly: true });
    const other = await requestJson<{ items: unknown[] }>(server(), `/api/v1/projects/${B}/config-sets/${sets[B]}/files`);
    expect(other.body.items).toHaveLength(2);
    const values = await listCatalogBindingRowsForProject(api, admin, { projectId: A });
    expect(values.map(value => value.rawValue).sort()).toEqual(["<25>", "<36>"]);
    const topology = await requestJson<{ item: TopologyTree }>(server(), `/api/v2/projects/${A}/config-sets/${sets[A]}/revisions/${appliedA.configRevisionId}/topology`);
    expect(topology.status, topology.bodyText).toBe(200);
    expect(topology.bodyText).toContain("/common");
    if (topology.body.item.view !== "effective") throw new Error("Expected effective topology");
    const charger = topology.body.item.nodes.find(node => node.locator === "/charger")!;
    const chain = charger.effects.filter(effect => effect.propertyName === "iin_max");
    expect(chain.map(effect => effect.rawText)).toEqual(["<42>", "<36>"]);
    expect(chain.map(effect => effect.valueText)).toEqual(["<42>", "<36>"]);
    expect(chain.map(effect => effect.effectKind)).toEqual(["set", "override"]);
    expect(chain[0]?.source).toMatchObject({ fileId: appliedA.fileId, fileVersionId: appliedA.fileVersionId,
      sourceName: "limits.dtsi", startLine: 1, sharedReference: { resourceId, versionId, readOnly: true } });
    expect(chain[1]?.source).toMatchObject({ sourceName: "board.dts" });
    expect(chain[1]?.source?.sharedReference).toBeUndefined();
    const secondary = topology.body.item.nodes.find(node => node.locator === "/secondary")!;
    expect(secondary.compatible).toBe(charger.compatible);
    expect(secondary.logicalNodeId).not.toBe(charger.logicalNodeId);
    expect(secondary.effects.find(effect => effect.propertyName === "iin_max")?.rawText).toBe("<25>");
    const exported = await requestJson<{ manifest: { members: Array<{ sharedReference?: { versionId: string } }> }; files: Array<{ name: string; content: string }> }>(server(), `/api/v1/projects/${A}/config-sets/${sets[A]}/export`);
    expect(exported.status, exported.bodyText).toBe(200);
    expect(exported.body.files.find(file => file.name === "limits.dtsi")?.content).toBe(shared);
    expect(exported.body.manifest.members.find(member => member.sharedReference)?.sharedReference?.versionId).toBe(versionId);
    const previewB = await post<Preview>(`${path(B)}/preview`, body);
    const bodyB = { ...body, proofToken: previewB.body.item.proofToken, reason: "Use fixed source in independent project", clientMutationId: "shared-ref-b" };
    const responseB = await post<Applied>(`${path(B)}/apply`, bodyB);
    expect(responseB.status, responseB.bodyText).toBe(200); appliedB = responseB.body.item;
    expect(appliedB.fileId).not.toBe(appliedA.fileId); expect(appliedB.fileVersionId).not.toBe(appliedA.fileVersionId);
    expect((await post(`${path(B)}/apply`, bodyB)).body).toEqual(responseB.body);
    for (const project of [A, B]) {
      const json = jsonFiles[project]!;
      const bytes = await requestJson(server(), `/api/v1/projects/${project}/parameter-files/${json.fileId}/versions/${json.versionId}/content`);
      expect(bytes.status).toBe(200); expect(bytes.bodyText).toBe('{"local":true}');
    }
  });

  it("preserves declared conditional include closure and mounted build settings through real CPP reference writes", async () => {
    const projectId="shared-cpp-build-inputs",rootSource='/dts-v1/;\n/ { compatible = "test,board"; model = "CPP reference"; };\n';
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,$1,$1,'initialized')",[projectId,ORG]);
    const configSetId=sets[projectId]=(await createConfigSet(db,admin,{projectId,name:"Original CPP settings"})).id;
    const root=await uploadProjectParameterFile(db,storage,admin,{projectId,fileName:"cpp-board.dts",bytes:Buffer.from(rootSource)});
    await addConfigSetFile(db,admin,{configSetId,fileId:root.file.id,role:"base",sortOrder:0});
    await ingestConfigRevision(db,{organizationId:ORG,projectId,configSetId,entryFile:"cpp-board.dts",includeSearchPaths:["."],overlayOrder:[],
      members:[{fileId:root.file.id,fileVersionId:root.version.id,fileName:"cpp-board.dts",role:"base",sortOrder:0,content:rootSource}]},admin);
    const publish=async(name:string,members:{sourceName:string;content:string}[],defines:Record<string,string>,includeSearchPaths=["include"])=>{
      const draft=await post<{item:{resourceId:string}}>("/api/v2/shared-dtsi",{name,members,buildInputs:{includeSearchPaths,defines},changeDescription:"Freeze original engineering inputs"});
      expect(draft.status,draft.bodyText).toBe(201);
      const preview=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${draft.body.item.resourceId}/publication-preview`,{expectedRevision:1});
      expect(preview.status,preview.bodyText).toBe(201);
      const result=await post<{item:{id:string;resourceId:string}}>(`/api/v2/shared-dtsi/${draft.body.item.resourceId}/publications`,{previewId:preview.body.item.id,idempotencyKey:draft.body.item.resourceId});
      expect(result.status,result.bodyText).toBe(201);return result.body.item;
    };
    const originals=[{sourceName:"main.dtsi",content:'#include <dt-bindings/power.h>\n#if FLAG\n#include "a.dtsi"\n#else\n#include "b.dtsi"\n#endif\n'},
      {sourceName:"a.dtsi",content:'/ { cpp_power { compatible = "acme,power"; iin_max = <BIT(3)>; }; };\n'},
      {sourceName:"b.dtsi",content:'/ { cpp_inactive { status = "disabled"; }; };\n'},
      {sourceName:"include/dt-bindings/power.h",content:'#define BIT(x) (1U << (x))\n'}];
    const fixed=await publish("Conditional engineering source",originals,{FLAG:"1"});
    const input={sharedReference:{resourceId:fixed.resourceId,versionId:fixed.id,mountPath:"vendor/power"},role:"misc",sortOrder:1};
    const preview=await post<Preview>(`${path(projectId)}/preview`,input);
    expect(preview.status,preview.bodyText).toBe(200);
    const applied=await post<Applied>(`${path(projectId)}/apply`,{...input,proofToken:preview.body.item.proofToken,reason:"Use frozen original CPP inputs",clientMutationId:"cpp-original-reference"});
    expect(applied.status,applied.bodyText).toBe(200);
    const revision=(await db.query<{include_search_paths:string[];declared_build_inputs:unknown;preprocessing:unknown}>("select include_search_paths,declared_build_inputs,preprocessing from dts_config_revisions where id=$1",[applied.body.item.configRevisionId])).rows[0]!;
    expect(revision.include_search_paths).toEqual([".","vendor/power/include"]);
    expect(revision.declared_build_inputs).toEqual({includeSearchPaths:["."],defines:{}});
    expect(revision.preprocessing).toMatchObject({defines:{FLAG:"1"}});
    expect((await listCatalogBindingRowsForProject(api,admin,{projectId})).map(row=>row.rawValue)).toEqual(["<8>"]);
    const effects=await db.query<{source_name:string}>(`select member.source_name from dts_property_occurrences occurrence join dts_config_revision_members member
      on member.config_revision_id=occurrence.config_revision_id and member.file_version_id=occurrence.file_version_id where occurrence.config_revision_id=$1`,[applied.body.item.configRevisionId]);
    expect(effects.rows.map(row=>row.source_name)).not.toContain("vendor/power/b.dtsi");
    const exported=await requestJson<{files:{name:string;content:string}[];manifest:{preprocessing:unknown;declaredBuildInputs:unknown}}>(server(),`/api/v1/projects/${projectId}/config-sets/${configSetId}/export`);
    expect(exported.status,exported.bodyText).toBe(200);
    for(const member of originals)expect(exported.body.files).toContainEqual({name:`vendor/power/${member.sourceName}`,format:"dts",content:member.content});
    expect(exported.body.manifest.preprocessing).toEqual(revision.preprocessing);
    expect(exported.body.manifest.declaredBuildInputs).toEqual(revision.declared_build_inputs);
    const before=(await requestJson(server(),`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`)).body;
    const incompatible=await publish("Conflicting build macro",[{sourceName:"conflict.dtsi",content:'/ { conflict {}; };'}],{FLAG:"0"},[]);
    const conflict=await post(`${path(projectId)}/preview`,{sharedReference:{resourceId:incompatible.resourceId,versionId:incompatible.id,mountPath:"conflict"},role:"misc",sortOrder:10});
    expect(conflict.status,conflict.bodyText).toBe(400);expect(conflict.bodyText).toContain("FLAG");
    const ambiguous=await publish("Ambiguous include binding",[{sourceName:"other.dtsi",content:'/ { other {}; };'},
      {sourceName:"include/dt-bindings/power.h",content:'#define OTHER 1\n'}],{FLAG:"1"});
    const collision=await post(`${path(projectId)}/preview`,{sharedReference:{resourceId:ambiguous.resourceId,versionId:ambiguous.id,mountPath:"other"},role:"misc",sortOrder:10});
    expect(collision.status,collision.bodyText).toBe(400);expect(collision.bodyText).toContain("多个搜索目录");
    expect((await requestJson(server(),`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`)).body).toEqual(before);
    const candidate=await post<{item:{id:string}}>(`/api/v1/projects/${projectId}/parameter-file-candidates`,{fileId:root.file.id,fileName:"cpp-board.dts",contentBase64:Buffer.from(rootSource).toString("base64"),intent:"source_revision",
      expectedCurrentVersionId:(before as {items:{fileId:string;currentVersionId:string}[]}).items.find(row=>row.fileId===root.file.id)!.currentVersionId,expectedConfigRevisionId:applied.body.item.configRevisionId,clientMutationId:"cpp-remove-entry"});
    expect(candidate.status,candidate.bodyText).toBe(201);
    const removalPreview=await requestJson<{item:SourceRevisionPreview}>(server(),`/api/v1/projects/${projectId}/parameter-file-candidates/${candidate.body.item.id}/source-preview`);
    expect(removalPreview.status,removalPreview.bodyText).toBe(200);
    const removed=await post(`/api/v1/projects/${projectId}/parameter-file-candidates/${candidate.body.item.id}/source-apply`,{expectedCurrentVersionId:(before as {items:{fileId:string;currentVersionId:string}[]}).items.find(row=>row.fileId===root.file.id)!.currentVersionId,
      expectedProofToken:removalPreview.body.item.proofToken,reason:"Cannot sever fixed declaration closure",clientMutationId:"cpp-remove-entry-apply"});
    expect(removed.status,removed.bodyText).toBe(409);expect(removed.bodyText).toContain("shared-reference-closure-required");
    expect((await requestJson(server(),`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`)).body).toEqual(before);
  },120_000);

  it("composes an exact multi-resource closure and keeps every source in independent project history",async()=>{
    const publish=async(name:string,members:{sourceName:string;content:string}[],dependencies:unknown[]=[])=>{
      const draft=await post<{item:{resourceId:string}}>("/api/v2/shared-dtsi",{name,members,dependencies,changeDescription:"Complete dependency composition"});
      expect(draft.status,draft.bodyText).toBe(201);
      const preview=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${draft.body.item.resourceId}/publication-preview`,{expectedRevision:1});
      expect(preview.status,preview.bodyText).toBe(201);
      const result=await post<{item:{id:string;resourceId:string}}>(`/api/v2/shared-dtsi/${draft.body.item.resourceId}/publications`,{previewId:preview.body.item.id,idempotencyKey:draft.body.item.resourceId});
      expect(result.status,result.bodyText).toBe(201);return result.body.item;
    };
    const leafSource='/ { fixed_leaf: fixed-leaf { status = "okay"; }; };';
    const leaf=await publish("Fixed leaf",[{sourceName:"leaf.dtsi",content:leafSource}]);
    const mainSource='/include/ "parts/nodes.dtsi"\n/include/ "vendor/leaf.dtsi"\n&fixed_leaf { value = <42>; };';
    const root=await publish("Complete library",[{sourceName:"main.dtsi",content:mainSource},{sourceName:"parts/nodes.dtsi",content:'/ { fixed_second: fixed-second { status = "okay"; }; };'}],
      [{resourceId:leaf.resourceId,versionId:leaf.id,mountPath:"vendor"}]);
    const body={sharedReference:{resourceId:root.resourceId,versionId:root.id,mountPath:"mounted"},role:"misc",sortOrder:10};
    const seen:string[][]=[];
    for(const project of [A,B]) {
      const preview=await post<Preview>(`${path(project)}/preview`,body);
      expect(preview.status,preview.bodyText).toBe(200);
      if(project===A) {
        const before=(await requestJson(server(),`/api/v1/projects/${A}/config-sets/${sets[A]}/files`)).body;
        const objects=await readdir(directory,{recursive:true});let puts=0,badKey="";
        const partialStore:ObjectStore={...storage,async put(input){const item=await storage.put(input);if(++puts===2)badKey=item.storageKey;return item;},
          async getBounded(key,max){return key===badKey?Buffer.from("corrupt second dependency"):storage.getBounded!(key,max);}};
        const failed=await post(`${path(project)}/apply`,{...body,proofToken:preview.body.item.proofToken,reason:"No partial dependency activation",clientMutationId:"complete-partial-failure"},admin,partialStore);
        expect(failed.status,failed.bodyText).toBe(409);
        expect((await requestJson(server(),`/api/v1/projects/${A}/config-sets/${sets[A]}/files`)).body).toEqual(before);
        expect(await readdir(directory,{recursive:true})).toEqual(objects);
      }
      const applied=await post<Applied>(`${path(project)}/apply`,{...body,proofToken:preview.body.item.proofToken,reason:"Apply exact complete closure",clientMutationId:`complete-${project}`});
      expect(applied.status,applied.bodyText).toBe(200);
      if(project===A)appliedA.configRevisionId=applied.body.item.configRevisionId;else appliedB.configRevisionId=applied.body.item.configRevisionId;
      const exported=await requestJson<{files:{name:string;content:string}[];manifest:{members:{fileId:string;fileName:string;sharedReference?:{resourceId:string}}[]}}>(server(),`/api/v1/projects/${project}/config-sets/${sets[project]}/export`);
      expect(exported.status,exported.bodyText).toBe(200);
      expect(exported.body.files).toContainEqual(expect.objectContaining({name:"mounted/vendor/leaf.dtsi",content:leafSource}));
      expect(exported.body.files).toContainEqual(expect.objectContaining({name:"mounted/main.dtsi",content:mainSource}));
      expect(exported.body.manifest.members.filter(member=>member.sharedReference)).toHaveLength(4);
      seen.push(exported.body.manifest.members.filter(member=>member.fileName.startsWith("mounted/")).map(member=>member.fileId));
      const values=await listCatalogBindingRowsForProject(api,admin,{projectId:project});
      expect(values.map(value=>value.rawValue).sort()).toEqual(["<25>","<36>"]);
    }
    expect(seen[0]!.every(id=>!seen[1]!.includes(id))).toBe(true);
    const usages=await requestJson<{items:{projectId:string;direct:boolean}[];total:number;visibility:string}>(server(),`/api/v2/shared-dtsi/${leaf.resourceId}/usages`);
    expect(usages.body.total).toBe(2);expect(usages.body.items).toEqual(expect.arrayContaining([{projectId:A,direct:false},{projectId:B,direct:false}].map(row=>expect.objectContaining(row))));
    expect(usages.body.visibility).toBe("organization");
    const restricted=await requestJson<{items:{projectId:string}[];total:number;visibility:string}>(server(editor),`/api/v2/shared-dtsi/${leaf.resourceId}/usages`);
    expect(restricted.body.total).toBe(1);expect(restricted.body.items.map(row=>row.projectId)).toEqual([A]);expect(restricted.bodyText).not.toContain(B);
    expect(restricted.body.visibility).toBe("authorized-projects");
    await db.query("update user_role_bindings set project_id=null where id='shared-ref-editor-role'");
    try {
      const organizationGrant=await requestJson<{total:number;visibility:string}>(server(editor),`/api/v2/shared-dtsi/${leaf.resourceId}/usages`);
      expect(organizationGrant.body).toMatchObject({total:2,visibility:"organization"});
    }finally{await db.query("update user_role_bindings set project_id=$1 where id='shared-ref-editor-role'",[A]);}
    await db.query("delete from user_role_bindings where id='shared-ref-editor-role'");
    try {
      const revoked=await requestJson<{items:unknown[];total:number;visibility:string}>(server(editor),`/api/v2/shared-dtsi/${leaf.resourceId}/usages`);
      expect(revoked.body).toEqual({items:[],total:0,visibility:"authorized-projects"});
    }finally{await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('shared-ref-editor-role','shared-ref-editor',$1,$2,'hardware-user')",[ORG,A]);}
    type Export={manifest:{exportedAt:string;[key:string]:unknown};files:unknown[]};
    const frozenExport=({manifest:{exportedAt:_,...manifest},files}:Export)=>({manifest,files});
    const exportsBefore=await Promise.all([A,B].map(project=>requestJson<Export>(server(),`/api/v1/projects/${project}/config-sets/${sets[project]}/export`)));
    const successor=await post<{item:{revision:number;members:{id:string;sourceName:string;content:string}[]}}>(`/api/v2/shared-dtsi/${leaf.resourceId}/draft`,{baseVersionId:leaf.id});
    expect(successor.status,successor.bodyText).toBe(201);
    const saved=await requestJson(server(),`/api/v2/shared-dtsi/${leaf.resourceId}/draft`,{method:"PUT",body:JSON.stringify({name:"Fixed leaf",members:successor.body.item.members.map(member=>({...member,content:member.content.replace('"okay"','"disabled"')})),changeDescription:"New shared version only",expectedRevision:successor.body.item.revision})});
    expect(saved.status,saved.bodyText).toBe(200);
    const nextPreview=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${leaf.resourceId}/publication-preview`,{expectedRevision:2});
    const next=await post<{item:{id:string;version:number}}>(`/api/v2/shared-dtsi/${leaf.resourceId}/publications`,{previewId:nextPreview.body.item.id,idempotencyKey:"leaf-successor"});
    expect(next.status,next.bodyText).toBe(201);expect(next.body.item.version).toBe(2);
    const oldPins=await requestJson<{items:{projectId:string;versionId:string;version:number;upgradeAvailable:boolean;evaluation:string}[]}>(server(),`/api/v2/shared-dtsi/${leaf.resourceId}/usages`);
    expect(oldPins.body.items).toEqual([A,B].map(projectId=>expect.objectContaining({projectId,versionId:leaf.id,version:1,upgradeAvailable:true,evaluation:"not-evaluated"})));
    for(const [index,project] of [A,B].entries())expect(frozenExport((await requestJson<Export>(server(),`/api/v1/projects/${project}/config-sets/${sets[project]}/export`)).body)).toEqual(frozenExport(exportsBefore[index]!.body));
    const sibling=await publish("Additional consumer",[{sourceName:"consumer.dtsi",content:'&fixed_leaf { sibling = <7>; };'}],
      [{resourceId:leaf.resourceId,versionId:leaf.id,mountPath:"mounted/vendor"}]);
    const siblingBody={sharedReference:{resourceId:sibling.resourceId,versionId:sibling.id},role:"misc",sortOrder:20};
    const siblingPreview=await post<Preview>(`${path(A)}/preview`,siblingBody);
    expect(siblingPreview.status,siblingPreview.bodyText).toBe(200);
    const siblingApplied=await post<Applied>(`${path(A)}/apply`,{...siblingBody,proofToken:siblingPreview.body.item.proofToken,reason:"Reuse the same exact fixed dependency",clientMutationId:"reused-dependency"});
    expect(siblingApplied.status,siblingApplied.bodyText).toBe(200);appliedA.configRevisionId=siblingApplied.body.item.configRevisionId;
    const leafUsages=await requestJson<{total:number}>(server(),`/api/v2/shared-dtsi/${leaf.resourceId}/usages`);expect(leafUsages.body.total).toBe(2);
  });

  it("reauthorizes usage scope after a Home transfer to another Organization administrator",async()=>{
    const otherHome="shared-usage-other-home",transferredUser="shared-usage-transferred-user";
    await db.query("insert into organizations(id,name) values ($1,'Other usage Home')",[otherHome]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Transferred reader','Engineer',true)",[transferredUser,ORG]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('shared-usage-old-project-role',$1,$2,$3,'hardware-user')",[transferredUser,ORG,A]);
    const staleTransfer=await getAuthContext(api,transferredUser);
    await db.transaction(async tx=>{
      await tx.query("delete from user_role_bindings where user_id=$1",[transferredUser]);
      await tx.query("delete from project_members where user_id=$1",[transferredUser]);
      await tx.query("delete from user_oidc_identities where user_id=$1",[transferredUser]);
      await tx.query("update users set organization_id=$1 where id=$2",[otherHome,transferredUser]);
      await tx.query("insert into user_oidc_identities(user_id,organization_id) values ($1,$2)",[transferredUser,otherHome]);
      await tx.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('shared-usage-transferred-admin',$1,$2,'admin')",[transferredUser,otherHome]);
    });
    const transferred=await requestJson(server(staleTransfer),`/api/v2/shared-dtsi/${resourceId}/usages`);
    expect(transferred.status,transferred.bodyText).toBe(403);
    expect(transferred.bodyText).not.toContain(A);expect(transferred.bodyText).not.toContain(B);
  });

  it("rechecks carried operating-target access after the platform role is revoked",async()=>{
    const otherHome="shared-usage-platform-home",platformUser="shared-usage-platform-user";
    await db.query("insert into organizations(id,name) values ($1,'Platform usage Home')",[otherHome]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Operating administrator','Admin',true)",[platformUser,otherHome]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('shared-usage-platform-role',$1,$2,'platform-admin')",[platformUser,otherHome]);
    const stalePlatform=await getAuthContext(api,platformUser);
    const endpoint=`/api/v2/shared-dtsi/${resourceId}/usages?organizationId=${ORG}`;
    const authorized=await requestJson<{items:{projectId:string}[];total:number;visibility:string}>(server(stalePlatform),endpoint);
    expect(authorized.status,authorized.bodyText).toBe(200);
    expect(authorized.body).toMatchObject({total:2,visibility:"organization"});
    expect(authorized.body.items.map(row=>row.projectId).sort()).toEqual([A,B]);
    await db.query("update user_role_bindings set role_id='admin' where id='shared-usage-platform-role'");
    const revoked=await requestJson(server(stalePlatform),endpoint);
    expect(revoked.status,revoked.bodyText).toBe(403);
    expect(revoked.bodyText).not.toContain(A);expect(revoked.bodyText).not.toContain(B);
  });

  it("rejects legacy and canonical direct writes to the shared snapshot", async () => {
    const file = `/api/v1/projects/${A}/parameter-files/${appliedA.fileId}`;
    const candidate = { fileId: appliedA.fileId, fileName: "limits.dtsi", contentBase64: Buffer.from(shared.replace("<25>", "<26>")).toString("base64") };
    expect((await post(`${file}/versions`, { contentBase64: candidate.contentBase64 })).status).toBe(409);
    expect((await post(`/api/v1/projects/${A}/parameter-file-candidates`, candidate)).status).toBe(409);
    expect((await post(`${file}/versions/${appliedA.fileVersionId}/rollback`, {})).status).toBe(409);
    expect((await requestJson(server(), `/api/v1/projects/${A}/config-sets/${sets[A]}/files/${appliedA.fileId}`, { method: "DELETE" })).status).toBe(409);
    expect((await post(`${path(A)}/preview`, { fileId: appliedA.fileId, setAsRoot: true, role: "base", sortOrder: 0 })).status).toBe(409);
    const sharedBinding = (await listCatalogBindingRowsForProject(api, admin, { projectId: A })).find(value => value.rawValue === "<25>")!;
    const draft = await post(`/api/v2/projects/${A}/parameter-bindings/${sharedBinding.id}/drafts`, { baseRevisionId: appliedA.configRevisionId,
      targetValue: { kind: "cells", bits: 32, groups: [[{ kind: "integer", raw: "26", value: "26" }]] }, reason: "Cannot edit shared bytes" });
    expect(draft.status, draft.bodyText).toBe(409);
    const exact = await requestJson(server(), `${file}/versions/${appliedA.fileVersionId}/content`);
    expect(exact.status).toBe(200); expect(exact.bodyText).toBe(shared);
    await expect(api.query("update public.project_parameter_files set enabled=false where id=$1", [appliedA.fileId])).rejects.toThrow(/read-only|immutable/);
    await expect(api.query("update public.project_parameter_file_versions set checksum='changed' where id=$1", [appliedA.fileVersionId])).rejects.toThrow(/read-only|immutable|provenance/);
  });

  it("keeps private included-file overrides after newly added shared defaults",async()=>{
    const projectId="shared-private-include",rootSource='/dts-v1/;\n/include/ "private.dtsi"\n/ { compatible = "test,board"; model = "Private include"; };';
    const privateSource='/ { charger { compatible = "acme,power"; iin_max = <36>; }; };';
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,$1,$1,'initialized')",[projectId,ORG]);
    const configSetId=sets[projectId]=(await createConfigSet(db,admin,{projectId,name:"Private included source"})).id;
    const members=[];
    for(const [fileName,content,role,sortOrder] of [["included-board.dts",rootSource,"base",0],["private.dtsi",privateSource,"misc",1]] as const) {
      const file=await uploadProjectParameterFile(db,storage,admin,{projectId,fileName,bytes:Buffer.from(content)});
      await addConfigSetFile(db,admin,{configSetId,fileId:file.file.id,role,sortOrder});
      members.push({fileId:file.file.id,fileVersionId:file.version.id,fileName,content,role,sortOrder});
    }
    const revision=await ingestConfigRevision(db,{organizationId:ORG,projectId,configSetId,entryFile:"included-board.dts",includeSearchPaths:["."],overlayOrder:[],members},admin);
    const snapshot=await loadPublishedCatalog(getRootPostgresPool(db)!);
    if(!snapshot)throw new Error("Missing Catalog fixture");
    await db.transaction(tx=>syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx),snapshot,{organizationId:ORG,projectId,configSetId,configRevisionId:revision.id}));
    const input={sharedReference:{resourceId,versionId},role:"misc",sortOrder:2};
    const preview=await post<Preview>(`${path(projectId)}/preview`,input);
    expect(preview.status,preview.bodyText).toBe(200);
    const applied=await post<Applied>(`${path(projectId)}/apply`,{...input,proofToken:preview.body.item.proofToken,reason:"Retain private included override",clientMutationId:"private-include-composition"});
    expect(applied.status,applied.bodyText).toBe(200);
    expect((await listCatalogBindingRowsForProject(api,admin,{projectId})).map(row=>row.rawValue).sort()).toEqual(["<25>","<36>"]);
  });

  it("refuses whole-root removal of a fixed include and still permits private project overrides", async () => {
    const membersPath = `/api/v1/projects/${A}/config-sets/${sets[A]}/files`;
    const members = await requestJson<{ items: Array<{ fileId: string; role: string; currentVersionId: string }> }>(server(), membersPath);
    const root = members.body.items.find(member => member.role === "base")!;
    const rootPath = `/api/v1/projects/${A}/parameter-files/${root.fileId}`;
    const before = await requestJson(server(), `${rootPath}/versions/${root.currentVersionId}/content`);
    const values = await listCatalogBindingRowsForProject(api, admin, { projectId: A });
    async function edit(content: string, mutation: string) {
      const candidate = await post<{ item: { id: string } }>(`/api/v1/projects/${A}/parameter-file-candidates`, {
        fileId: root.fileId, fileName: "board.dts", contentBase64: Buffer.from(content).toString("base64"), intent: "source_revision",
        expectedCurrentVersionId: root.currentVersionId, expectedConfigRevisionId: appliedA.configRevisionId, clientMutationId: mutation });
      expect(candidate.status, candidate.bodyText).toBe(201);
      const preview = await requestJson<{ item: SourceRevisionPreview }>(server(), `/api/v1/projects/${A}/parameter-file-candidates/${candidate.body.item.id}/source-preview`);
      expect(preview.status, preview.bodyText).toBe(200);
      return post<Applied>(`/api/v1/projects/${A}/parameter-file-candidates/${candidate.body.item.id}/source-apply`, {
        expectedCurrentVersionId: root.currentVersionId, expectedProofToken: preview.body.item.proofToken, reason: "Review root source", clientMutationId: `${mutation}-apply` });
    }
    const removed = await edit(source, "remove-shared-include");
    expect(removed.status, removed.bodyText).toBe(409);
    expect((await requestJson(server(), membersPath)).body).toEqual(members.body);
    expect(await listCatalogBindingRowsForProject(api, admin, { projectId: A })).toEqual(values);
    const privateEdit = await edit(before.bodyText.replace("<36>", "<37>").replace('model = "shared reference";', '/delete-property/ model;'), "private-root-override");
    expect(privateEdit.status, privateEdit.bodyText).toBe(200);
    const historical = await requestJson<{ item: TopologyTree }>(server(), `/api/v2/projects/${A}/config-sets/${sets[A]}/revisions/${appliedA.configRevisionId}/topology`);
    if (historical.body.item.view !== "effective") throw new Error("Expected historical effective topology");
    const oldSource = historical.body.item.nodes.find(node => node.locator === "/charger")!.effects.filter(effect => effect.propertyName === "iin_max").at(-1)!;
    expect(oldSource.rawText).toBe("<36>");
    expect(oldSource.source?.fileVersionId).toBe(root.currentVersionId);
    const original = await requestJson(server(), `${rootPath}/versions/${oldSource.source!.fileVersionId}/content`);
    expect(original.bodyText).toBe(before.bodyText);
    const current = await requestJson<{ item: TopologyTree }>(server(), `/api/v2/projects/${A}/config-sets/${sets[A]}/revisions/current/topology`);
    expect(current.status, current.bodyText).toBe(200);
    if (current.body.item.view !== "effective") throw new Error("Expected current effective topology");
    appliedA.configRevisionId = current.body.item.revisionId;
    const deletion = current.body.item.nodes.find(node => node.locator === "/")!.effects.find(effect => effect.propertyName === "model")!;
    expect(deletion.effectKind).toBe("delete");
    expect(deletion.source).toMatchObject({ fileId: root.fileId });
    expect(deletion.source?.startLine).toBeUndefined();
    expect((await listCatalogBindingRowsForProject(api, admin, { projectId: A })).map(value => value.rawValue).sort()).toEqual(["<25>", "<37>"]);
    expect((await listCatalogBindingRowsForProject(api, admin, { projectId: B })).map(value => value.rawValue).sort()).toEqual(["<25>", "<36>"]);
  });

  it("retains fixed project versions when the author publishes a successor", async () => {
    const draft = await post<{ item: { revision: number } }>(`/api/v2/shared-dtsi/${resourceId}/draft`, { baseVersionId: versionId });
    expect(draft.status, draft.bodyText).toBe(201);
    const saved = await requestJson<{ item: { revision: number } }>(server(), `/api/v2/shared-dtsi/${resourceId}/draft`, { method: "PUT", body: JSON.stringify({
      expectedRevision: draft.body.item.revision, name: "Charger limits", sourceName: "limits.dtsi", content: shared.replace("<25>", "<26>"), changeDescription: "Next limits" }) });
    const preview = await post<{ item: { id: string } }>(`/api/v2/shared-dtsi/${resourceId}/publication-preview`, { expectedRevision: saved.body.item.revision });
    const successor = await post<{ item: { id: string } }>(`/api/v2/shared-dtsi/${resourceId}/publications`, { previewId: preview.body.item.id, idempotencyKey: "shared-ref-v2" });
    expect(successor.status, successor.bodyText).toBe(201); expect(successor.body.item.id).not.toBe(versionId);
    for (const project of [A, B]) {
      const files = await requestJson<{ items: Array<{ sharedReference?: { versionId: string } }> }>(server(), `/api/v1/projects/${project}/config-sets/${sets[project]}/files`);
      expect(files.body.items.find(file => file.sharedReference)?.sharedReference?.versionId).toBe(versionId);
      expect((await listCatalogBindingRowsForProject(api, admin, { projectId: project })).some(value => value.rawValue === "<25>")).toBe(true);
    }
  });

  it("does not disclose or reference another Organization's published source", async () => {
    const foreign = makeTestAuthContext({ organizationId: "foreign-shared-org", userId: "foreign-shared-admin", roles: [{ roleId: "admin", projectId: null }] });
    await db.query("insert into organizations(id,name) values ('foreign-shared-org','Foreign shared source')");
    await db.query("insert into users(id,organization_id,name,title,is_active) values ('foreign-shared-admin','foreign-shared-org','Foreign admin','Admin',true)");
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('foreign-shared-role','foreign-shared-admin','foreign-shared-org','admin')");
    const draft = await post<{ item: { resourceId: string; revision: number } }>("/api/v2/shared-dtsi", { name: "Secret foreign resource", sourceName: "secret.dtsi", content: '/ { secret { }; };', changeDescription: "Foreign source" }, foreign);
    expect(draft.status, draft.bodyText).toBe(201);
    const id = draft.body.item.resourceId;
    const preview = await post<{ item: { id: string } }>(`/api/v2/shared-dtsi/${id}/publication-preview`, { expectedRevision: draft.body.item.revision }, foreign);
    const version = await post<{ item: { id: string } }>(`/api/v2/shared-dtsi/${id}/publications`, { previewId: preview.body.item.id, idempotencyKey: "foreign-v1" }, foreign);
    const refused = await post(`${path(A)}/preview`, { sharedReference: { resourceId: id, versionId: version.body.item.id }, role: "misc", sortOrder: 5 });
    expect(refused.status, refused.bodyText).toBe(404); expect(refused.bodyText).not.toContain("Secret foreign resource");
    const listed = await requestJson(server(), "/api/v2/shared-dtsi");
    expect(listed.bodyText).not.toContain(id);
  });

  it("requires current configuration administration authority", async () => {
    const input = { sharedReference: { resourceId, versionId }, role: "misc", sortOrder: 3 };
    expect((await post(`${path(A)}/preview`, input, editor)).status).toBe(403);
    expect((await post(`${path(A)}/apply`, { ...input, proofToken: "a".repeat(64), reason: "No admin authority", clientMutationId: "editor-cannot-reference" }, editor)).status).toBe(403);
  });

  it("keeps source immutability and composition fencing when there are zero managed Bindings", async () => {
    const projectId = "shared-zero-bindings", rootSource = '/dts-v1/; / { model = "Zero managed values"; compatible = "test,board"; };';
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,$1,$1,'initialized')", [projectId, ORG]);
    const set = await createConfigSet(db, admin, { projectId, name: "Zero managed values" });
    const root = await uploadProjectParameterFile(db, storage, admin, { projectId, fileName: "zero.dts", bytes: Buffer.from(rootSource) });
    await addConfigSetFile(db, admin, { configSetId: set.id, fileId: root.file.id, role: "base", sortOrder: 0 });
    await ingestConfigRevision(db, { organizationId: ORG, projectId, configSetId: set.id, entryFile: "zero.dts", includeSearchPaths: ["."], overlayOrder: [],
      members: [{ fileId: root.file.id, fileVersionId: root.version.id, fileName: "zero.dts", role: "base", sortOrder: 0, content: rootSource }] }, admin);
    const draft = await post<{ item: { resourceId: string; revision: number } }>("/api/v2/shared-dtsi", { name: "Zero managed shared", sourceName: "zero-shared.dtsi", content: '/ { shared_status { status = "okay"; }; };', changeDescription: "No managed properties" });
    const resource = draft.body.item.resourceId;
    const publication = await post<{ item: { id: string } }>(`/api/v2/shared-dtsi/${resource}/publication-preview`, { expectedRevision: draft.body.item.revision });
    const version = await post<{ item: { id: string } }>(`/api/v2/shared-dtsi/${resource}/publications`, { previewId: publication.body.item.id, idempotencyKey: "zero-managed-shared" });
    const endpoint = `/api/v1/projects/${projectId}/config-sets/${set.id}/member-addition`;
    const input = { sharedReference: { resourceId: resource, versionId: version.body.item.id }, role: "misc", sortOrder: 1 };
    const preview = await post<Preview>(`${endpoint}/preview`, input);
    expect(preview.status, preview.bodyText).toBe(200);
    const response = await post<Applied>(`${endpoint}/apply`, { ...input, proofToken: preview.body.item.proofToken, reason: "Fixed zero-definition context", clientMutationId: "zero-context" });
    expect(response.status, response.bodyText).toBe(200);
    expect(await listCatalogBindingRowsForProject(api, admin, { projectId })).toEqual([]);
    const fileId = response.body.item.fileId;
    await expect(api.query("update public.project_parameter_files set current_version_id=null where id=$1", [fileId])).rejects.toThrow("Shared reference source is read-only");
    await expect(api.query(`insert into public.project_parameter_file_versions(id,file_id,version_number,storage_key,checksum,size_bytes,origin)
      values ('zero-bypass',$1,2,'untrusted','invalid',1,'upload')`, [fileId])).rejects.toThrow("Shared reference source is read-only");
    await expect(api.query("update public.project_parameter_file_versions set file_id=$1 where id=$2", [fileId, root.version.id])).rejects.toThrow("Shared reference source is read-only");
    const legacyRoot = await post(`/api/v1/projects/${projectId}/parameter-files/${root.file.id}/versions`, { contentBase64: Buffer.from(rootSource).toString("base64") });
    expect(legacyRoot.status, legacyRoot.bodyText).toBe(409);
    const deletion = await previewProjectDeletion(api, ORG, projectId, ADMIN);
    expect(deletion.inventory.find(row => row.key === "shared-source-references")?.count).toBe(1);
    const deleted = await purgeProject(api, createUserInvocation(admin), projectId, deletion.stateDigest, "shared-zero-cleanup", storage);
    expect(deleted).toMatchObject({ database: "deleted", objects: "complete" });
    const retained = await requestJson(server(), `/api/v2/shared-dtsi/${resource}/versions/${version.body.item.id}`);
    expect(retained.status, retained.bodyText).toBe(200);
  });

  it("rejects stale intent, rolls back failed application and permits exact retry", async () => {
    const draft = await post<{ item: { resourceId: string; revision: number } }>("/api/v2/shared-dtsi", { name: "Extra context", sourceName: "extra.dtsi", content: '/ { extra { status = "okay"; }; };', changeDescription: "Initial extra context" });
    const id = draft.body.item.resourceId;
    const publication = await post<{ item: { id: string } }>(`/api/v2/shared-dtsi/${id}/publication-preview`, { expectedRevision: draft.body.item.revision });
    const published = await post<{ item: { id: string } }>(`/api/v2/shared-dtsi/${id}/publications`, { previewId: publication.body.item.id, idempotencyKey: "shared-ref-extra" });
    const input = { sharedReference: { resourceId: id, versionId: published.body.item.id }, role: "misc", sortOrder: 3 };
    const preview = await post<Preview>(`${path(B)}/preview`, input);
    expect(preview.status, preview.bodyText).toBe(200);
    const apply = { ...input, proofToken: preview.body.item.proofToken, reason: "Add exact extra context", clientMutationId: "extra-context" };
    await db.query("delete from user_role_bindings where id='shared-ref-role'");
    try { expect((await post(`${path(B)}/apply`, apply)).status).toBe(403); }
    finally { await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('shared-ref-role',$1,$2,'admin')", [ADMIN, ORG]); }
    const readFiles = () => requestJson(server(), `/api/v1/projects/${B}/config-sets/${sets[B]}/files`);
    const files = (await readFiles()).body, values = await listCatalogBindingRowsForProject(api, admin, { projectId: B }), objects = await readdir(directory, { recursive: true });
    expect((await post(`${path(B)}/apply`, { ...apply, proofToken: "0".repeat(64) })).status).toBe(409);
    const written = new Set<string>();
    const corruptStore: ObjectStore = { ...storage, async put(input) { const stored = await storage.put(input); written.add(stored.storageKey); return stored; },
      async getBounded(key, maximum) { return written.has(key) ? Buffer.from("corrupt source") : storage.getBounded!(key, maximum); } };
    const corrupt = await post(`${path(B)}/apply`, apply, admin, corruptStore);
    expect(corrupt.status, corrupt.bodyText).toBe(409);
    expect((await readFiles()).body).toEqual(files); expect(await readdir(directory, { recursive: true })).toEqual(objects);
    await db.query(`create function public.refuse_shared_ref_audit() returns trigger language plpgsql as $$begin
      if new.metadata->>'operation'='add_member' then raise exception 'Synthetic shared reference audit failure'; end if; return new; end$$;
      create trigger refuse_shared_ref_audit before insert on public.audit_events for each row execute function public.refuse_shared_ref_audit()`);
    try { expect((await post(`${path(B)}/apply`, apply)).status).toBe(500); }
    finally { await db.query("drop trigger refuse_shared_ref_audit on public.audit_events; drop function public.refuse_shared_ref_audit()"); }
    expect((await readFiles()).body).toEqual(files);
    expect(await listCatalogBindingRowsForProject(api, admin, { projectId: B })).toEqual(values);
    expect(await readdir(directory, { recursive: true })).toEqual(objects);
    const attempts = [apply, { ...apply, clientMutationId: "extra-context-concurrent" }];
    const concurrent = await Promise.all(attempts.map(attempt => post(`${path(B)}/apply`, attempt)));
    expect(concurrent.map(result => result.status).sort()).toEqual([200, 409]);
    const winner = concurrent.findIndex(result => result.status === 200);
    expect((await post(`${path(B)}/apply`, attempts[winner])).body).toEqual(concurrent[winner]!.body);
    expect((await post(`${path(B)}/apply`, { ...apply, clientMutationId: "stale-second-application" })).status).toBe(409);
  });
});
