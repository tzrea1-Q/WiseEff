import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDatabase, getRootPostgresPool, type Database } from "../../shared/database/client";
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
import { registerParameterTopologyRoutes } from "../parameter-topology/routes";
import { registerParameterRoutes } from "../parameters/routes";
import { registerSharedDtsiRoutes } from "../shared-dtsi/routes";
import { addConfigSetFile, createConfigSet } from "./configSetService";
import { registerParameterFileRoutes } from "./routes";
import { uploadProjectParameterFile } from "./service";
import type { ExportConfigSetResult } from "./exportService";
import { configSetPackageManifestName, type ConfigSetImportPreview, type ConfigSetImportResult } from "../contracts/dtoSchemas/configSetPackage";
import { captureConfigurationSourceState, installConfigurationSourceFixture } from "../../testing/parameterCatalog/configurationSource";
import { loadOwnedProjectValueSourcePin } from "../parameter-bindings/values";
import { createBaseline, type RestorePreviewResult } from "./baselineService";
import { evaluateReleaseReadiness } from "./releaseReadinessService";
import type { SourceRevisionPreview } from "./sourceRevisionService";
import { registerUserRoutes } from "../users/routes";

const ORG="org-package", ADMIN="user-package", SOURCE="package-source", TARGET="package-target", PRIVATE="package-private", FAILED="package-failed";
const auth=makeTestAuthContext({organizationId:ORG,userId:ADMIN,roles:[{roleId:"admin",projectId:null}]});
const foreign=makeTestAuthContext({organizationId:"org-package-foreign",userId:"user-package-foreign",roles:[{roleId:"admin",projectId:null}]});
const original='\uFEFF/dts-v1/;\r\n// preserve original project overrides\r\n/ { compatible = "test,board"; model = "Package"; charger: charger { compatible = "acme,power"; iin_max = <31>; status = "disabled"; }; };\r\n';
const json='\uFEFF{\r\n  "private": true, "nested": {"mode":"production"}\r\n}\r\n';
describe("complete configuration package through the actual API role",()=>{
  let lane:Awaited<ReturnType<typeof createEphemeralTestDatabase>>, db:ReturnType<typeof createPostgresDatabase>, api:ReturnType<typeof createPostgresDatabase>;
  let directory:string,storage:ReturnType<typeof createLocalObjectStore>,setId:string,resourceId:string,versionId:string,exported:ExportConfigSetResult;
  let archive:{name:string;contentBase64:string};
  const token=`package_${process.pid}`;
  function server(principal=auth,objects:ObjectStore=storage,runtime:Database=api) {const router=createRouter();
    const options={db:runtime,objectStore:objects,getCurrentAuthContext:()=>principal,refusalAuditSink:createTrustedRefusalAuditSink(db)};
    registerParameterFileRoutes(router,options);registerSharedDtsiRoutes(router,options);registerCatalogProjectValueConsumerRoutes(router,options);registerParameterRoutes(router,options);registerParameterTopologyRoutes(router,options);
    registerUserRoutes(router,options);
    return createHttpServer(router);}
  const post=<T,>(path:string,body:unknown,principal=auth,objects:ObjectStore=storage)=>requestJson<T>(server(principal,objects),path,{method:"POST",body:JSON.stringify(body)});
  const importPath=(projectId:string)=>`/api/v1/projects/${projectId}/config-set-import`;
  async function packageArchive(value:{manifest:unknown;files:ExportConfigSetResult["files"]}) {const zip=new JSZip();zip.file(configSetPackageManifestName,JSON.stringify(value.manifest));
    for(const file of value.files)zip.file(file.name,file.content,{createFolders:false});return {name:"complete-export.zip",contentBase64:await zip.generateAsync({type:"base64"})};}
  async function createEmptyProject(id:string,code:string) {
    const created=await post("/api/v1/parameters/admin/projects",{id,name:code,code});expect(created.status,created.bodyText).toBe(201);
    const draft=await requestJson(server(),`/api/v1/parameters/projects/${id}/initialization/draft`,{method:"PUT",body:JSON.stringify({projectName:code,projectCode:code,ownerUserId:ADMIN,sourceProjectIds:[],primarySourceProjectId:null,supplementSourceProjectIds:[],selectedModuleIds:[],selectedRisks:[],selectedSourceBindingIds:[],bindingSnapshots:[],emptyLibrary:true,notes:"Normal initialization before public source import"})});expect(draft.status,draft.bodyText).toBe(200);
    const submitted=await post<{item:{id:string}}>(`/api/v1/parameters/projects/${id}/initialization/submit`,{});expect(submitted.status,submitted.bodyText).toBe(201);
    const approved=await post(`/api/v1/parameters/admin/initialization-reviews/${submitted.body.item.id}/approve`,{});expect(approved.status,approved.bodyText).toBe(200);
  }
  beforeAll(async()=>{
    lane=await createEphemeralTestDatabase("config-package");db=createPostgresDatabase(lane.url);
    directory=await mkdtemp(join(tmpdir(),"wiseeff-package-"));storage=createLocalObjectStore(directory);
    await db.query("insert into organizations(id,name) values ($1,'Package'),($2,'Foreign package')",[ORG,foreign.organization.id]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Package admin','Admin',true)",[ADMIN,ORG]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('package-admin',$1,$2,'admin')",[ADMIN,ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Foreign admin','Admin',true)",[foreign.user.id,foreign.organization.id]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('package-foreign-admin',$1,$2,'admin')",[foreign.user.id,foreign.organization.id]);
    await db.query("insert into projects(id,organization_id,name,code,status) values ('package-foreign-project',$1,'Foreign','T16FOREIGN','initialized')",[foreign.organization.id]);
    for(const id of [SOURCE,PRIVATE,FAILED,"package-retired","package-roots-a","package-roots-b"])await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,$1,$1,'initialized')",[id,ORG]);
    await installDriverSourceFixture(db,auth,{subjectId:"csub_acme_power",compatible:"acme,power",businessName:"Package",driverName:"Power",idempotencyKey:"package-register",reason:"Package acceptance"});
    setId=(await createConfigSet(db,auth,{projectId:SOURCE,name:"Original complete configuration"})).id;
    const members=[];
    for(const [index,entry] of [{name:"boards/vendor/long-original-directory/board.dts",text:original,format:"dts"},{name:"private/settings.json",text:json,format:"json"}].entries()) {
      const file=await uploadProjectParameterFile(db,storage,auth,{projectId:SOURCE,fileName:entry.name.split("/").at(-1)!,bytes:Buffer.from(entry.text)});
      await addConfigSetFile(db,auth,{configSetId:setId,fileId:file.file.id,role:index===0?"base":"thermal",sortOrder:index});
      members.push({fileId:file.file.id,fileVersionId:file.version.id,fileName:entry.name,format:entry.format as "dts"|"json",role:index===0?"base" as const:"thermal" as const,sortOrder:index,content:entry.text});
    }
    const revision=await ingestConfigRevision(db,{organizationId:ORG,projectId:SOURCE,configSetId:setId,entryFile:members[0]!.fileName,includeSearchPaths:["."],overlayOrder:[],members},auth);
    const catalog=await loadPublishedCatalog(getRootPostgresPool(db)!);if(!catalog)throw new Error("Catalog fixture missing");
    await db.transaction(tx=>syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx),catalog,{organizationId:ORG,projectId:SOURCE,configSetId:setId,configRevisionId:revision.id}));
    api=createPostgresDatabase((await provisionPublicationRuntimeLogins(lane.url,{mode:"lab",runToken:token})).apiUrl);
    expect((await api.query("select rolsuper,rolinherit from pg_roles where rolname=current_user")).rows).toEqual([{rolsuper:false,rolinherit:false}]);
    const created=await post("/api/v1/parameters/admin/projects",{id:TARGET,name:"New reimport project",code:"T16NEW"});expect(created.status,created.bodyText).toBe(201);
    const uninitialized=await post(`${importPath(TARGET)}/preview`,{name:"Must await review",ownership:"reuse",archive:{name:"empty.zip",contentBase64:"UEsDBA=="}});
    expect(uninitialized.status,uninitialized.bodyText).toBe(409);expect(uninitialized.bodyText).toContain("初始化审核");
    const draft=await requestJson(server(),`/api/v1/parameters/projects/${TARGET}/initialization/draft`,{method:"PUT",body:JSON.stringify({
      projectName:"New reimport project",projectCode:"T16NEW",ownerUserId:ADMIN,sourceProjectIds:[],primarySourceProjectId:null,
      supplementSourceProjectIds:[],selectedModuleIds:[],selectedRisks:[],selectedSourceBindingIds:[],bindingSnapshots:[],emptyLibrary:true,notes:"Reimport original package after normal initialization approval"})});expect(draft.status,draft.bodyText).toBe(200);
    const submitted=await post<{item:{id:string}}>(`/api/v1/parameters/projects/${TARGET}/initialization/submit`,{});expect(submitted.status,submitted.bodyText).toBe(201);
    const approved=await post(`/api/v1/parameters/admin/initialization-reviews/${submitted.body.item.id}/approve`,{});expect(approved.status,approved.bodyText).toBe(200);
  },120_000);
  afterAll(async()=>{await api?.close();if(lane)await dropLabRuntimeLogins(lane.url,token);await db?.close();await lane?.drop();if(directory)await rm(directory,{recursive:true,force:true});},120_000);

  it("imports ordinary project source archives with explicit entry, ordered overlays and private original bytes",async()=>{
    const TARGET="package-raw-target";await createEmptyProject(TARGET,"RAWNEW");
    const files=[{name:"boards/board.dts",content:'\uFEFF/dts-v1/;\r\n/include/ "../common/defaults.dtsi"\r\n/ { model = "Raw project"; compatible = "unknown,board"; };\r\n'},
      {name:"common/defaults.dtsi",content:'/ { raw: raw { compatible = "unknown,driver"; value = <1>; status = "disabled"; }; };\n'},
      {name:"overrides/first.dtsi",content:'&raw { value = <2>; };\n'}, {name:"overrides/last.dtsi",content:'&raw { value = <3>; status = "okay"; };\n'},
      {name:"private/config.json",content:json}];
    const zip=new JSZip();for(const file of files)zip.file(file.name,file.content,{createFolders:false});
    const rawArchive={name:"project-sources.zip",contentBase64:await zip.generateAsync({type:"base64"})};
    const input={name:"Original project input",ownership:"private",archive:rawArchive};
    const selection=await post<{item:{kind:string;members:{sourceName:string}[]}}>(`${importPath(TARGET)}/preview`,input);
    expect(selection.status,selection.bodyText).toBe(200);expect(selection.body.item.kind).toBe("source-selection");
    expect(selection.body.item.members.map(row=>row.sourceName)).toEqual(files.map(row=>row.name));expect(selection.body.item).not.toHaveProperty("proofToken");
    const chosen={...input,sourceConfiguration:{entryFile:"boards/board.dts",overlayOrder:["overrides/first.dtsi","overrides/last.dtsi"],buildInputs:{includeSearchPaths:[],defines:{}}}};
    const checked=await post<{item:ConfigSetImportPreview}>(`${importPath(TARGET)}/preview`,chosen);expect(checked.status,checked.bodyText).toBe(200);
    expect(checked.body.item.sharedVersions).toEqual([]);expect(checked.body.item.members.every(row=>row.ownership==="private")).toBe(true);
    const apply={...chosen,proofToken:checked.body.item.proofToken,reason:"Initialize project from actual source tree",clientMutationId:"raw-source-intake"};
    const wrong={...apply,sourceConfiguration:{...chosen.sourceConfiguration,overlayOrder:[...chosen.sourceConfiguration.overlayOrder].reverse()}};
    expect((await post(`${importPath(TARGET)}/apply`,wrong)).status).toBe(409);
    const imported=await post<{item:ConfigSetImportResult}>(`${importPath(TARGET)}/apply`,apply);expect(imported.status,imported.bodyText).toBe(200);
    expect((await post(`${importPath(TARGET)}/apply`,apply)).body).toEqual(imported.body);
    const readback=await requestJson<ExportConfigSetResult>(server(),`/api/v1/projects/${TARGET}/config-sets/${imported.body.item.configSetId}/export`);expect(readback.status,readback.bodyText).toBe(200);
    expect(readback.body.files.map(({name,content})=>({name,content}))).toEqual(files);expect(readback.body.manifest.sourcePackage?.overlayOrder).toEqual(chosen.sourceConfiguration.overlayOrder);
    expect(readback.body.manifest.sourcePackage?.sharedClosure).toEqual([]);expect(await listCatalogBindingRowsForProject(api,auth,{projectId:TARGET})).toEqual([]);
    expect((await post(`${importPath(PRIVATE)}/preview`,{...chosen,ownership:"reuse"})).status).toBe(400);
    expect((await post(`${importPath(PRIVATE)}/preview`,{...chosen,sourceConfiguration:{...chosen.sourceConfiguration,entryFile:"../outside.dts"}})).status).toBe(400);
    expect((await post(`${importPath("package-foreign-project")}/preview`,chosen)).status).toBe(404);
    const unresolved=new JSZip();unresolved.file("board.dts",'/dts-v1/; / { model = "Missing context"; compatible = "unknown,board"; }; &{/soc} { unknown { compatible = "unknown,driver"; }; };');
    const missingContext=await post(`${importPath(PRIVATE)}/preview`,{...chosen,archive:{name:"missing-context.zip",contentBase64:await unresolved.generateAsync({type:"base64"})},sourceConfiguration:{...chosen.sourceConfiguration,entryFile:"board.dts",overlayOrder:[]}});
    expect(missingContext.status,missingContext.bodyText).toBe(400);expect(missingContext.bodyText).toContain("target-unresolved");
    const jsonProject="package-raw-json";await createEmptyProject(jsonProject,"RAWJSON");const jsonZip=new JSZip();jsonZip.file("settings.json",json);
    const jsonInput={name:"Raw JSON only",ownership:"private",archive:{name:"json-only.zip",contentBase64:await jsonZip.generateAsync({type:"base64"})},sourceConfiguration:{entryFile:null,overlayOrder:[],buildInputs:{includeSearchPaths:[],defines:{}}}};
    const jsonPreview=await post<{item:ConfigSetImportPreview}>(`${importPath(jsonProject)}/preview`,jsonInput);expect(jsonPreview.status,jsonPreview.bodyText).toBe(200);expect(jsonPreview.body.item.entryFile).toBeNull();
    const jsonImported=await post<{item:ConfigSetImportResult}>(`${importPath(jsonProject)}/apply`,{...jsonInput,proofToken:jsonPreview.body.item.proofToken,reason:"Private ungoverned JSON source",clientMutationId:"raw-json-intake"});expect(jsonImported.status,jsonImported.bodyText).toBe(200);
    expect(await listCatalogBindingRowsForProject(api,auth,{projectId:jsonProject})).toEqual([]);
  },120_000);

  it("exports original upgraded shared closure, local overrides/status and mixed JSON then reimports fresh owned identities",async()=>{
    const leaf=await post<{item:{resourceId:string}}>("/api/v2/shared-dtsi",{name:"Pinned declaration dependency",sourceName:"nested/dependency.dtsi",content:'/ { frozen_dependency { status = "okay"; }; };',changeDescription:"Publish fixed dependency"});expect(leaf.status,leaf.bodyText).toBe(201);
    const leafPreview=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${leaf.body.item.resourceId}/publication-preview`,{expectedRevision:1});expect(leafPreview.status,leafPreview.bodyText).toBe(201);
    const leafPublished=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${leaf.body.item.resourceId}/publications`,{previewId:leafPreview.body.item.id,idempotencyKey:"package-leaf"});expect(leafPublished.status,leafPublished.bodyText).toBe(201);
    const dependencies=[{resourceId:leaf.body.item.resourceId,versionId:leafPublished.body.item.id,mountPath:"vendor"}];
    const created=await post<{item:{resourceId:string}}>("/api/v2/shared-dtsi",{name:"Power original library",changeDescription:"Publish original library inputs",members:[
      {sourceName:"lib/power.dtsi",content:'#include "../include/limits.h"\n#include "../vendor/nested/dependency.dtsi"\n/ { charger { iin_max = <DEFAULT_INPUT>; status = "okay"; }; };\n'},
      {sourceName:"include/limits.h",content:"\uFEFF// exact original header\r\n#define DEFAULT_INPUT 28\r\n"}],dependencies});
    expect(created.status,created.bodyText).toBe(201);resourceId=created.body.item.resourceId;
    async function publish(revision:number,key:string) {const preview=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${resourceId}/publication-preview`,{expectedRevision:revision});
      expect(preview.status,preview.bodyText).toBe(201);const published=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${resourceId}/publications`,{previewId:preview.body.item.id,idempotencyKey:key});expect(published.status,published.bodyText).toBe(201);return published.body.item.id;}
    const first=await publish(1,"package-v1");
    const memberPath=`/api/v1/projects/${SOURCE}/config-sets/${setId}/member-addition`;
    const body={sharedReference:{resourceId,versionId:first,mountPath:"shared/power"},role:"misc",sortOrder:2};
    const preview=await post<{item:{proofToken:string}}>(`${memberPath}/preview`,body);expect(preview.status,preview.bodyText).toBe(200);
    const attached=await post(`${memberPath}/apply`,{...body,proofToken:preview.body.item.proofToken,reason:"Attach exact shared version",clientMutationId:"package-reference"});expect(attached.status,attached.bodyText).toBe(200);
    const draft=await post<{item:{members:{id:string;sourceName:string;content:string}[]}}>(`/api/v2/shared-dtsi/${resourceId}/draft`,{baseVersionId:first});expect(draft.status,draft.bodyText).toBe(201);
    const saved=await requestJson(server(),`/api/v2/shared-dtsi/${resourceId}/draft`,{method:"PUT",body:JSON.stringify({name:"Power original library",members:draft.body.item.members.map(row=>({...row,content:row.content.replace("28","30")})),dependencies,expectedRevision:1,changeDescription:"New defaults"})});expect(saved.status,saved.bodyText).toBe(200);
    versionId=await publish(2,"package-v2");
    const upgrade={...body,sharedReference:{...body.sharedReference,versionId,replaceVersionId:first}};
    const upgradedPreview=await post<{item:{proofToken:string}}>(`${memberPath}/preview`,upgrade);expect(upgradedPreview.status,upgradedPreview.bodyText).toBe(200);
    const upgraded=await post(`${memberPath}/apply`,{...upgrade,proofToken:upgradedPreview.body.item.proofToken,reason:"Upgrade current pin",clientMutationId:"package-upgrade"});expect(upgraded.status,upgraded.bodyText).toBe(200);
    const result=await requestJson<ExportConfigSetResult>(server(),`/api/v1/projects/${SOURCE}/config-sets/${setId}/export`);expect(result.status,result.bodyText).toBe(200);exported=result.body;
    expect(exported.files.find(row=>row.name==="private/settings.json")?.content).toBe(json);
    expect(exported.files.find(row=>row.name.endsWith("board.dts"))?.content).toContain("// preserve original project overrides\r\n");
    expect(exported.files.find(row=>row.name.endsWith("limits.h"))?.content).toBe("\uFEFF// exact original header\r\n#define DEFAULT_INPUT 30\r\n");
    expect(exported.manifest.sourcePackage?.sharedClosure[0]?.versionId).toBe(versionId);
    expect(exported.manifest.sourcePackage?.preprocessing).toBeDefined();archive=await packageArchive(exported);
    const input={name:"Reimported",ownership:"reuse",archive};
    const checked=await post<{item:ConfigSetImportPreview}>(`${importPath(TARGET)}/preview`,input);expect(checked.status,checked.bodyText).toBe(200);
    expect(checked.body.item.sharedVersions).toEqual([expect.objectContaining({version:2,mountPath:"shared/power"}),expect.objectContaining({version:1,mountPath:"shared/power/vendor"})]);
    const apply={...input,proofToken:checked.body.item.proofToken,reason:"Reproduce exported original inputs",clientMutationId:"package-import"};
    const imported=await post<{item:ConfigSetImportResult}>(`${importPath(TARGET)}/apply`,apply);expect(imported.status,imported.bodyText).toBe(200);
    expect((await post(`${importPath(TARGET)}/apply`,apply)).body).toEqual(imported.body);
    const readback=await requestJson<ExportConfigSetResult>(server(),`/api/v1/projects/${TARGET}/config-sets/${imported.body.item.configSetId}/export`);expect(readback.status,readback.bodyText).toBe(200);
    expect(readback.body.files).toEqual(exported.files);
    expect(readback.body.manifest.sourcePackage).toEqual(exported.manifest.sourcePackage);
    expect(readback.body.manifest.members.map(row=>row.fileId)).not.toEqual(exported.manifest.members.map(row=>row.fileId));
    const oldBindings=await listCatalogBindingRowsForProject(api,auth,{projectId:SOURCE});
    const newBindings=await listCatalogBindingRowsForProject(api,auth,{projectId:TARGET});
    expect(newBindings.map(row=>row.typedValue)).toEqual(oldBindings.map(row=>row.typedValue));
    expect(newBindings).toEqual(expect.arrayContaining([expect.objectContaining({propertyKey:"iin_max",rawValue:"<31>"})]));
    expect(newBindings.every(row=>oldBindings.every(old=>old.id!==row.id))).toBe(true);
  },120_000);

  it.each([false,true])("restores shared snapshots after complete package import without losing private values or source identity (deleted importer=%s)",async(deletedImporter)=>{
    const suffix=deletedImporter?"-deleted":"";
    const SOURCE=`package-snapshot-source${suffix}`,TARGET=`package-snapshot-target${suffix}`,PRIVATE=`package-snapshot-legacy${suffix}`;
    const codeSuffix=deletedImporter?"D":"";
    await createEmptyProject(SOURCE,`SNAPSHOTSOURCE${codeSuffix}`);await createEmptyProject(TARGET,`SNAPSHOTNEW${codeSuffix}`);await createEmptyProject(PRIVATE,`SNAPSHOTLEGACY${codeSuffix}`);
    const importer=deletedImporter?makeTestAuthContext({organizationId:ORG,userId:"package-former-importer",roles:[{roleId:"admin",projectId:null}]}):auth;
    if(deletedImporter) {
      await db.query("insert into users(id,organization_id,name,title,is_active) values($1,$2,'Former importer','Admin',true)",[importer.user.id,ORG]);
      await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('package-former-importer-role',$1,$2,'admin')",[importer.user.id,ORG]);
    }
    const initialZip=new JSZip();initialZip.file("boards/board.dts",original,{createFolders:false});initialZip.file("private/settings.json",json,{createFolders:false});
    const initialInput={name:"Independent snapshot source",ownership:"private",archive:{name:"snapshot-source.zip",contentBase64:await initialZip.generateAsync({type:"base64"})},sourceConfiguration:{entryFile:"boards/board.dts",overlayOrder:[],buildInputs:{includeSearchPaths:[],defines:{}}}};
    const initialPreview=await post<{item:ConfigSetImportPreview}>(`${importPath(SOURCE)}/preview`,initialInput);expect(initialPreview.status,initialPreview.bodyText).toBe(200);
    const initialApplied=await post<{item:ConfigSetImportResult}>(`${importPath(SOURCE)}/apply`,{...initialInput,proofToken:initialPreview.body.item.proofToken,reason:"Independent source for snapshot recovery",clientMutationId:"snapshot-source-seed"});expect(initialApplied.status,initialApplied.bodyText).toBe(200);const setId=initialApplied.body.item.configSetId;
    const created=await post<{item:{resourceId:string}}>("/api/v2/shared-dtsi",{name:"Portable snapshot defaults",sourceName:"defaults.dtsi",content:'/ { reusable { status = "okay"; }; };',changeDescription:"Exact portable source"});expect(created.status,created.bodyText).toBe(201);
    const id=created.body.item.resourceId;
    const publicationPreview=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${id}/publication-preview`,{expectedRevision:1});expect(publicationPreview.status,publicationPreview.bodyText).toBe(201);
    const published=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${id}/publications`,{previewId:publicationPreview.body.item.id,idempotencyKey:`snapshot-package-publication${suffix}`});expect(published.status,published.bodyText).toBe(201);
    const reference={sharedReference:{resourceId:id,versionId:published.body.item.id,mountPath:"shared"},role:"misc",sortOrder:2};
    const addition=`/api/v1/projects/${SOURCE}/config-sets/${setId}/member-addition`;
    const checked=await post<{item:{proofToken:string}}>(`${addition}/preview`,reference);expect(checked.status,checked.bodyText).toBe(200);
    expect((await post(`${addition}/apply`,{...reference,proofToken:checked.body.item.proofToken,reason:"Portable snapshot source",clientMutationId:"snapshot-package-reference"})).status).toBe(200);
    const sourceExport=await requestJson<ExportConfigSetResult>(server(),`/api/v1/projects/${SOURCE}/config-sets/${setId}/export`);expect(sourceExport.status,sourceExport.bodyText).toBe(200);
    const input={name:"Portable snapshot",ownership:"reuse",archive:await packageArchive(sourceExport.body)};
    const importPreview=await post<{item:ConfigSetImportPreview}>(`${importPath(TARGET)}/preview`,input,importer);expect(importPreview.status,importPreview.bodyText).toBe(200);
    const imported=await post<{item:ConfigSetImportResult}>(`${importPath(TARGET)}/apply`,{...input,proofToken:importPreview.body.item.proofToken,reason:"Import frozen source",clientMutationId:"snapshot-package-import"},importer);expect(imported.status,imported.bodyText).toBe(200);
    const targetSet=imported.body.item.configSetId;
    const savedBindings=await listCatalogBindingRowsForProject(api,auth,{projectId:TARGET});expect(savedBindings).toHaveLength(1);
    const historyPath=`/api/v2/projects/${TARGET}/parameter-bindings/${savedBindings[0]!.id}/change-history`;
    const originalHistory=await requestJson<{items:Array<{id:string}>}>(server(),historyPath);expect(originalHistory.status,originalHistory.bodyText).toBe(200);
    const gate=await evaluateReleaseReadiness(api,auth,{configSetId:targetSet},{objectStore:storage});expect(gate.canCreateBaseline,JSON.stringify(gate)).toBe(true);
    const baseline=await createBaseline(api,auth,{configSetId:targetSet,name:"Imported shared source snapshot",gateToken:gate.gateToken,acknowledgedWarningIds:gate.warnings.filter(row=>row.acknowledgementRequired).map(row=>row.id)},{},{objectStore:storage});
    const targetExport=await requestJson<ExportConfigSetResult>(server(),`/api/v1/projects/${TARGET}/config-sets/${targetSet}/export`);expect(targetExport.status,targetExport.bodyText).toBe(200);
    const root=targetExport.body.manifest.members.find(row=>row.role==="base" && row.format==="dts")!;
    const current=await requestJson<{items:Array<{fileId:string;currentVersionId:string}>}>(server(),`/api/v1/projects/${TARGET}/config-sets/${targetSet}/files`);
    const rootVersion=current.body.items.find(row=>row.fileId===root.fileId)!.currentVersionId;
    const after=targetExport.body.files.find(row=>row.name.endsWith("board.dts"))!.content.replace("<31>","<32>");
    const candidate=await post<{item:{id:string}}>(`/api/v1/projects/${TARGET}/parameter-file-candidates`,{fileId:root.fileId,fileName:root.fileName,intent:"source_revision",contentBase64:Buffer.from(after).toString("base64"),expectedCurrentVersionId:rootVersion,expectedConfigRevisionId:imported.body.item.configRevisionId,clientMutationId:"imported-snapshot-edit"});expect(candidate.status,candidate.bodyText).toBe(201);
    const sourcePreview=await requestJson<{item:SourceRevisionPreview}>(server(),`/api/v1/projects/${TARGET}/parameter-file-candidates/${candidate.body.item.id}/source-preview`);expect(sourcePreview.status,sourcePreview.bodyText).toBe(200);
    expect((await post(`/api/v1/projects/${TARGET}/parameter-file-candidates/${candidate.body.item.id}/source-apply`,{expectedCurrentVersionId:rootVersion,expectedProofToken:sourcePreview.body.item.proofToken,reason:"Later private value",clientMutationId:"imported-snapshot-edit-apply"})).status).toBe(200);
    const editedHistory=await requestJson<{items:Array<{id:string}>}>(server(),historyPath);expect(editedHistory.status,editedHistory.bodyText).toBe(200);
    expect(editedHistory.body.items.length).toBeGreaterThan(originalHistory.body.items.length);
    const nextDraft=await post<{item:{members:{id:string;sourceName:string;content:string}[]}}>(`/api/v2/shared-dtsi/${id}/draft`,{baseVersionId:published.body.item.id});expect(nextDraft.status,nextDraft.bodyText).toBe(201);
    const changed=await requestJson(server(),`/api/v2/shared-dtsi/${id}/draft`,{method:"PUT",body:JSON.stringify({name:"Portable snapshot defaults",members:nextDraft.body.item.members.map(member=>({...member,content:member.content.replace("okay","disabled")})),expectedRevision:1,changeDescription:"Later independently published defaults"})});expect(changed.status,changed.bodyText).toBe(200);
    const nextPreview=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${id}/publication-preview`,{expectedRevision:2});expect(nextPreview.status,nextPreview.bodyText).toBe(201);
    const nextPublished=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${id}/publications`,{previewId:nextPreview.body.item.id,idempotencyKey:`snapshot-package-successor${suffix}`});expect(nextPublished.status,nextPublished.bodyText).toBe(201);
    const additionPath=`/api/v1/projects/${TARGET}/config-sets/${targetSet}/member-addition`;
    const upgrade={...reference,sharedReference:{...reference.sharedReference,versionId:nextPublished.body.item.id,replaceVersionId:published.body.item.id}};
    const upgradePreview=await post<{item:{proofToken:string}}>(`${additionPath}/preview`,upgrade);expect(upgradePreview.status,upgradePreview.bodyText).toBe(200);
    const upgraded=await post(`${additionPath}/apply`,{...upgrade,proofToken:upgradePreview.body.item.proofToken,reason:"Explicitly switch imported exact shared version",clientMutationId:"imported-snapshot-shared-switch"});expect(upgraded.status,upgraded.bodyText).toBe(200);
    if(deletedImporter) {
      const receiptQuery=`select event.actor_type,event.actor_user_id,revision.created_by_user_id,revision.initiator_type,
        event.historical_attribution as audit_history,revision.historical_attribution as revision_history
        from audit_events event join dts_config_revisions revision on revision.id=event.metadata->'result'->>'configRevisionId'
        where event.kind='config-set' and event.action='imported' and event.target_id=$1`;
      const before=(await db.query<Record<string,unknown>>(receiptQuery,[targetSet])).rows[0]!;
      expect(before).toMatchObject({actor_type:"user",actor_user_id:importer.user.id,created_by_user_id:importer.user.id,initiator_type:"user"});
      expect(before.audit_history).toMatchObject({actors:{actor_user_id:{id:importer.user.id,source:"recorded"}}});
      expect(before.revision_history).toMatchObject({actors:{created_by_user_id:{id:importer.user.id,source:"recorded"}}});
      const sharedVersion=(await db.query<{file_version_id:string}>("select file_version_id from dts_config_revision_members where config_revision_id=$1 and shared_reference is not null limit 1",[imported.body.item.configRevisionId])).rows[0]!.file_version_id;
      await expect(api.query("update project_parameter_file_versions set created_by_user_id=null where id=$1",[sharedVersion])).rejects.toMatchObject({code:"55000"});
      await expect(api.query("update project_parameter_file_versions set checksum='forged' where id=$1",[sharedVersion])).rejects.toMatchObject({code:"55000"});
      const deleted=await requestJson(server(),`/api/v1/users/${importer.user.id}`,{method:"DELETE"});expect(deleted.status,deleted.bodyText).toBe(204);
      expect((await db.query("select id from users where id=$1",[importer.user.id])).rows).toHaveLength(0);
      expect((await db.query(receiptQuery,[targetSet])).rows).toEqual([{...before,actor_user_id:null,created_by_user_id:null,initiator_type:"legacy"}]);
    }
    const preview=await requestJson<{item:RestorePreviewResult}>(server(),`/api/v1/projects/${TARGET}/baselines/${baseline.id}/restore-preview`);expect(preview.status,preview.bodyText).toBe(200);expect(preview.body.item.canonical?.canRestore).toBe(true);
    const restored=await post(`/api/v1/projects/${TARGET}/baselines/${baseline.id}/rollback`,{proofToken:preview.body.item.canonical!.proofToken,sourceConfigRevisionId:imported.body.item.configRevisionId,reason:"Restore imported source snapshot",confirmCompositionChanges:true,clientMutationId:"imported-snapshot-restore"});expect(restored.status,restored.bodyText).toBe(200);
    expect((await listCatalogBindingRowsForProject(api,auth,{projectId:TARGET})).map(row=>({id:row.id,rawValue:row.rawValue}))).toEqual(savedBindings.map(row=>({id:row.id,rawValue:row.rawValue})));
    const restoredHistory=await requestJson<{items:Array<{id:string}>}>(server(),historyPath);expect(restoredHistory.status,restoredHistory.bodyText).toBe(200);
    expect(restoredHistory.body.items.length).toBeGreaterThan(originalHistory.body.items.length);expect(restoredHistory.body.items).toEqual(expect.arrayContaining(originalHistory.body.items));
    expect(restoredHistory.body.items).toEqual(expect.arrayContaining(editedHistory.body.items));
    const restoredExport=await requestJson<ExportConfigSetResult>(server(),`/api/v1/projects/${TARGET}/config-sets/${targetSet}/export`);expect(restoredExport.status,restoredExport.bodyText).toBe(200);expect(restoredExport.body.files).toEqual(targetExport.body.files);expect(restoredExport.body.manifest.sourcePackage?.sharedClosure).toEqual(targetExport.body.manifest.sourcePackage?.sharedClosure);
    const sharedMember=(await requestJson<{items:Array<{fileId:string;sharedReference?:unknown}>}>(server(),`/api/v1/projects/${TARGET}/config-sets/${targetSet}/files`)).body.items.find(row=>row.sharedReference)!;
    expect((await post(`/api/v1/projects/${TARGET}/parameter-files/${sharedMember.fileId}/versions`,{contentBase64:Buffer.from('/ { forged {}; };').toString("base64")})).status).toBe(409);
    expect((await requestJson(server(foreign),`/api/v1/projects/${TARGET}/baselines/${baseline.id}/restore-preview`)).status).toBe(404);
    // A historical producer without the complete committed import receipt must
    // remain refused; current filenames/references cannot reconstruct authority.
    await db.query(`create function omit_import_composition() returns trigger language plpgsql as $$begin
      if new.kind='config-set' and new.action='imported' and new.project_id in ('package-snapshot-legacy','package-snapshot-legacy-deleted') then new.metadata=new.metadata-'sharedComposition'; end if; return new; end $$`);
    await db.query("create trigger omit_import_composition before insert on public.audit_events for each row execute function omit_import_composition()");
    let legacy:ConfigSetImportResult;
    try {
      const legacyInput={...input,name:"Historical import without complete receipt"};
      const legacyPreview=await post<{item:ConfigSetImportPreview}>(`${importPath(PRIVATE)}/preview`,legacyInput);expect(legacyPreview.status,legacyPreview.bodyText).toBe(200);
      const legacyApplied=await post<{item:ConfigSetImportResult}>(`${importPath(PRIVATE)}/apply`,{...legacyInput,proofToken:legacyPreview.body.item.proofToken,reason:"Historical producer fixture",clientMutationId:"legacy-import-receipt"});expect(legacyApplied.status,legacyApplied.bodyText).toBe(200);legacy=legacyApplied.body.item;
    } finally {await db.query("drop trigger omit_import_composition on public.audit_events");await db.query("drop function omit_import_composition()");}
    const legacyGate=await evaluateReleaseReadiness(api,auth,{configSetId:legacy.configSetId},{objectStore:storage});expect(legacyGate.canCreateBaseline,JSON.stringify(legacyGate)).toBe(true);
    const legacyBaseline=await createBaseline(api,auth,{configSetId:legacy.configSetId,name:"No invented historical provenance",gateToken:legacyGate.gateToken,acknowledgedWarningIds:legacyGate.warnings.filter(row=>row.acknowledgementRequired).map(row=>row.id)},{},{objectStore:storage});
    const refused=await requestJson(server(),`/api/v1/projects/${PRIVATE}/baselines/${legacyBaseline.id}/restore-preview`);expect(refused.status,refused.bodyText).toBe(409);expect(refused.bodyText).toContain("来源回执");
  },120_000);

  it("rejects stale proof, forged shared bytes, changed ownership and revoked administration without partial writes",async()=>{
    const crossOrg=await post(`${importPath("package-foreign-project")}/preview`,{name:"Foreign reuse forbidden",ownership:"reuse",archive},foreign);
    expect(crossOrg.status,crossOrg.bodyText).toBe(404);expect(crossOrg.bodyText).not.toContain("Power original library");
    const forged=structuredClone(exported),file=forged.files.find(row=>row.name.endsWith("power.dtsi"))!;
    file.content=file.content.replace("DEFAULT_INPUT","29");
    const checksum=createHash("sha256").update(file.content).digest("hex");
    forged.manifest.sourcePackage!.members.find(row=>row.sourceName===file.name)!.checksum=`sha256:${checksum}`;
    const invalid=await post(`${importPath(PRIVATE)}/preview`,{name:"Forged shared bytes",ownership:"reuse",archive:await packageArchive(forged)});
    expect(invalid.status,invalid.bodyText).toBe(409);
    const input={name:"Private reimport",ownership:"reuse",archive};
    const preview=await post<{item:ConfigSetImportPreview}>(`${importPath(PRIVATE)}/preview`,input);expect(preview.status,preview.bodyText).toBe(200);
    const apply={...input,proofToken:preview.body.item.proofToken,reason:"Try stale ownership",clientMutationId:"package-stale"};
    expect((await post(`${importPath(PRIVATE)}/apply`,{...apply,ownership:"private"})).status).toBe(409);
    const before=(await requestJson(server(),`/api/v1/projects/${PRIVATE}/config-sets`)).body;
    await db.query("delete from user_role_bindings where id='package-admin'");
    try {expect((await post(`${importPath(PRIVATE)}/apply`,apply)).status).toBe(403);}
    finally {await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('package-admin',$1,$2,'admin')",[ADMIN,ORG]);}
    expect((await requestJson(server(),`/api/v1/projects/${PRIVATE}/config-sets`)).body).toEqual(before);
  },120_000);

  it("rolls back owned objects on storage failure then explicitly imports private originals with no shared publication or reference",async()=>{
    const input={name:"Private original inputs",ownership:"private",archive};
    const preview=await post<{item:ConfigSetImportPreview}>(`${importPath(PRIVATE)}/preview`,input);expect(preview.status,preview.bodyText).toBe(200);
    const before=await readdir(directory,{recursive:true});let puts=0;
    const broken:ObjectStore={...storage,async put(value){if(++puts===2)throw new Error("package storage failure");return storage.put(value);}};
    const failed=await post(`${importPath(PRIVATE)}/apply`,{...input,proofToken:preview.body.item.proofToken,reason:"Private imported ownership",clientMutationId:"package-private"},auth,broken);expect(failed.status).toBe(500);
    expect((await readdir(directory,{recursive:true})).filter(name=>!before.includes(name))).toEqual([]);
    const imported=await post<{item:ConfigSetImportResult}>(`${importPath(PRIVATE)}/apply`,{...input,proofToken:preview.body.item.proofToken,reason:"Private imported ownership",clientMutationId:"package-private"});expect(imported.status,imported.bodyText).toBe(200);
    const readback=await requestJson<ExportConfigSetResult>(server(),`/api/v1/projects/${PRIVATE}/config-sets/${imported.body.item.configSetId}/export`);expect(readback.status,readback.bodyText).toBe(200);
    expect(readback.body.files).toEqual(exported.files);expect(readback.body.manifest.sourcePackage?.sharedClosure).toEqual([]);
    expect(readback.body.manifest.members.every(row=>!row.sharedReference)).toBe(true);
    expect(readback.body.manifest.sourcePackage?.declaredBuildInputs).toEqual(exported.manifest.sourcePackage?.resolvedBuildInputs);
  },120_000);

  it("admits one whole configuration when two confirmed imports compete for the same empty project",async()=>{
    const input={name:"Concurrent import",ownership:"private",archive};
    const preview=await post<{item:ConfigSetImportPreview}>(`${importPath(FAILED)}/preview`,input);expect(preview.status,preview.bodyText).toBe(200);
    const body={...input,proofToken:preview.body.item.proofToken,reason:"Only one complete source composition"};
    const results=await Promise.all([post(`${importPath(FAILED)}/apply`,{...body,clientMutationId:"package-race-a"}),post(`${importPath(FAILED)}/apply`,{...body,clientMutationId:"package-race-b"})]);
    expect(results.map(row=>row.status).sort()).toEqual([200,409]);
    const sets=await requestJson<{items:unknown[]}>(server(),`/api/v1/projects/${FAILED}/config-sets`);expect(sets.status).toBe(200);expect(sets.body.items).toHaveLength(1);
  },120_000);

  it("refuses new exact references after retirement while retaining historical export and explicit private import",async()=>{
    const projectId="package-retired",input={name:"Retired original inputs",ownership:"reuse",archive};
    const preview=await post<{item:ConfigSetImportPreview}>(`${importPath(projectId)}/preview`,input);expect(preview.status,preview.bodyText).toBe(200);
    const retired=await post(`/api/v2/shared-dtsi/${resourceId}/lifecycle`,{state:"retired",expectedLifecycleRevision:1,idempotencyKey:"package-retire"});expect(retired.status,retired.bodyText).toBe(200);
    const refused=await post(`${importPath(projectId)}/apply`,{...input,proofToken:preview.body.item.proofToken,reason:"Cannot create new retired references",clientMutationId:"package-retired"});expect(refused.status,refused.bodyText).toBe(409);expect(refused.bodyText).toContain("shared-resource-retired");
    const retained=await requestJson<ExportConfigSetResult>(server(),`/api/v1/projects/${SOURCE}/config-sets/${setId}/export`);expect(retained.status,retained.bodyText).toBe(200);expect(retained.body.files).toEqual(exported.files);
    const privateInput={...input,ownership:"private"};
    const privatePreview=await post<{item:ConfigSetImportPreview}>(`${importPath(projectId)}/preview`,privateInput);expect(privatePreview.status,privatePreview.bodyText).toBe(200);
    const imported=await post<{item:ConfigSetImportResult}>(`${importPath(projectId)}/apply`,{...privateInput,proofToken:privatePreview.body.item.proofToken,reason:"Explicitly retain originals as project private",clientMutationId:"package-retired-private"});expect(imported.status,imported.bodyText).toBe(200);
    const readback=await requestJson<ExportConfigSetResult>(server(),`/api/v1/projects/${projectId}/config-sets/${imported.body.item.configSetId}/export`);expect(readback.status,readback.bodyText).toBe(200);expect(readback.body.files).toEqual(exported.files);expect(readback.body.manifest.sourcePackage?.sharedClosure).toEqual([]);
  },120_000);

  it("retains an explicitly validated complete-source overlay build input through repeated new-project export and import",async()=>{
    const files=[{name:"roots/current.dts",format:"dts" as const,content:'/dts-v1/; / { model = "Current root"; compatible = "test,board"; };',role:"base"},
      {name:"roots/original.dts",format:"dts" as const,content:'/dts-v1/; / { model = "Original root"; compatible = "test,board"; old { retained = <1>; }; };',role:"overlay"}];
    const sourcePackage={schemaVersion:"wiseeff-config-set/v1",entryFile:files[0]!.name,includeSearchPaths:["."],overlayOrder:[files[1]!.name],formerRootOverlayFiles:[files[1]!.name],
      declaredBuildInputs:{includeSearchPaths:["."],defines:{}},resolvedBuildInputs:{includeSearchPaths:["."],defines:{}},sharedClosure:[],jsonSources:[],
      members:files.map((file,index)=>({sourceName:file.name,format:file.format,role:file.role,sortOrder:index,checksum:`sha256:${createHash("sha256").update(file.content).digest("hex")}`}))};
    let archive=await packageArchive({manifest:{sourcePackage},files});
    for(const projectId of ["package-roots-a","package-roots-b"]) {
      const input={name:"Original root composition",ownership:"private",archive};
      const preview=await post<{item:ConfigSetImportPreview}>(`${importPath(projectId)}/preview`,input);expect(preview.status,preview.bodyText).toBe(200);
      const applied=await post<{item:ConfigSetImportResult}>(`${importPath(projectId)}/apply`,{...input,proofToken:preview.body.item.proofToken,reason:"Retain original complete-source compile inputs",clientMutationId:"original-roots-package"});expect(applied.status,applied.bodyText).toBe(200);
      const exported=await requestJson<ExportConfigSetResult>(server(),`/api/v1/projects/${projectId}/config-sets/${applied.body.item.configSetId}/export`);expect(exported.status,exported.bodyText).toBe(200);
      expect(exported.body.manifest.validation?.ok).toBe(true);expect(exported.body.files).toEqual(files.map(({name,format,content})=>({name,format,content})));
      expect(exported.body.manifest.sourcePackage?.formerRootOverlayFiles).toEqual(["roots/original.dts"]);
      archive=await packageArchive(exported.body);
    }
  });

  it("refuses a torn export when an actual source revision commits while its original object read is held",async()=>{
    const exportPath=`/api/v1/projects/${SOURCE}/config-sets/${setId}/export`;
    const current=await requestJson<ExportConfigSetResult>(server(),exportPath);expect(current.status,current.bodyText).toBe(200);
    const entry=current.body.manifest.sourcePackage!.entryFile!,root=current.body.manifest.members.find(row=>row.role==="base" && row.format==="dts")!;
    const files=await requestJson<{items:Array<{fileId:string;currentVersionId:string}>}>(server(),`/api/v1/projects/${SOURCE}/config-sets/${setId}/files`);expect(files.status,files.bodyText).toBe(200);
    const versionId=files.body.items.find(row=>row.fileId===root.fileId)!.currentVersionId;
    const revisions=await requestJson<{items:Array<{id:string}>}>(server(),`/api/v2/projects/${SOURCE}/config-sets/${setId}/revisions`);expect(revisions.status,revisions.bodyText).toBe(200);
    const after=current.body.files.find(row=>row.name===entry)!.content.replace("<31>","<32>");
    const candidate=await post<{item:{id:string}}>(`/api/v1/projects/${SOURCE}/parameter-file-candidates`,{fileId:root.fileId,fileName:root.fileName,
      contentBase64:Buffer.from(after).toString("base64"),intent:"source_revision",expectedCurrentVersionId:versionId,expectedConfigRevisionId:revisions.body.items[0]!.id,clientMutationId:"export-currentness-candidate"});expect(candidate.status,candidate.bodyText).toBe(201);
    const preview=await requestJson<{item:{proofToken:string}}>(server(),`/api/v1/projects/${SOURCE}/parameter-file-candidates/${candidate.body.item.id}/source-preview`);expect(preview.status,preview.bodyText).toBe(200);
    let entered!:()=>void,release!:()=>void,held=false;
    const started=new Promise<void>(resolve=>{entered=resolve;}),blocked=new Promise<void>(resolve=>{release=resolve;});
    const slow:ObjectStore={...storage,async get(key){const bytes=await storage.get(key);if(!held){held=true;entered();await blocked;}return bytes;}};
    const exporting=requestJson<ExportConfigSetResult>(server(auth,slow),exportPath);
    try {
      await started;
      const applied=await post(`/api/v1/projects/${SOURCE}/parameter-file-candidates/${candidate.body.item.id}/source-apply`,{expectedCurrentVersionId:versionId,
        expectedProofToken:preview.body.item.proofToken,reason:"Change real source during held original export read",clientMutationId:"export-currentness-apply"});expect(applied.status,applied.bodyText).toBe(200);
    } finally {release();}
    const stale=await exporting;expect(stale.status,stale.bodyText).toBe(409);expect(stale.bodyText).not.toContain('"manifest"');
    const fresh=await requestJson<ExportConfigSetResult>(server(),exportPath);expect(fresh.status,fresh.bodyText).toBe(200);
    expect(fresh.body.files.find(row=>row.name===entry)!.content).toBe(after);expect(fresh.body.manifest.validation?.ok).toBe(true);
  },120_000);
  it("commits deletion of the former composition administrator after shared reference replacement and snapshot restoration",async()=>{
    const nextId="package-surviving-admin";
    await db.query("insert into users(id,organization_id,name,title,is_active) values($1,$2,'Surviving administrator','Admin',true)",[nextId,ORG]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('package-surviving-admin-role',$1,$2,'admin')",[nextId,ORG]);
    const next=makeTestAuthContext({organizationId:ORG,userId:nextId,roles:[{roleId:"admin",projectId:null}]});
    const compositionReceiptsSql="select id,source_revision_context,member_frozen_proof,applied_source_result,applied_audit_ref,historical_attribution from project_parameter_value_change_requests where organization_id=$1 and status='approved' and source_revision_context ? 'sharedComposition' order by id";
    const before=(await api.query<{id:string}>(compositionReceiptsSql,[ORG])).rows;expect(before.length).toBeGreaterThan(0);
    const projects=(await api.query<{id:string}>("select id from projects where organization_id=$1 order by id",[ORG])).rows;
    const readBindings=()=>Promise.all(projects.map(async({id})=>(await captureConfigurationSourceState(api,{organizationId:ORG,projectId:id})).bindings));
    const bindings=await readBindings();
    await api.transaction(async tx=>{
      const deleted=await requestJson(server(next,storage,tx),`/api/v1/users/${ADMIN}`,{method:"DELETE"});expect(deleted.status,deleted.bodyText).toBe(204);
      await tx.query("set constraints all immediate");
    });
    expect((await api.query("select id from users where id=$1",[ADMIN])).rows).toHaveLength(0);
    expect((await api.query(compositionReceiptsSql,[ORG])).rows).toEqual(before);
    await expect(api.query("update project_parameter_value_change_requests set source_revision_context='{}'::jsonb where id=$1",[before[0]!.id])).rejects.toMatchObject({code:"23514",message:"Reviewed source revision context is immutable"});
    expect((await api.query(compositionReceiptsSql,[ORG])).rows).toEqual(before);
    expect(await readBindings()).toEqual(bindings);
  });
});

describe("JSON source identities in complete configuration packages",()=>{
  let lane:Awaited<ReturnType<typeof createEphemeralTestDatabase>>,db:ReturnType<typeof createPostgresDatabase>,api:ReturnType<typeof createPostgresDatabase>;
  let directory:string,storage:ReturnType<typeof createLocalObjectStore>;
  const token=`package_json_${process.pid}`,projectId="package-json-target";
  function server(){const router=createRouter();registerParameterFileRoutes(router,{db:api,objectStore:storage,getCurrentAuthContext:()=>auth,refusalAuditSink:createTrustedRefusalAuditSink(db)});return createHttpServer(router);}
  beforeAll(async()=>{
    lane=await createEphemeralTestDatabase("package-json");db=createPostgresDatabase(lane.url);directory=await mkdtemp(join(tmpdir(),"wiseeff-package-json-"));storage=createLocalObjectStore(directory);
    await db.query("insert into organizations(id,name) values ($1,'Package JSON')",[ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Package admin','Admin',true)",[ADMIN,ORG]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('package-json-admin',$1,$2,'admin')",[ADMIN,ORG]);
    for(const id of [projectId,`${projectId}-mixed`])await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'Package JSON target',$1,'initialized')",[id,ORG]);
    await installConfigurationSourceFixture(db,auth,{subjectId:"csub_package_json",schemaId:"wiseeff.package.settings"});
    api=createPostgresDatabase((await provisionPublicationRuntimeLogins(lane.url,{mode:"lab",runToken:token})).apiUrl);
  },120_000);
  afterAll(async()=>{await api?.close();if(lane)await dropLabRuntimeLogins(lane.url,token);await db?.close();await lane?.drop();if(directory)await rm(directory,{recursive:true,force:true});},120_000);
  it.each([false,true])("returns the actual governed JSON source revision with fresh identities and exact original bytes (mixed: %s)",async(mixed)=>{
    const targetId=mixed?`${projectId}-mixed`:projectId;
    const source='\uFEFF{\r\n "limits":{"max":36.5}, "keep":false\r\n}\r\n',sourceName="software/original/settings.json";
    const zip=new JSZip();zip.file(sourceName,source,{createFolders:false});
    const originalSources=mixed?[{name:"boards/software.dts",content:'/dts-v1/; /include/ "../parts/private.dtsi" / { model = "Software configuration"; compatible = "test,board"; };',role:"base"},
      {name:"parts/private.dtsi",content:'/ { support { status = "okay"; }; };',role:"include"}]:[];
    for(const member of originalSources)zip.file(member.name,member.content,{createFolders:false});
    const paths=mixed?["."]:[];
    zip.file(configSetPackageManifestName,JSON.stringify({sourcePackage:{schemaVersion:"wiseeff-config-set/v1",entryFile:mixed?"boards/software.dts":null,includeSearchPaths:paths,overlayOrder:[],
      declaredBuildInputs:{includeSearchPaths:paths,defines:{}},resolvedBuildInputs:{includeSearchPaths:paths,defines:{}},sharedClosure:[],
      members:[{sourceName,format:"json",role:"base",sortOrder:0,checksum:`sha256:${createHash("sha256").update(source).digest("hex")}`},
        ...originalSources.map((member,index)=>({sourceName:member.name,format:"dts",role:member.role,sortOrder:index+1,checksum:`sha256:${createHash("sha256").update(member.content).digest("hex")}`}))],
      jsonSources:[{sourceName,configurationSchemaId:"wiseeff.package.settings",rootPointer:"/limits",mappings:[{definitionId:"pdef_acme_power_iin_max",pointer:"/limits/max"}]}]}}));
    const input={name:"Governed JSON source",ownership:"private",archive:{name:"software.zip",contentBase64:await zip.generateAsync({type:"base64"})}};
    const base=`/api/v1/projects/${targetId}/config-set-import`;
    const preview=await requestJson<{item:ConfigSetImportPreview}>(server(),`${base}/preview`,{method:"POST",body:JSON.stringify(input)});expect(preview.status,preview.bodyText).toBe(200);
    const applied=await requestJson<{item:ConfigSetImportResult}>(server(),`${base}/apply`,{method:"POST",body:JSON.stringify({...input,proofToken:preview.body.item.proofToken,reason:"Recover exact JSON instance under current schema",clientMutationId:"json-source-package"})});expect(applied.status,applied.bodyText).toBe(200);
    const bindings=await listCatalogBindingRowsForProject(api,auth,{projectId:targetId});expect(bindings).toHaveLength(1);expect(bindings[0]!.typedValue).toEqual({kind:"json",value:36.5});
    const pin=await loadOwnedProjectValueSourcePin(api,{organizationId:ORG,projectId:targetId,bindingId:bindings[0]!.id,projectValueId:bindings[0]!.currentValueId});
    expect(pin?.configRevisionId).toBe(applied.body.item.configRevisionId);
    const exported=await requestJson<ExportConfigSetResult>(server(),`/api/v1/projects/${targetId}/config-sets/${applied.body.item.configSetId}/export`);expect(exported.status,exported.bodyText).toBe(200);
    expect(exported.body.files).toEqual([{name:sourceName,format:"json",content:source},...originalSources.map(({name,content})=>({name,format:"dts",content}))]);
    expect(exported.body.manifest.sourcePackage?.jsonSources).toEqual([{sourceName,configurationSchemaId:"wiseeff.package.settings",rootPointer:"/limits",mappings:[{definitionId:"pdef_acme_power_iin_max",pointer:"/limits/max"}]}]);
  });
});
