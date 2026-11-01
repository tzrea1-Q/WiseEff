import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
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
import { captureConfigurationSourceState } from "../../testing/parameterCatalog/configurationSource";
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
import { createDtsToolchainRunner } from "./dtsToolchain";
import { insertFileVersion, insertProjectParameterFile, setCurrentVersion } from "./repository";
import { sharedDtsiProjectUsagesSchema } from "../contracts/dtoSchemas/sharedDtsi";

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
  const privateRoots: Record<string, { fileId: string; fileVersionId: string; configRevisionId: string }> = {};
  let resourceId: string, versionId: string, appliedA: Applied["item"], appliedB: Applied["item"];
  function server(auth = admin, sourceStore: ObjectStore = storage) {
    const router = createRouter();
    registerSharedDtsiRoutes(router, { db: api, objectStore: sourceStore, getCurrentAuthContext: () => auth });
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
      privateRoots[projectId] = { fileId: uploaded.file.id, fileVersionId: uploaded.version.id, configRevisionId: revision.id };
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

  it("lists authorized project configurations including those without shared references", async () => {
    const emptyProject = "overview-empty-project";
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'Overview empty','OVERVIEW-EMPTY','initialized')", [emptyProject, ORG]);
    await db.query("insert into organizations(id,name) values ('org-overview-other','Other overview')");
    await db.query("insert into users(id,organization_id,name,title,is_active) values ('overview-other-admin','org-overview-other','Other admin','Admin',true)");
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('overview-other-role','overview-other-admin','org-overview-other','admin')");
    await db.query("insert into projects(id,organization_id,name,code,status) values ('overview-other','org-overview-other','Overview other','OVERVIEW-OTHER','initialized')");
    const result = await requestJson<{items:Array<{projectId:string;configSetId:string|null;references:unknown[]}>;total:number;visibility:string}>(server(), "/api/v2/shared-dtsi/project-usages?q=Overview");
    expect(result.status, result.bodyText).toBe(200);
    expect(sharedDtsiProjectUsagesSchema.safeParse(result.body).success).toBe(true);
    expect(result.body).toMatchObject({total:1,visibility:"organization",items:[{projectId:emptyProject,configSetId:null,references:[]}]});
    expect(result.bodyText).not.toContain("overview-other");
    const other=makeTestAuthContext({organizationId:"org-overview-other",userId:"overview-other-admin"});
    const otherList=await requestJson<{items:{projectId:string}[];total:number}>(server(other),"/api/v2/shared-dtsi/project-usages?q=Overview");
    expect(otherList.body).toMatchObject({total:1,items:[{projectId:"overview-other"}]});
    expect(otherList.bodyText).not.toContain(emptyProject);
    const limited = await requestJson<{items:unknown[];total:number;visibility:string}>(server(editor), "/api/v2/shared-dtsi/project-usages?q=Overview");
    expect(limited.status, limited.bodyText).toBe(200);
    expect(limited.body).toMatchObject({total:0,visibility:"authorized-projects",items:[]});
    const first=await createConfigSet(db,admin,{projectId:emptyProject,name:"Empty first"});
    const second=await createConfigSet(db,admin,{projectId:emptyProject,name:"Empty second"});
    const page=await requestJson<{items:{projectId:string;configSetId:string;configurationReady:boolean;references:unknown[]}[];total:number}>(server(),"/api/v2/shared-dtsi/project-usages?q=OVERVIEW-EMPTY&status=unreferenced&limit=1");
    expect(page.status,page.bodyText).toBe(200);
    expect(page.body).toMatchObject({total:2,items:[{projectId:emptyProject,configSetId:first.id,configurationReady:false,references:[]}]});
    const later=await requestJson<{items:{configSetId:string}[];total:number}>(server(),"/api/v2/shared-dtsi/project-usages?q=OVERVIEW-EMPTY&status=unreferenced&limit=1&offset=1");
    expect(later.body).toMatchObject({total:2,items:[{configSetId:second.id}]});
    const referenced=await requestJson<{items:unknown[];total:number}>(server(),"/api/v2/shared-dtsi/project-usages?q=OVERVIEW-EMPTY&status=referenced");
    expect(referenced.body).toMatchObject({total:0,items:[]});
    expect((await requestJson(server(),"/api/v2/shared-dtsi/project-usages?status=invalid")).status).toBe(400);
  });

  it("stops new direct and transitive references while retaining exact existing closure during unrelated switches",async()=>{
    const A="lifecycle-project-a",B="lifecycle-project-b",localSets:Record<string,string>={};
    const path=(project:string)=>`/api/v1/projects/${project}/config-sets/${localSets[project]}/member-addition`;
    for(const projectId of [A,B]){
      await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,$1,$1,'initialized')",[projectId,ORG]);
      const configSetId=localSets[projectId]=(await createConfigSet(db,admin,{projectId,name:"Lifecycle reference"})).id;
      const content='/dts-v1/; / { model = "Lifecycle reference"; };';
      const uploaded=await uploadProjectParameterFile(db,storage,admin,{projectId,fileName:"board.dts",bytes:Buffer.from(content)});
      await addConfigSetFile(db,admin,{configSetId,fileId:uploaded.file.id,role:"base",sortOrder:0});
      await ingestConfigRevision(db,{organizationId:ORG,projectId,configSetId,entryFile:"board.dts",includeSearchPaths:["."],overlayOrder:[],
        members:[{fileId:uploaded.file.id,fileVersionId:uploaded.version.id,fileName:"board.dts",role:"base",sortOrder:0,content}]},admin);
    }
    const publish=async(name:string,content:string,dependencies:unknown[]=[])=>{
      const draft=await post<{item:{resourceId:string}}>("/api/v2/shared-dtsi",{name,sourceName:`${name}.dtsi`,content,dependencies,changeDescription:"Lifecycle reference evidence"});
      expect(draft.status,draft.bodyText).toBe(201);const id=draft.body.item.resourceId;
      const preview=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${id}/publication-preview`,{expectedRevision:1});expect(preview.status,preview.bodyText).toBe(201);
      const version=await post<{item:{resourceId:string;id:string}}>(`/api/v2/shared-dtsi/${id}/publications`,{previewId:preview.body.item.id,idempotencyKey:`lifecycle-${id}`});
      expect(version.status,version.bodyText).toBe(201);return version.body.item;
    };
    const leaf=await publish("life-leaf",'/ { life_leaf: life-leaf { status = "okay"; }; };');
    const wrapper=await publish("life-wrapper",'/include/ "life-leaf.dtsi"\n',[{resourceId:leaf.resourceId,versionId:leaf.id,mountPath:""}]);
    const other=await publish("life-other",'/ { life_other: life-other { status = "okay"; }; };');
    const clone=await post<{item:{members:{id:string;sourceName:string;content:string}[]}}>(`/api/v2/shared-dtsi/${other.resourceId}/draft`,{baseVersionId:other.id});expect(clone.status,clone.bodyText).toBe(201);
    const saved=await requestJson(server(),`/api/v2/shared-dtsi/${other.resourceId}/draft`,{method:"PUT",body:JSON.stringify({name:"life-other",members:clone.body.item.members.map(member=>({...member,content:member.content.replace("okay","disabled")})),expectedRevision:1,changeDescription:"Unrelated version"})});expect(saved.status,saved.bodyText).toBe(200);
    const otherPreview=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${other.resourceId}/publication-preview`,{expectedRevision:2});expect(otherPreview.status,otherPreview.bodyText).toBe(201);
    const otherNext=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${other.resourceId}/publications`,{previewId:otherPreview.body.item.id,idempotencyKey:"life-other-v2"});expect(otherNext.status,otherNext.bodyText).toBe(201);
    async function add(resource:{resourceId:string;id:string},key:string,replaceVersionId?:string){
      const input={sharedReference:{resourceId:resource.resourceId,versionId:resource.id,...(replaceVersionId?{replaceVersionId}:{})},role:"misc",sortOrder:10};
      const preview=await post<Preview>(`${path(A)}/preview`,input);expect(preview.status,preview.bodyText).toBe(200);
      const applied=await post<Applied>(`${path(A)}/apply`,{...input,proofToken:preview.body.item.proofToken,reason:"Retain fixed lifecycle closure",clientMutationId:key});expect(applied.status,applied.bodyText).toBe(200);
    }
    await add(other,"life-other-a");
    const wrapperDraft=await post<{item:{members:{id:string;sourceName:string;content:string}[];dependencies:unknown[]}}>(`/api/v2/shared-dtsi/${wrapper.resourceId}/draft`,{baseVersionId:wrapper.id});expect(wrapperDraft.status,wrapperDraft.bodyText).toBe(201);
    const wrapperSave=await requestJson(server(),`/api/v2/shared-dtsi/${wrapper.resourceId}/draft`,{method:"PUT",body:JSON.stringify({name:"life-wrapper",members:wrapperDraft.body.item.members,dependencies:wrapperDraft.body.item.dependencies,expectedRevision:1,changeDescription:"Frozen before dependency retirement"})});expect(wrapperSave.status,wrapperSave.bodyText).toBe(200);
    const frozenPublication=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${wrapper.resourceId}/publication-preview`,{expectedRevision:2});expect(frozenPublication.status,frozenPublication.bodyText).toBe(201);
    const staleInput={sharedReference:{resourceId:wrapper.resourceId,versionId:wrapper.id},role:"misc",sortOrder:10};
    const stalePreview=await post<Preview>(`${path(B)}/preview`,staleInput);expect(stalePreview.status,stalePreview.bodyText).toBe(200);
    // Hold the real reference application at its first object write, while its transaction owns admission.
    const pendingInput={sharedReference:{resourceId:wrapper.resourceId,versionId:wrapper.id},role:"misc",sortOrder:10};
    const pendingPreview=await post<Preview>(`${path(A)}/preview`,pendingInput);expect(pendingPreview.status,pendingPreview.bodyText).toBe(200);
    let started!:()=>void,release!:()=>void;
    const writing=new Promise<void>(resolve=>{started=resolve;}),held=new Promise<void>(resolve=>{release=resolve;});let first=true;
    const heldStore:ObjectStore={...storage,put:async input=>{if(first){first=false;started();await held;}return storage.put(input);}};
    const applying=post<Applied>(`${path(A)}/apply`,{...pendingInput,proofToken:pendingPreview.body.item.proofToken,reason:"Concurrent retirement retains committed reference",clientMutationId:"life-wrapper-a"},admin,heldStore);
    await writing;
    const retiring=post(`/api/v2/shared-dtsi/${leaf.resourceId}/lifecycle`,{state:"retired",expectedLifecycleRevision:1,idempotencyKey:"life-leaf-retire"});
    try{
      expect((await db.transaction(tx=>tx.query<{admitted:boolean}>("select pg_try_advisory_xact_lock(hashtextextended($1,0)) as admitted",[`shared-dtsi-references:${ORG}`]))).rows[0]!.admitted).toBe(false);
      expect((await requestJson<{item:{state:string}}>(server(),`/api/v2/shared-dtsi/${leaf.resourceId}/detail`)).body.item.state).toBe("active");
    }finally{release();}
    const [applied,retire]=await Promise.all([applying,retiring]);expect(applied.status,applied.bodyText).toBe(200);expect(retire.status,retire.bodyText).toBe(200);
    expect((await post(`${path(B)}/apply`,{...staleInput,proofToken:stalePreview.body.item.proofToken,reason:"Old reference intent",clientMutationId:"life-stale-reference"})).status).toBe(409);
    expect((await post(`/api/v2/shared-dtsi/${wrapper.resourceId}/publications`,{previewId:frozenPublication.body.item.id,idempotencyKey:"life-stale-publication"})).status).toBe(409);
    for(const resource of [leaf,wrapper]){
      const refused=await post(`${path(B)}/preview`,{sharedReference:{resourceId:resource.resourceId,versionId:resource.id},role:"misc",sortOrder:10});
      expect(refused.status,refused.bodyText).toBe(409);expect(refused.body).toMatchObject({error:{details:{reason:"shared-resource-retired"}}});
    }
    const composed=await post("/api/v2/shared-dtsi",{name:"New retired composition",sourceName:"new.dtsi",content:"/ {};",dependencies:[{resourceId:wrapper.resourceId,versionId:wrapper.id,mountPath:""}]});expect(composed.status,composed.bodyText).toBe(409);
    await add({...other,id:otherNext.body.item.id},"life-other-switch",other.id);
    expect((await requestJson(server(),`/api/v2/shared-dtsi/${leaf.resourceId}/versions/${leaf.id}`)).status).toBe(200);
    const usage=await requestJson<{items:{projectId:string;versionId:string;direct:boolean}[]}>(server(),`/api/v2/shared-dtsi/${leaf.resourceId}/usages`);
    expect(usage.body.items).toContainEqual(expect.objectContaining({projectId:A,versionId:leaf.id,direct:false}));
    const restored=await post(`/api/v2/shared-dtsi/${leaf.resourceId}/lifecycle`,{state:"active",expectedLifecycleRevision:2,idempotencyKey:"life-leaf-restore"});expect(restored.status,restored.bodyText).toBe(200);
    const eligible=await post<Preview>(`${path(B)}/preview`,staleInput);expect(eligible.status,eligible.bodyText).toBe(200);
    const newlyReferenced=await post<Applied>(`${path(B)}/apply`,{...staleInput,proofToken:eligible.body.item.proofToken,reason:"Restored original resource is eligible again",clientMutationId:"life-restored-b"});expect(newlyReferenced.status,newlyReferenced.bodyText).toBe(200);
  });

  it("creates an independent shared draft from a frozen private DTS root without rewriting the project or mixed JSON", async () => {
    const before = (await requestJson(server(), `/api/v1/projects/${B}/config-sets/${sets[B]}/files`)).body;
    const created = await post<{ item: { resourceId: string; revision: number; members: Array<{ sourceName: string; content: string }> } }>(
      `/api/v2/projects/${B}/config-sets/${sets[B]}/shared-dtsi`, { ...privateRoots[B], name: "Shared private board" });
    expect(created.status, created.bodyText).toBe(201);
    expect(created.body.item.members).toEqual([expect.objectContaining({ sourceName: "board.dts", content: source })]);
    const reopened = await requestJson(server(), `/api/v2/shared-dtsi/${created.body.item.resourceId}`);
    expect(reopened.body).toEqual(created.body);
    const edited=source.replace("<36>","<37>");
    const saved = await requestJson(server(), `/api/v2/shared-dtsi/${created.body.item.resourceId}/draft`, { method: "PUT",
      body: JSON.stringify({ name: "Shared private board", members: created.body.item.members.map(member=>({...member,content:edited})), changeDescription: "Publish private frozen source", expectedRevision: 1 }) });
    expect(saved.status, saved.bodyText).toBe(200);
    const preview = await post<{ item: { id: string } }>(`/api/v2/shared-dtsi/${created.body.item.resourceId}/publication-preview`, { expectedRevision: 2 });
    expect(preview.status, preview.bodyText).toBe(201);
    const published = await post<{ item: { id:string; members: Array<{ sourceName: string; content: string }>; manifest: { sourceEvidence: { digest: string } } } }>(
      `/api/v2/shared-dtsi/${created.body.item.resourceId}/publications`, { previewId: preview.body.item.id, idempotencyKey: "private-board-publication" });
    expect(published.status, published.bodyText).toBe(201);
    expect(published.body.item.members).toEqual([expect.objectContaining({ sourceName: "board.dts", content: edited })]);
    expect(published.body.item.manifest.sourceEvidence.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect((await createDtsToolchainRunner().validate({entryFile:"board.dts",includeSearchPaths:["."],overlayOrder:[],
      files:new Map(published.body.item.members.map(member=>[member.sourceName,{content:member.content}]))},{mode:"release"})).ok).toBe(true);
    expect(published.bodyText).not.toContain(privateRoots[B]!.configRevisionId);
    expect(published.bodyText).not.toContain(B);
    expect(published.bodyText).not.toContain(createHash("sha256").update(source).digest("hex"));
    const versionDraft=await post<{item:{members:{id:string;sourceName:string;content:string}[]}}>(`/api/v2/shared-dtsi/${created.body.item.resourceId}/draft`,{baseVersionId:published.body.item.id});
    expect(versionDraft.status,versionDraft.bodyText).toBe(201);
    const nextSave=await requestJson(server(),`/api/v2/shared-dtsi/${created.body.item.resourceId}/draft`,{method:"PUT",body:JSON.stringify({
      name:"Shared private board",members:versionDraft.body.item.members.map(member=>({...member,content:edited.replace("<37>","<38>")})),
      changeDescription:"Compare a derived private source revision",expectedRevision:1})});
    expect(nextSave.status,nextSave.bodyText).toBe(200);
    const nextPreview=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${created.body.item.resourceId}/publication-preview`,{expectedRevision:2});
    expect(nextPreview.status,nextPreview.bodyText).toBe(201);
    const nextVersion=await post<{item:{id:string;manifest:{sourceEvidence:{digest:string}}}}>(`/api/v2/shared-dtsi/${created.body.item.resourceId}/publications`,{
      previewId:nextPreview.body.item.id,idempotencyKey:"private-board-comparison-v2"});
    expect(nextVersion.status,nextVersion.bodyText).toBe(201);
    expect(nextVersion.body.item.manifest.sourceEvidence).toEqual(published.body.item.manifest.sourceEvidence);
    const comparison=await requestJson<{item:{semantic:{before:string;after:string}}}>(server(),`/api/v2/shared-dtsi/${created.body.item.resourceId}/comparison?before=${published.body.item.id}&after=${nextVersion.body.item.id}`);
    expect(comparison.status,comparison.bodyText).toBe(200);
    expect(comparison.body.item.semantic.before).toContain("<37>");expect(comparison.body.item.semantic.after).toContain("<38>");
    expect(comparison.bodyText).not.toContain(privateRoots[B]!.configRevisionId);expect(comparison.bodyText).not.toContain(B);
    expect((await requestJson(server(), `/api/v1/projects/${B}/config-sets/${sets[B]}/files`)).body).toEqual(before);
    expect((await requestJson(server(),`/api/v1/projects/${B}/parameter-files/${privateRoots[B]!.fileId}/versions/${privateRoots[B]!.fileVersionId}/content`)).bodyText).toBe(source);
    const json = jsonFiles[B]!;
    expect((await requestJson(server(), `/api/v1/projects/${B}/parameter-files/${json.fileId}/versions/${json.versionId}/content`)).bodyText).toBe('{"local":true}');
  });

  it("imports only the actual private include closure with original frozen paths and bytes",async()=>{
    const set = await createConfigSet(db,admin,{projectId:B,name:"Private closure"});
    const files = [
      {sourceName:"boards/private.dts",content:'/dts-v1/;\r\n/include/ "../parts/power.dtsi"\r\n/ { compatible = "test,board"; model = "Private closure"; };\r\n',role:"base" as const},
      {sourceName:"parts/power.dtsi",content:'/include/ "child.dtsi"\r\n/ { power { status = "okay"; }; };\r\n',role:"include" as const},
      {sourceName:"parts/child.dtsi",content:'/ { child { value = <42>; }; };\r\n',role:"include" as const},
      {sourceName:"unused.dtsi",content:'/ { unrelated { secret = "unselected private file"; }; };',role:"include" as const}
    ];
    const members = [];
    for(const [index,file] of files.entries()) {
      const uploaded = await uploadProjectParameterFile(db,storage,admin,{projectId:B,fileName:file.sourceName.split("/").at(-1)!,bytes:Buffer.from(file.content)});
      await addConfigSetFile(db,admin,{configSetId:set.id,fileId:uploaded.file.id,role:index===0?"base":"misc",sortOrder:index});
      members.push({...file,fileName:file.sourceName,fileId:uploaded.file.id,fileVersionId:uploaded.version.id,sortOrder:index});
    }
    const revision = await ingestConfigRevision(db,{organizationId:ORG,projectId:B,configSetId:set.id,entryFile:files[0]!.sourceName,
      includeSearchPaths:["."],overlayOrder:[],members},admin);
    const selected = members[0]!;
    const created = await post<{item:{resourceId:string;members:{sourceName:string;content:string}[]}}>(`/api/v2/projects/${B}/config-sets/${set.id}/shared-dtsi`,{
      name:"Frozen closure",configRevisionId:revision.id,fileId:selected.fileId,fileVersionId:selected.fileVersionId});
    expect(created.status,created.bodyText).toBe(201);
    expect(created.body.item.members.map(member=>member.sourceName).sort()).toEqual(["boards/private.dts","parts/child.dtsi","parts/power.dtsi"]);
    for(const member of created.body.item.members)expect(member.content).toBe(files.find(file=>file.sourceName===member.sourceName)!.content);
    expect(created.bodyText).not.toContain("unselected private file");
    const include = members[1]!;
    const fragment = await post<{item:{members:{sourceName:string}[]}}>(`/api/v2/projects/${B}/config-sets/${set.id}/shared-dtsi`,{
      name:"Private fragment",configRevisionId:revision.id,fileId:include.fileId,fileVersionId:include.fileVersionId});
    expect(fragment.status,fragment.bodyText).toBe(201);
    expect(fragment.body.item.members.map(member=>member.sourceName).sort()).toEqual(["parts/child.dtsi","parts/power.dtsi"]);
  });

  it("refuses stale authorization, cross-project pins and unreadable source objects without creating resources",async()=>{
    const resourceList = async()=>(await requestJson(server(),"/api/v2/shared-dtsi?limit=100")).body;
    const before = await resourceList();
    const target = `/api/v2/projects/${B}/config-sets/${sets[B]}/shared-dtsi`;
    const body = {...privateRoots[B],name:"Must not appear"};
    expect((await post(target,body,editor)).status).toBe(403);
    expect((await post("/api/v2/shared-dtsi",{name:"Forged provenance",sourceName:"fake.dts",content:source,
      sourceEvidence:{digest:`sha256:${"0".repeat(64)}`}})).status).toBe(400);
    const wrong = await post(target,{...body,...privateRoots[A]});
    expect(wrong.status,wrong.bodyText).toBe(409);
    expect(wrong.bodyText).not.toContain("Shared reference");
    const unreadable:ObjectStore={...storage,async getBounded(){throw new Error("Object unavailable");}};
    expect((await post(target,body,admin,unreadable)).status).toBe(409);
    await db.query("delete from user_role_bindings where id='shared-ref-role'");
    try { expect((await post(target,body)).status).toBe(403); }
    finally {await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('shared-ref-role',$1,$2,'admin')",[ADMIN,ORG]);}
    expect(await resourceList()).toEqual(before);
  });

  it("keeps missing or cyclic source selections intact and rolls back the new draft when private provenance auditing fails",async()=>{
    const before=(await requestJson(server(),"/api/v2/shared-dtsi?limit=100")).body;
    for(const cycle of [false,true]) {
      const set=await createConfigSet(db,admin,{projectId:B,name:cycle?"Cycle import":"Missing import"});
      const fileName=cycle?"cycle.dts":"missing.dts";
      const content=`/dts-v1/;\n/include/ "${cycle?fileName:"missing.dtsi"}"\n/ {};`;
      const file=await uploadProjectParameterFile(db,storage,admin,{projectId:B,fileName,bytes:Buffer.from(content)});
      await addConfigSetFile(db,admin,{configSetId:set.id,fileId:file.file.id,role:"base",sortOrder:0});
      const revision=await ingestConfigRevision(db,{organizationId:ORG,projectId:B,configSetId:set.id,entryFile:fileName,includeSearchPaths:["."],overlayOrder:[],
        members:[{fileId:file.file.id,fileVersionId:file.version.id,fileName,content,role:"base",sortOrder:0}]},admin);
      const result=await post(`/api/v2/projects/${B}/config-sets/${set.id}/shared-dtsi`,{name:"Must not publish incomplete source",
        configRevisionId:revision.id,fileId:file.file.id,fileVersionId:file.version.id});
      expect(result.status,result.bodyText).toBe(400);
      expect(result.bodyText).toContain(cycle?"include-cycle":"include-missing");
      expect((await requestJson(server(),`/api/v1/projects/${B}/parameter-files/${file.file.id}/versions/${file.version.id}/content`)).bodyText).toBe(content);
    }
    await db.query(`create function public.reject_private_source_audit() returns trigger language plpgsql as $$begin
      if new.kind='shared-dtsi-project-source' then raise exception 'Private proof audit unavailable'; end if; return new; end$$;
      create trigger reject_private_source_audit before insert on public.audit_events for each row execute function public.reject_private_source_audit()`);
    try {
      const failed=await post(`/api/v2/projects/${B}/config-sets/${sets[B]}/shared-dtsi`,{...privateRoots[B],name:"Must roll back source copy"});
      expect(failed.status,failed.bodyText).toBe(500);
    } finally {await db.query("drop trigger reject_private_source_audit on public.audit_events; drop function public.reject_private_source_audit()");}
    expect((await requestJson(server(),"/api/v2/shared-dtsi?limit=100")).body).toEqual(before);
  });

  it("preserves frozen CPP settings, original headers and inactive declared dependencies when promoting a private root",async()=>{
    const set=await createConfigSet(db,admin,{projectId:B,name:"Private CPP sources"});
    const files=[
      {sourceName:"boards/original.dts",content:'\uFEFF#include <defs.h>\r\n#if 0\r\n#include "../headers/inactive.h"\r\n#endif\r\n/dts-v1/;\r\n/ { compatible = "test,board"; model = "Frozen CPP"; value = <(BASE + OFFSET)>; };\r\n'},
      {sourceName:"headers/defs.h",content:'\uFEFF#define BASE 37\r\n'},
      {sourceName:"headers/inactive.h",content:'#define INACTIVE 9\r\n'},
      {sourceName:"headers/unselected.h",content:'#define UNSELECTED_PRIVATE 7\r\n'}
    ];
    const members=[];
    for(const [index,file] of files.entries()) {
      const stored=await storage.put({organizationId:ORG,fileName:`fixture-${randomUUID()}`,contentType:"text/plain",bytes:Buffer.from(file.content)});
      const parameter=await insertProjectParameterFile(db,{id:randomUUID(),organizationId:ORG,projectId:B,fileName:file.sourceName.split("/").at(-1)!,format:"dts"});
      const version=await insertFileVersion(db,{id:randomUUID(),fileId:parameter.id,versionNumber:1,storageKey:stored.storageKey,checksum:stored.checksumSha256,
        sizeBytes:Buffer.byteLength(file.content),origin:"upload",createdByUserId:ADMIN});
      await setCurrentVersion(db,{fileId:parameter.id,versionId:version.id});
      await addConfigSetFile(db,admin,{configSetId:set.id,fileId:parameter.id,role:index===0?"base":"misc",sortOrder:index});
      members.push({...file,fileName:file.sourceName,fileId:parameter.id,fileVersionId:version.id,role:index===0?"base" as const:"include" as const,sortOrder:index});
    }
    const buildInputs={includeSearchPaths:["headers"],defines:{OFFSET:"5"}};
    const revision=await ingestConfigRevision(db,{organizationId:ORG,projectId:B,configSetId:set.id,entryFile:files[0]!.sourceName,
      ...buildInputs,overlayOrder:[],members},admin);
    expect(revision.status).toBe("resolved");
    const selected=members[0]!;
    const imported=await post<{item:{resourceId:string;members:{sourceName:string;content:string}[];buildInputs:typeof buildInputs}}>(`/api/v2/projects/${B}/config-sets/${set.id}/shared-dtsi`,{
      name:"Frozen private CPP",configRevisionId:revision.id,fileId:selected.fileId,fileVersionId:selected.fileVersionId});
    expect(imported.status,imported.bodyText).toBe(201);
    expect(imported.body.item.buildInputs).toEqual(buildInputs);
    expect(imported.body.item.members.map(member=>member.sourceName).sort()).toEqual(["boards/original.dts","headers/defs.h","headers/inactive.h"]);
    for(const member of imported.body.item.members)expect(member.content).toBe(files.find(file=>file.sourceName===member.sourceName)!.content);
    expect(imported.bodyText).not.toContain("UNSELECTED_PRIVATE");
    const saved=await requestJson(server(),`/api/v2/shared-dtsi/${imported.body.item.resourceId}/draft`,{method:"PUT",body:JSON.stringify({
      name:"Frozen private CPP",members:imported.body.item.members,buildInputs,changeDescription:"Preserve all original CPP inputs",expectedRevision:1})});
    expect(saved.status,saved.bodyText).toBe(200);
    const preview=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${imported.body.item.resourceId}/publication-preview`,{expectedRevision:2});
    expect(preview.status,preview.bodyText).toBe(201);
    const published=await post<{item:{members:{sourceName:string;content:string}[]}}>(`/api/v2/shared-dtsi/${imported.body.item.resourceId}/publications`,{
      previewId:preview.body.item.id,idempotencyKey:"private-cpp-publication"});
    expect(published.status,published.bodyText).toBe(201);
    expect((await createDtsToolchainRunner().validate({entryFile:files[0]!.sourceName,...buildInputs,overlayOrder:[],
      files:new Map(published.body.item.members.map(member=>[member.sourceName,{content:member.content}]))},{mode:"release"})).ok).toBe(true);
  });

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

  it("retains reachable immutable shared pins instead of claiming their bytes as private source",async()=>{
    const files = await requestJson<{items:{fileId:string;fileName:string;currentVersionId:string}[]}>(server(),`/api/v1/projects/${A}/config-sets/${sets[A]}/files`);
    const root = files.body.items.find(file=>file.fileName==="board.dts")!;
    const created = await post<{item:{resourceId:string;members:{sourceName:string}[];dependencies:unknown[]}}>(`/api/v2/projects/${A}/config-sets/${sets[A]}/shared-dtsi`,{
      name:"Private source retaining shared ancestry",configRevisionId:appliedA.configRevisionId,fileId:root.fileId,fileVersionId:root.currentVersionId});
    expect(created.status,created.bodyText).toBe(201);
    expect(created.body.item.members.map(member=>member.sourceName)).toEqual(["board.dts"]);
    expect(created.body.item.dependencies).toEqual([{resourceId,versionId,mountPath:""}]);
    const cannotCopy = await post(`/api/v2/projects/${A}/config-sets/${sets[A]}/shared-dtsi`,{
      name:"Do not claim a shared member",configRevisionId:appliedA.configRevisionId,fileId:appliedA.fileId,fileVersionId:appliedA.fileVersionId});
    expect(cannotCopy.status,cannotCopy.bodyText).toBe(400);
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
     const compositionFiles=await requestJson<{items:{fileId:string;currentVersionId:string}[]}>(server(),`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`);
     const promoted=await post<{item:{resourceId:string;members:{id:string;sourceName:string;content:string}[];buildInputs:unknown;dependencies:unknown[]}}>(
       `/api/v2/projects/${projectId}/config-sets/${configSetId}/shared-dtsi`,{name:"Private root with owned CPP dependency",configRevisionId:applied.body.item.configRevisionId,
         fileId:root.file.id,fileVersionId:compositionFiles.body.items.find(file=>file.fileId===root.file.id)!.currentVersionId});
     expect(promoted.status,promoted.bodyText).toBe(201);
     expect(promoted.body.item.buildInputs).toEqual({includeSearchPaths:["."],defines:{}});
     expect(promoted.body.item.dependencies).toEqual([{resourceId:fixed.resourceId,versionId:fixed.id,mountPath:"vendor/power"}]);
     expect(promoted.body.item.members.map(member=>member.sourceName)).toEqual(["cpp-board.dts"]);
     const savedPromotion=await requestJson(server(),`/api/v2/shared-dtsi/${promoted.body.item.resourceId}/draft`,{method:"PUT",body:JSON.stringify({
       name:"Private root with owned CPP dependency",members:promoted.body.item.members,dependencies:promoted.body.item.dependencies,
       buildInputs:promoted.body.item.buildInputs,changeDescription:"Preserve each original build setting owner",expectedRevision:1})});
     expect(savedPromotion.status,savedPromotion.bodyText).toBe(200);
     const promotionPreview=await post<{item:{id:string;manifest:{buildInputs:unknown}}}>(`/api/v2/shared-dtsi/${promoted.body.item.resourceId}/publication-preview`,{expectedRevision:2});
     expect(promotionPreview.status,promotionPreview.bodyText).toBe(201);
     expect(promotionPreview.body.item.manifest.buildInputs).toMatchObject({includeSearchPaths:["."],preprocessing:{defines:{FLAG:"1"}}});
     expect(promotionPreview.body.item.manifest.buildInputs).not.toHaveProperty("defines");
     const promotedVersion=await post<{item:{members:{sourceName:string;content:string}[];manifest:{dependencies:unknown[];buildInputs:unknown}}}>(
       `/api/v2/shared-dtsi/${promoted.body.item.resourceId}/publications`,{previewId:promotionPreview.body.item.id,idempotencyKey:"private-cpp-owned-inputs-publication"});
     expect(promotedVersion.status,promotedVersion.bodyText).toBe(201);
     expect(promotedVersion.body.item.members).toEqual(promoted.body.item.members.map(({id:_id,...member})=>expect.objectContaining(member)));
     expect(promotedVersion.body.item.manifest.dependencies).toEqual(promoted.body.item.dependencies);
     expect(promotedVersion.body.item.manifest.buildInputs).not.toHaveProperty("defines");
     expect((await listCatalogBindingRowsForProject(api,admin,{projectId})).map(row=>row.rawValue)).toEqual(["<8>"]);
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
    const overview=await requestJson<{items:{projectId:string;configSetId:string;configurationReady:boolean;references:{resourceId:string;versionId:string;direct:boolean;requiredBy:{resourceId:string}[]}[]}[];total:number}>(server(),"/api/v2/shared-dtsi/project-usages?q=Fixed%20leaf&status=referenced&limit=1");
    expect(overview.status,overview.bodyText).toBe(200);
    expect(sharedDtsiProjectUsagesSchema.safeParse(overview.body).success).toBe(true);
    expect(overview.body.total).toBe(2);
    expect(overview.body.items).toHaveLength(1);
    expect(overview.body.items[0]).toMatchObject({projectId:A,configSetId:sets[A],configurationReady:true});
    expect(overview.body.items[0]!.references).toEqual(expect.arrayContaining([
      expect.objectContaining({resourceId:root.resourceId,versionId:root.id,direct:true}),
      expect.objectContaining({resourceId:leaf.resourceId,versionId:leaf.id,direct:false,requiredBy:[expect.objectContaining({resourceId:root.resourceId})]})
    ]));
    const nextPage=await requestJson<{items:{projectId:string}[];total:number}>(server(),"/api/v2/shared-dtsi/project-usages?q=Fixed%20leaf&status=referenced&limit=1&offset=1");
    expect(nextPage.body).toMatchObject({total:2,items:[{projectId:B}]});
    const limitedOverview=await requestJson<{items:{projectId:string}[];total:number;visibility:string}>(server(editor),"/api/v2/shared-dtsi/project-usages?q=Fixed%20leaf");
    expect(limitedOverview.body).toMatchObject({total:1,visibility:"authorized-projects",items:[{projectId:A}]});
    expect(limitedOverview.bodyText).not.toContain(B);
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
    const afterPublication=await requestJson<{items:{references:{resourceId:string;versionId:string;upgradeAvailable:boolean}[]}[]}>(server(),"/api/v2/shared-dtsi/project-usages?q=Fixed%20leaf");
    expect(afterPublication.body.items[0]!.references).toContainEqual(expect.objectContaining({resourceId:leaf.resourceId,versionId:leaf.id,upgradeAvailable:true}));
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

  it("isolates identical shared logical paths in two configurations of one project",async()=>{
    const projectId="shared-same-project";
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,$1,$1,'initialized')",[projectId,ORG]);
    const publish=async(name:string,members:{sourceName:string;content:string}[],dependencies:unknown[]=[])=>{
      const draft=await post<{item:{resourceId:string}}>("/api/v2/shared-dtsi",{name,members,dependencies,changeDescription:"Independent configuration sources"});
      expect(draft.status,draft.bodyText).toBe(201);
      const preview=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${draft.body.item.resourceId}/publication-preview`,{expectedRevision:1});
      expect(preview.status,preview.bodyText).toBe(201);
      const version=await post<{item:{id:string;resourceId:string}}>(`/api/v2/shared-dtsi/${draft.body.item.resourceId}/publications`,{previewId:preview.body.item.id,idempotencyKey:draft.body.item.resourceId});
      expect(version.status,version.bodyText).toBe(201);return version.body.item;
    };
    const leafSource='/ { same_leaf: same-leaf { status = "okay"; }; };';
    const leaf=await publish("Same-project dependency",[{sourceName:"leaf.dtsi",content:leafSource}]);
    const mainSource='/include/ "parts/common.dtsi"\n/include/ "vendor/leaf.dtsi"\n';
    const commonSource='/ { common { status = "okay"; }; };';
    const shared=await publish("Same-project library",[{sourceName:"main.dtsi",content:mainSource},{sourceName:"parts/common.dtsi",content:commonSource}],
      [{resourceId:leaf.resourceId,versionId:leaf.id,mountPath:"vendor"}]);
    const sharedIds:string[][]=[];
    const exports:Array<{manifest:{members:{fileId:string;fileVersionId:string;fileName:string;sharedReference?:unknown}[]};files:{name:string;content:string}[]}>=[];
    const configIds:string[]=[];
    for(const name of ["first","second"]){
      const configSetId=(await createConfigSet(db,admin,{projectId,name})).id;configIds.push(configSetId);
      const rootName=`${name}-root.dts`,rootSource='/dts-v1/; / { model = "Independent configuration"; };';
      const root=await uploadProjectParameterFile(db,storage,admin,{projectId,fileName:rootName,bytes:Buffer.from(rootSource)});
      await addConfigSetFile(db,admin,{configSetId,fileId:root.file.id,role:"base",sortOrder:0});
      await ingestConfigRevision(db,{organizationId:ORG,projectId,configSetId,entryFile:rootName,includeSearchPaths:["."],overlayOrder:[],
        members:[{fileId:root.file.id,fileVersionId:root.version.id,fileName:rootName,role:"base",sortOrder:0,content:rootSource}]},admin);
      const path=`/api/v1/projects/${projectId}/config-sets/${configSetId}`;
      const body={sharedReference:{resourceId:shared.resourceId,versionId:shared.id},role:"misc",sortOrder:1};
      const preview=await post<Preview>(`${path}/member-addition/preview`,body);expect(preview.status,preview.bodyText).toBe(200);
      const applied=await post<Applied>(`${path}/member-addition/apply`,{...body,proofToken:preview.body.item.proofToken,reason:"Keep exact paths in each configuration",clientMutationId:name});
      expect(applied.status,applied.bodyText).toBe(200);
      const exported=await requestJson<(typeof exports)[number]>(server(),`${path}/export`);expect(exported.status,exported.bodyText).toBe(200);
      expect(exported.body.files).toEqual(expect.arrayContaining([{name:"main.dtsi",format:"dts",content:mainSource},{name:"parts/common.dtsi",format:"dts",content:commonSource},{name:"vendor/leaf.dtsi",format:"dts",content:leafSource}]));
      const sharedMembers=exported.body.manifest.members.filter(member=>member.sharedReference);
      expect(sharedMembers).toHaveLength(3);sharedIds.push(sharedMembers.map(member=>member.fileId));exports.push(exported.body);
      const files=await requestJson<{items:{fileId:string;fileName:string;sharedReference?:{readOnly:boolean}}[]}>(server(),`${path}/files`);
      expect(files.status,files.bodyText).toBe(200);
      expect(files.body.items.filter(member=>member.sharedReference).map(member=>member.fileName).sort()).toEqual(["main.dtsi","parts/common.dtsi","vendor/leaf.dtsi"]);
      expect(files.body.items.filter(member=>member.sharedReference).every(member=>member.sharedReference!.readOnly)).toBe(true);
      const duplicate=await post(`${path}/member-addition/preview`,body);expect(duplicate.status,duplicate.bodyText).toBe(409);
    }
    expect(sharedIds[0]!.every(id=>!sharedIds[1]!.includes(id))).toBe(true);
    const nextDraft=await post<{item:{revision:number;members:{id:string;sourceName:string;content:string}[]}}>(`/api/v2/shared-dtsi/${shared.resourceId}/draft`,{baseVersionId:shared.id});
    expect(nextDraft.status,nextDraft.bodyText).toBe(201);
    const saved=await requestJson(server(),`/api/v2/shared-dtsi/${shared.resourceId}/draft`,{method:"PUT",body:JSON.stringify({name:"Same-project library",members:nextDraft.body.item.members.map(member=>({...member,content:member.content.replace('status = "okay"','status = "disabled"')})),dependencies:[{resourceId:leaf.resourceId,versionId:leaf.id,mountPath:"vendor"}],expectedRevision:nextDraft.body.item.revision,changeDescription:"Switch one configuration only"})});
    expect(saved.status,saved.bodyText).toBe(200);
    const nextPreview=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${shared.resourceId}/publication-preview`,{expectedRevision:2});expect(nextPreview.status,nextPreview.bodyText).toBe(201);
    const next=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${shared.resourceId}/publications`,{previewId:nextPreview.body.item.id,idempotencyKey:"same-project-successor"});expect(next.status,next.bodyText).toBe(201);
    const secondPath=`/api/v1/projects/${projectId}/config-sets/${configIds[1]}`;
    const switching={sharedReference:{resourceId:shared.resourceId,versionId:next.body.item.id,replaceVersionId:shared.id},role:"misc",sortOrder:1};
    const switchPreview=await post<Preview>(`${secondPath}/member-addition/preview`,switching);expect(switchPreview.status,switchPreview.bodyText).toBe(200);
    const switched=await post<Applied>(`${secondPath}/member-addition/apply`,{...switching,proofToken:switchPreview.body.item.proofToken,reason:"Keep independent fixed versions",clientMutationId:"same-project-switch"});expect(switched.status,switched.bodyText).toBe(200);
    const overview=await requestJson<{items:{configSetId:string;references:{resourceId:string;versionId:string}[]}[];total:number}>(server(),"/api/v2/shared-dtsi/project-usages?q=shared-same-project");
    expect(overview.status,overview.bodyText).toBe(200);
    expect(overview.body.total).toBe(2);
    expect(overview.body.items.find(row=>row.configSetId===configIds[0])?.references).toContainEqual(expect.objectContaining({resourceId:shared.resourceId,versionId:shared.id}));
    expect(overview.body.items.find(row=>row.configSetId===configIds[1])?.references).toContainEqual(expect.objectContaining({resourceId:shared.resourceId,versionId:next.body.item.id}));
    const secondExport=await requestJson<(typeof exports)[number]>(server(),`${secondPath}/export`);expect(secondExport.status,secondExport.bodyText).toBe(200);
    expect(secondExport.body.files).toContainEqual({name:"parts/common.dtsi",format:"dts",content:commonSource.replace('"okay"','"disabled"')});
    const oldCommon=exports[1]!.manifest.members.find(member=>member.fileName==="parts/common.dtsi")!;
    const historical=await requestJson(server(),`/api/v1/projects/${projectId}/parameter-files/${oldCommon.fileId}/versions/${oldCommon.fileVersionId}/content`);
    expect(historical.status,historical.bodyText).toBe(200);expect(historical.bodyText).toBe(commonSource);
    const logical=await requestJson<{items:{id:string;fileName:string}[]}>(server(),`/api/v1/projects/${projectId}/parameter-files`);
    expect(logical.status,logical.bodyText).toBe(200);expect(logical.body.items.find(file=>file.id===oldCommon.fileId)?.fileName).toBe("parts/common.dtsi");
    const back={...switching,sharedReference:{resourceId:shared.resourceId,versionId:shared.id,replaceVersionId:next.body.item.id}};
    const backPreview=await post<Preview>(`${secondPath}/member-addition/preview`,back);expect(backPreview.status,backPreview.bodyText).toBe(200);
    const returned=await post<Applied>(`${secondPath}/member-addition/apply`,{...back,proofToken:backPreview.body.item.proofToken,reason:"Restore only this configuration's fixed version",clientMutationId:"same-project-switch-back"});expect(returned.status,returned.bodyText).toBe(200);
    expect((await requestJson<(typeof exports)[number]>(server(),`${secondPath}/export`)).body.files).toEqual(exports[1]!.files);
    const unchanged=await requestJson<(typeof exports)[number]>(server(),`/api/v1/projects/${projectId}/config-sets/${configIds[0]}/export`);
    expect(unchanged.body.files).toEqual(exports[0]!.files);
    expect(unchanged.body.manifest.members).toEqual(exports[0]!.manifest.members);
    const occupiedSet=(await createConfigSet(db,admin,{projectId,name:"Occupied physical namespace"})).id;
    const occupiedRoot='/dts-v1/; / { model = "Reserved identity"; };';
    const root=await uploadProjectParameterFile(db,storage,admin,{projectId,fileName:"occupied-root.dts",bytes:Buffer.from(occupiedRoot)});
    await addConfigSetFile(db,admin,{configSetId:occupiedSet,fileId:root.file.id,role:"base",sortOrder:0});
    await ingestConfigRevision(db,{organizationId:ORG,projectId,configSetId:occupiedSet,entryFile:"occupied-root.dts",includeSearchPaths:["."],overlayOrder:[],
      members:[{fileId:root.file.id,fileVersionId:root.version.id,fileName:"occupied-root.dts",role:"base",sortOrder:0,content:occupiedRoot}]},admin);
    const occupiedPath=`/api/v1/projects/${projectId}/config-sets/${occupiedSet}/member-addition`;
    const body={sharedReference:{resourceId:shared.resourceId,versionId:shared.id},role:"misc",sortOrder:1};
    const beforeOccupation=await post<Preview>(`${occupiedPath}/preview`,body);expect(beforeOccupation.status,beforeOccupation.bodyText).toBe(200);
    await uploadProjectParameterFile(db,storage,admin,{projectId,fileName:`initialization-${occupiedSet}-main.dtsi`,bytes:Buffer.from('/ { private {}; };')});
    const before=await captureConfigurationSourceState(db,{organizationId:ORG,projectId}),objects=await readdir(directory,{recursive:true});
    expect((await post(`${occupiedPath}/preview`,body)).status).toBe(409);
    const refused=await post(`${occupiedPath}/apply`,{...body,proofToken:beforeOccupation.body.item.proofToken,reason:"Preserve the private file identity",clientMutationId:"occupied-namespace"});
    expect(refused.status,refused.bodyText).toBe(409);expect(refused.body).toMatchObject({error:{code:"CONFLICT"}});
    expect(await captureConfigurationSourceState(db,{organizationId:ORG,projectId})).toEqual(before);
    expect(await readdir(directory,{recursive:true})).toEqual(objects);
  },120_000);

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
    const privateSource = before.bodyText.replace("<36>", "<37>").replace('model = "shared reference";', '/delete-property/ model;');
    const privateEdit = await edit(privateSource, "private-root-override");
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
    expect(deletion.source?.startLine).toBe(privateSource.slice(0, privateSource.indexOf("/delete-property/ model;")).split("\n").length);
    expect(deletion.rawText).toBe("/delete-property/ model;");
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
