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
import { createLocalObjectStore } from "../logs/objectStore";
import { asValueClient, listCatalogBindingRowsForProject, loadPublishedCatalog, syncPublishedCatalogProjectValuesInTransaction } from "../parameter-bindings/catalogProjectValueSync";
import { registerCatalogProjectValueConsumerRoutes } from "../parameter-bindings/catalogProjectValueRoutes";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import { registerSharedDtsiRoutes } from "../shared-dtsi/routes";
import { addConfigSetFile, createConfigSet } from "./configSetService";
import { registerParameterFileRoutes } from "./routes";
import { uploadProjectParameterFile } from "./service";
import type { MemberAdditionPreview } from "./canonicalMemberAddition";
import type { SharedDtsiVersion } from "../contracts/dtoSchemas/sharedDtsi";

const ORG="org-private-conversion",USER="conversion-admin",A="conversion-a",B="conversion-b";
const admin=makeTestAuthContext({organizationId:ORG,userId:USER,roles:[{roleId:"admin",projectId:null}]});
const root='/dts-v1/;\n/include/ "power.dtsi"\n/ { compatible = "test,board"; model = "Private conversion"; };\n';
const fragment='/ { charger: charger { compatible = "acme,power"; iin_max = <36>; }; };\n';
const override='/dts-v1/; /plugin/; &charger { iin_max = <48>; };\n';

describe("explicit private source conversion through the real API role",{timeout:120_000},()=>{
  let lane:Awaited<ReturnType<typeof createEphemeralTestDatabase>>,db:ReturnType<typeof createPostgresDatabase>,api:ReturnType<typeof createPostgresDatabase>;
  let directory:string,storage:ReturnType<typeof createLocalObjectStore>;
  const sets:Record<string,string>={},selected:Record<string,{fileId:string;fileVersionId:string;configRevisionId:string}>={};
  const token=`conversion_${process.pid}`;
  function server(auth=admin){const router=createRouter();
    registerSharedDtsiRoutes(router,{db:api,objectStore:storage,getCurrentAuthContext:()=>auth});
    registerCatalogProjectValueConsumerRoutes(router,{db:api,objectStore:storage,getCurrentAuthContext:()=>auth});
    registerParameterFileRoutes(router,{db:api,objectStore:storage,getCurrentAuthContext:()=>auth,refusalAuditSink:createTrustedRefusalAuditSink(db)});
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
    const imported=await post<{item:{resourceId:string}}>(`/api/v2/projects/${A}/config-sets/${sets[A]}/shared-dtsi`,{...selected[A],name:"Published private power"});expect(imported.status,imported.bodyText).toBe(201);
    const version=await publish(imported.body.item.resourceId,1,"private-conversion-publish");
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
    expect((await files(B)).body).toEqual(beforeB.body);
    expect((await post(`${path(A)}/apply`,{...body,proofToken:preview.body.item.proofToken,reason:"Convert this private closure",clientMutationId:"private-conversion-apply"})).body).toEqual(applied.body);
    expect((await post(`${path(A)}/apply`,{...body,proofToken:preview.body.item.proofToken,reason:"Stale conversion",clientMutationId:"private-conversion-stale"})).status).toBe(409);
    const objects=await readdir(directory,{recursive:true});
    const refused=await post(`/api/v1/projects/${A}/parameter-file-candidates`,{fileId:selected[A]!.fileId,fileName:"power.dtsi",intent:"source_revision",contentBase64:Buffer.from(fragment).toString("base64"),expectedCurrentVersionId:selected[A]!.fileVersionId,expectedConfigRevisionId:applied.body.item.configRevisionId,clientMutationId:"conversion-readonly"});expect(refused.status,refused.bodyText).toBe(409);
    expect(await readdir(directory,{recursive:true})).toEqual(objects);
  });
});
