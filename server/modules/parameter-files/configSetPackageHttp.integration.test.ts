import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
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
import { registerParameterRoutes } from "../parameters/routes";
import { registerSharedDtsiRoutes } from "../shared-dtsi/routes";
import { addConfigSetFile, createConfigSet } from "./configSetService";
import { registerParameterFileRoutes } from "./routes";
import { uploadProjectParameterFile } from "./service";
import type { ExportConfigSetResult } from "./exportService";
import { configSetPackageManifestName, type ConfigSetImportPreview, type ConfigSetImportResult } from "../contracts/dtoSchemas/configSetPackage";
import { installConfigurationSourceFixture } from "../../testing/parameterCatalog/configurationSource";
import { loadOwnedProjectValueSourcePin } from "../parameter-bindings/values";

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
  function server(principal=auth,objects:ObjectStore=storage) {const router=createRouter();
    const options={db:api,objectStore:objects,getCurrentAuthContext:()=>principal,refusalAuditSink:createTrustedRefusalAuditSink(db)};
    registerParameterFileRoutes(router,options);registerSharedDtsiRoutes(router,options);registerCatalogProjectValueConsumerRoutes(router,options);registerParameterRoutes(router,options);
    return createHttpServer(router);}
  const post=<T,>(path:string,body:unknown,principal=auth,objects:ObjectStore=storage)=>requestJson<T>(server(principal,objects),path,{method:"POST",body:JSON.stringify(body)});
  const importPath=(projectId:string)=>`/api/v1/projects/${projectId}/config-set-import`;
  async function packageArchive(value:{manifest:unknown;files:ExportConfigSetResult["files"]}) {const zip=new JSZip();zip.file(configSetPackageManifestName,JSON.stringify(value.manifest));
    for(const file of value.files)zip.file(file.name,file.content,{createFolders:false});return {name:"complete-export.zip",contentBase64:await zip.generateAsync({type:"base64"})};}
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
