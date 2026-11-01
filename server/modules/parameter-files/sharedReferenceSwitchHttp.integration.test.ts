import { mkdtemp, readdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
import { registerParameterTopologyRoutes } from "../parameter-topology/routes";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import { registerSharedDtsiRoutes } from "../shared-dtsi/routes";
import { deleteUser } from "../users/service";
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
  function server(auth = admin, sourceStore: ObjectStore = storage, database:Database=api) {
    const router = createRouter();
    registerSharedDtsiRoutes(router, { db: api, getCurrentAuthContext: () => auth });
    registerCatalogProjectValueConsumerRoutes(router, { db: api, objectStore: sourceStore, getCurrentAuthContext: () => auth });
    registerParameterTopologyRoutes(router, { db: api, objectStore: sourceStore, getCurrentAuthContext: () => auth, refusalAuditSink: createTrustedRefusalAuditSink(db) });
    registerParameterFileRoutes(router, { db: database, objectStore: sourceStore, getCurrentAuthContext: () => auth,
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

  it("pages authorized pending operations without per-row authorization queries",async()=>{
    const index=(await db.query<{indexdef:string}>("select indexdef from pg_indexes where schemaname='public' and indexname='member_addition_intent_pending_list_idx'")).rows[0];
    expect(index?.indexdef).toContain("organization_id, actor_user_id, created_at DESC, id");expect(index?.indexdef).toContain("NOT acknowledged");
    const first=await post<{item:{id:string}}>(`${path(A)}/intents`,{registrationId:randomUUID()});
    const second=await post<{item:{id:string}}>(`${path(B)}/intents`,{registrationId:randomUUID()});
    expect(first.status).toBe(200);expect(second.status).toBe(200);
    let calls=0;
    const counting:Database={query:api.query,transaction:(fn,options)=>api.transaction(async tx=>{
      const queries=vi.spyOn(tx,"query");
      try{return await fn(tx);}finally{calls+=queries.mock.calls.length;queries.mockRestore();}
    },options)};
    const list=async(query:string)=>{calls=0;const response=await requestJson<{items:Array<{id:string;projectId:string}>;total:number}>(server(admin,storage,counting),`/api/v1/member-addition-intents?${query}`);return {response,calls};};
    const all=await list("limit=1&offset=0"),next=await list("limit=1&offset=1"),one=await list(`limit=1&projectId=${A}`),past=await list("limit=1&offset=9");
    expect(all.response.body.total).toBe(2);expect(next.response.body.total).toBe(2);expect(past.response.body).toMatchObject({total:2,items:[]});
    expect(new Set([all.response.body.items[0]!.id,next.response.body.items[0]!.id])).toEqual(new Set([first.body.item.id,second.body.item.id]));
    expect(one.response.body.items[0]!.projectId).toBe(A);expect(all.calls).toBe(one.calls);
    await db.query("delete from user_role_bindings where id='shared-ref-role'");
    try{expect((await list("limit=1")).response.body).toMatchObject({total:0,items:[]});}
    finally{await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('shared-ref-role',$1,$2,'admin')",[ADMIN,ORG]);}
    for(const [project,item] of [[A,first.body.item],[B,second.body.item]] as const){expect((await post(`${path(project)}/intents/${item.id}/stop`,{})).status).toBe(200);expect((await post(`${path(project)}/intents/${item.id}/ack`,{})).status).toBe(200);}
  },120_000);

  it("registers an operation before applying and permanently fences a stopped operation", async () => {
    const registration={registrationId:"3e70aa87-0fa8-44b7-8e04-c209ec9db771"};
    const created=await post<{item:{id:string;clientMutationId:string;status:string}}>(`${path(A)}/intents`,registration);
    expect(created.status,created.bodyText).toBe(200);expect(created.body.item.status).toBe("pending");
    await expect(api.query("update public.member_addition_intents set status='applied' where id=$1",[created.body.item.id])).rejects.toMatchObject({code:"23514"});
    await expect(api.query("update public.member_addition_intents set status='stopped' where id=$1",[created.body.item.id])).rejects.toMatchObject({code:"23514"});
    const stored=(await db.query<{value:string}>("select row_to_json(i)::text as value from public.member_addition_intents i where id=$1",[created.body.item.id])).rows[0]!.value;
    expect(stored).not.toMatch(/proof|reason|digest|body/i);
    expect((await post(`${path(A)}/intents`,registration)).body).toEqual(created.body);
    const list=await requestJson<{items:Array<{id:string;projectId:string;configSetId:string}>;total:number}>(server(),"/api/v1/member-addition-intents");
    expect(list.status,list.bodyText).toBe(200);expect(list.body).toMatchObject({total:1,items:[{id:created.body.item.id,projectId:A,configSetId:sets[A]}]});
    expect((await requestJson<{total:number}>(server(),`/api/v1/member-addition-intents?projectId=${A}&configSetId=${sets[A]}&limit=1`)).body.total).toBe(1);
    expect((await requestJson<{total:number}>(server(),`/api/v1/member-addition-intents?projectId=${B}&configSetId=${sets[B]}&limit=1`)).body.total).toBe(0);
    expect((await post(`${path(A)}/intents`,{registrationId:"d51cccfd-a0cc-43a2-8fa9-e0c095b4bb3d"})).status).toBe(409);
    const operation={fileId:"not-used",role:"misc",sortOrder:1,proofToken:"0".repeat(64),reason:"Stop before apply",clientMutationId:created.body.item.clientMutationId};
    const another=(await createConfigSet(db,admin,{projectId:A,name:"Other intent target"})).id;
    expect((await post(`/api/v1/projects/${A}/config-sets/${another}/member-addition/intents`,registration)).status).toBe(409);
    expect((await post(`/api/v1/projects/${A}/config-sets/${another}/member-addition/apply`,operation)).status).toBe(409);
    expect((await post(`${path(A)}/apply`,{...operation,clientMutationId:"old-client-bypass"})).status).toBe(409);
    await db.query("delete from user_role_bindings where id='shared-ref-role'");
    try{expect((await post(`${path(A)}/intents/${created.body.item.id}/stop`,{})).status).toBe(403);}
    finally{await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('shared-ref-role',$1,$2,'admin')",[ADMIN,ORG]);}
    expect((await post(`${path(A)}/intents/${created.body.item.id}/stop`,{},editor)).status).toBe(403);
    await db.query(`create function public.refuse_intent_stop_audit() returns trigger language plpgsql as $$begin
      if new.action='member-operation-stopped' then raise exception 'synthetic audit failure'; end if; return new; end$$;
      create trigger refuse_intent_stop_audit before insert on public.audit_events for each row execute function public.refuse_intent_stop_audit()`);
    try{expect((await post(`${path(A)}/intents/${created.body.item.id}/stop`,{})).status).toBe(500);}
    finally{await db.query("drop trigger refuse_intent_stop_audit on public.audit_events; drop function public.refuse_intent_stop_audit()");}
    expect((await requestJson<{items:Array<{status:string}>}>(server(),"/api/v1/member-addition-intents")).body.items[0]?.status).toBe("pending");
    const stopped=await post<{item:{id:string;status:string}}>(`${path(A)}/intents/${created.body.item.id}/stop`,{});
    expect(stopped.status,stopped.bodyText).toBe(200);expect(stopped.body.item.status).toBe("stopped");
    expect((await post(`${path(A)}/apply`,operation)).status).toBe(409);
    expect((await post(`${path(A)}/intents/${created.body.item.id}/ack`,{})).status).toBe(200);
    expect((await post(`${path(A)}/apply`,operation)).status).toBe(409);
    const raw=operation.clientMutationId.replaceAll("-","");
    for(const alias of [operation.clientMutationId.toUpperCase(),raw,`{${operation.clientMutationId.toUpperCase()}}`,raw.match(/.{4}/g)!.join("-")]){
      expect((await db.query<{id:string}>("select $1::uuid::text as id",[alias])).rows[0]!.id).toBe(operation.clientMutationId);
      const result=await post<{error:{message:string}}>(`${path(A)}/apply`,{...operation,clientMutationId:alias});
      expect(result.status,result.bodyText).toBe(409);expect(result.body.error.message).toContain("已停止");
    }
    await expect(api.query("update public.member_addition_intents set status='pending' where id=$1",[created.body.item.id])).rejects.toMatchObject({code:"55000"});
    await expect(api.query("delete from public.member_addition_intents where id=$1",[created.body.item.id])).rejects.toMatchObject({code:"42501"});
    expect((await requestJson<{total:number}>(server(),"/api/v1/member-addition-intents")).body.total).toBe(0);
  },120_000);

  it("anonymizes a deleted account's reserved identity without removing the terminal fence",async()=>{
    const actor=makeTestAuthContext({organizationId:ORG,userId:"delete-intent-user",roles:[{roleId:"admin",projectId:null}]});
    await db.query("insert into users(id,organization_id,name,title,is_active) values ('delete-intent-user',$1,'Temporary','Admin',true)",[ORG]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('delete-intent-role','delete-intent-user',$1,'admin')",[ORG]);
    const created=await post<{item:{id:string}}>(`${path(A)}/intents`,{registrationId:"4b0eb954-8c29-4cc3-b3b2-08c7ec98f6b7"},actor);
    expect(created.status,created.bodyText).toBe(200);
    expect((await post(`${path(A)}/intents/${created.body.item.id}/stop`,{},actor)).status).toBe(200);
    await deleteUser(api,admin,"delete-intent-user",{requestId:"delete-intent-user"});
    expect((await db.query("select actor_user_id,registration_id,mutation_id,status from public.member_addition_intents where id=$1",[created.body.item.id])).rows)
      .toEqual([{actor_user_id:null,registration_id:null,mutation_id:null,status:"stopped"}]);
    expect((await post(`${path(A)}/intents/${created.body.item.id}/stop`,{},actor)).status).toBe(403);
  },120_000);

  it("purges reserved identities only with the exact project erasure and rolls back on failure",async()=>{
    const project="intent-erasure-project";
    await db.query("insert into projects(id,organization_id,name,code,status) values($1,$2,'Intent erasure','INTENTERASE','initialized')",[project,ORG]);
    const set=await createConfigSet(db,admin,{projectId:project,name:"Intent erasure"});
    const endpoint=`/api/v1/projects/${project}/config-sets/${set.id}/member-addition`;
    const reserved=await post<{item:{id:string;clientMutationId:string}}>(`${endpoint}/intents`,{registrationId:"0f780525-b95d-4b94-97c3-e245e3689322"});
    expect(reserved.status,reserved.bodyText).toBe(200);
    await expect(api.query("delete from public.member_addition_intents where id=$1",[reserved.body.item.id])).rejects.toMatchObject({code:"42501"});
    const purge=()=>api.transaction(tx=>tx.query("select parameter_catalog.purge_project($1,$2,$3,$4)",[ORG,project,ADMIN,"intent-erasure-preview"]));
    await db.query(`create function public.refuse_intent_project_erasure() returns trigger language plpgsql as $$begin
      if old.project_id='intent-erasure-project' then raise exception 'synthetic erasure failure'; end if; return old; end$$;
      create trigger refuse_intent_project_erasure before delete on public.member_addition_intents for each row execute function public.refuse_intent_project_erasure()`);
    try{await expect(purge()).rejects.toThrow();}
    finally{await db.query("drop trigger refuse_intent_project_erasure on public.member_addition_intents; drop function public.refuse_intent_project_erasure()");}
    expect((await db.query("select id from public.member_addition_intents where id=$1",[reserved.body.item.id])).rowCount).toBe(1);
    await purge();expect((await db.query("select id from public.member_addition_intents where id=$1",[reserved.body.item.id])).rowCount).toBe(0);
    await expect(db.query("insert into projects(id,organization_id,name,code,status) values($1,$2,'Recreated','INTENTAGAIN','initialized')",[project,ORG])).rejects.toMatchObject({code:"55000"});
    expect((await post(`${endpoint}/apply`,{fileId:"not-used",role:"misc",sortOrder:1,proofToken:"0".repeat(64),reason:"Late request",clientMutationId:reserved.body.item.clientMutationId})).status).not.toBe(200);
  },120_000);

  it("does not deadlock project erasure against an apply waiting behind the Catalog fence",async()=>{
    const project="intent-lock-project";
    await db.query("insert into projects(id,organization_id,name,code,status) values($1,$2,'Intent lock','INTENTLOCK','initialized')",[project,ORG]);
    const set=await createConfigSet(db,admin,{projectId:project,name:"Intent lock"});
    const endpoint=`/api/v1/projects/${project}/config-sets/${set.id}/member-addition`;
    const reserved=await post<{item:{id:string;clientMutationId:string}}>(`${endpoint}/intents`,{registrationId:"05c04cf7-a70c-47a3-88f9-dfdd6c3c8a11"});
    expect(reserved.status,reserved.bodyText).toBe(200);
    const gate=await getRootPostgresPool(api)!.connect();await gate.query("begin");await gate.query("select pg_advisory_xact_lock($1::bigint)",["688004000041"]);
    let pending:ReturnType<typeof post>;
    try{
      pending=post(`${endpoint}/apply`,{fileId:"not-used",role:"misc",sortOrder:1,proofToken:"0".repeat(64),reason:"Waiting application",clientMutationId:reserved.body.item.clientMutationId});
      const deadline=Date.now()+15_000;let blocked=false;
      while(Date.now()<deadline){const waiting=await db.query<{n:string}>(`select count(*)::text n from pg_stat_activity where datname=current_database()
        and wait_event_type='Lock' and query like '%pg_advisory_xact_lock_shared%'`);if(Number(waiting.rows[0]!.n)>0){blocked=true;break;}await new Promise(resolve=>setTimeout(resolve,20));}
      expect(blocked).toBe(true);
      await gate.query("select parameter_catalog.purge_project($1,$2,$3,$4)",[ORG,project,ADMIN,"intent-lock-preview"]);
      await gate.query("commit");
    }catch(error){await gate.query("rollback");throw error;}finally{gate.release();}
    const late=await pending!;expect(late.status,late.bodyText).not.toBe(200);
    expect((await db.query("select id from public.member_addition_intents where id=$1",[reserved.body.item.id])).rowCount).toBe(0);
  },120_000);

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
    let committedIntent="";
    for(const project of [A,B]) {
      const preview=await post<Preview>(`${path(project)}/preview`,initial);
      expect(preview.status,preview.bodyText).toBe(200);
      let mutationId=project===B?"EFEE6E1F-D365-4AC5-AE24-24CB44CD3B17":`initial-${project}`;
      if(project===A){const reserved=await post<{item:{id:string;clientMutationId:string}}>(`${path(project)}/intents`,{registrationId:"0a42d7fd-12ad-4762-92ea-64b7095195e8"});
        expect(reserved.status,reserved.bodyText).toBe(200);committedIntent=reserved.body.item.id;mutationId=reserved.body.item.clientMutationId;}
      let applied:Awaited<ReturnType<typeof post<Applied>>>;
      if(project===A){
        const attempts=await Promise.all(["Pin v1","Different concurrent reason"].map(reason=>post<Applied>(`${path(project)}/apply`,{...initial,proofToken:preview.body.item.proofToken,reason,clientMutationId:mutationId})));
        expect(attempts.map(result=>result.status).sort()).toEqual([200,409]);applied=attempts.find(result=>result.status===200)!;
        const reason=attempts[0]!.status===200?"Pin v1":"Different concurrent reason";
        expect((await post(`${path(project)}/apply`,{...initial,proofToken:preview.body.item.proofToken,reason,clientMutationId:mutationId})).body).toEqual(applied.body);
      }else{applied=await post<Applied>(`${path(project)}/apply`,{...initial,proofToken:preview.body.item.proofToken,reason:"Pin v1",clientMutationId:mutationId});
        expect((await post(`${path(project)}/apply`,{...initial,proofToken:preview.body.item.proofToken,reason:"Pin v1",clientMutationId:mutationId})).body).toEqual(applied.body);}
      expect(applied.status,applied.bodyText).toBe(200);
      if(project===A)appliedA=applied.body.item;
    }
    const committed=await post<{item:{status:string;result:Applied["item"]}}>(`${path(A)}/intents/${committedIntent}/stop`,{});
    expect(committed.status,committed.bodyText).toBe(200);expect(committed.body.item.status).toBe("applied");expect(committed.body.item.result.configRevisionId).toBe(appliedA.configRevisionId);
    expect((await post(`${path(A)}/intents/${committedIntent}/ack`,{})).status).toBe(200);
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

  it("serializes an in-flight apply and explicit stop in both orders",async()=>{
    const pool=getRootPostgresPool(db)!;
    async function waitForBlocked(expected:number){
      const until=Date.now()+20_000;
      while(Date.now()<until){const waiting=await db.query<{count:string}>(`select count(*)::text as count from pg_stat_activity
        where datname=current_database() and wait_event_type='Lock' and query like '%select id from public.users%for no key update%'`);
        if(Number(waiting.rows[0]!.count)>=expected)return;await new Promise(resolve=>setTimeout(resolve,20));}
      throw new Error(`Expected ${expected} operations waiting for the user lock`);
    }
    for(const [order,target,from] of [["apply",nativeHeadVersionId,versionId],["stop",versionId,nativeHeadVersionId]] as const){
      const body={sharedReference:{resourceId,versionId:target,replaceVersionId:from},role:"misc",sortOrder:1};
      const preview=await post<Preview>(`${path(B)}/preview`,body);expect(preview.status,preview.bodyText).toBe(200);
      const registration=await post<{item:{id:string;clientMutationId:string}}>(`${path(B)}/intents`,{registrationId:order==="apply"?"33f2ff34-2836-4891-8d7f-fcf53b01d271":"1b349061-2702-44fa-8239-32c2266f122d"});
      expect(registration.status,registration.bodyText).toBe(200);const item=registration.body.item;
      const operation={...body,proofToken:preview.body.item.proofToken,reason:"Race stop and apply",
        clientMutationId:order==="apply"?item.clientMutationId.toUpperCase():`{${item.clientMutationId.replaceAll("-","")}}`};
      const gate=await pool.connect();await gate.query("begin");await gate.query("select id from public.users where id=$1 for no key update",[ADMIN]);
      let first:ReturnType<typeof post>,second:ReturnType<typeof post>;
      try{first=order==="apply"?post(`${path(B)}/apply`,operation):post(`${path(B)}/intents/${item.id}/stop`,{});await waitForBlocked(1);
        second=order==="apply"?post(`${path(B)}/intents/${item.id}/stop`,{}):post(`${path(B)}/apply`,operation);await waitForBlocked(2);
      }finally{await gate.query("commit");gate.release();}
      const [a,b]=await Promise.all([first!,second!]);
      if(order==="apply"){expect(a.status,a.bodyText).toBe(200);expect(b.status,b.bodyText).toBe(200);expect(b.body).toMatchObject({item:{status:"applied"}});}
      else{expect(a.status,a.bodyText).toBe(200);expect(a.body).toMatchObject({item:{status:"stopped"}});expect(b.status,b.bodyText).toBe(409);}
      expect((await post(`${path(B)}/intents/${item.id}/ack`,{})).status).toBe(200);
      if(order==="apply")expect((await post(`${path(B)}/apply`,{...operation,clientMutationId:item.clientMutationId})).status).toBe(200);
    }
    const restore={sharedReference:{resourceId,versionId,replaceVersionId:nativeHeadVersionId},role:"misc",sortOrder:1};
    const preview=await post<Preview>(`${path(B)}/preview`,restore);expect(preview.status,preview.bodyText).toBe(200);
    const applied=await post(`${path(B)}/apply`,{...restore,proofToken:preview.body.item.proofToken,reason:"Restore independent project",clientMutationId:"restore-race-b"});
    expect(applied.status,applied.bodyText).toBe(200);
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
      expect(checked.body).toMatchObject({error:{details:{switchConflicts:expect.arrayContaining([expect.objectContaining({
        sourceName:"limits.dtsi",resourceId,versionId:target.body.item.id,memberId:expect.any(String),line:expect.any(Number),
      })])}}});
      expect((await requestJson(server(),`/api/v1/projects/${A}/config-sets/${sets[A]}/files`)).body).toEqual(original);
    }
  },120_000);

  it("locates every ambiguous candidate in its immutable target source without inventing an identity decision",async()=>{
    const created=await post<{item:{resourceId:string}}>("/api/v2/shared-dtsi",{name:"Ambiguous switch",sourceName:"ambiguous.dtsi",content:'/ { recovery_bus { dev@10 { reg = <0x10>; }; }; };',changeDescription:"Original identity"});
    expect(created.status,created.bodyText).toBe(201);const resource=created.body.item.resourceId;
    const publish=async(revision:number)=>{
      const p=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${resource}/publication-preview`,{expectedRevision:revision});expect(p.status,p.bodyText).toBe(201);
      const v=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${resource}/publications`,{previewId:p.body.item.id,idempotencyKey:p.body.item.id});expect(v.status,v.bodyText).toBe(201);return v.body.item.id;
    };
    const old=await publish(1),initial={sharedReference:{resourceId:resource,versionId:old},role:"misc",sortOrder:2};
    const p=await post<Preview>(`${path(A)}/preview`,initial);expect(p.status,p.bodyText).toBe(200);
    const applied=await post(`${path(A)}/apply`,{...initial,proofToken:p.body.item.proofToken,reason:"Pin original identity",clientMutationId:"ambiguity-initial"});expect(applied.status,applied.bodyText).toBe(200);
    const draft=await post<{item:{revision:number}}>(`/api/v2/shared-dtsi/${resource}/draft`,{baseVersionId:old});
    const saved=await requestJson<{item:{revision:number}}>(server(),`/api/v2/shared-dtsi/${resource}/draft`,{method:"PUT",body:JSON.stringify({expectedRevision:draft.body.item.revision,name:"Ambiguous switch",sourceName:"ambiguous.dtsi",content:'/ { recovery_bus { left@10 { reg = <0x10>; }; right@10 { reg = <0x10>; }; }; };',changeDescription:"Requires identity evidence"})});expect(saved.status,saved.bodyText).toBe(200);
    const target=await publish(saved.body.item.revision),before=(await requestJson(server(),`/api/v1/projects/${A}/config-sets/${sets[A]}/files`)).body;
    const blocked=await post(`${path(A)}/preview`,{sharedReference:{resourceId:resource,versionId:target,replaceVersionId:old},role:"misc",sortOrder:2});
    expect(blocked.status,blocked.bodyText).toBe(409);
    expect(blocked.body).toMatchObject({error:{details:{reason:"logical-continuity-decision-needed",switchConflicts:expect.arrayContaining([
      expect.objectContaining({node:"/recovery_bus/left@10",resourceId:resource,versionId:target,sourceName:"ambiguous.dtsi",line:1,identity:true}),
      expect.objectContaining({node:"/recovery_bus/right@10",resourceId:resource,versionId:target,sourceName:"ambiguous.dtsi",line:1,identity:true})
    ])}}});
    expect((await requestJson(server(),`/api/v1/projects/${A}/config-sets/${sets[A]}/files`)).body).toEqual(before);
  },120_000);

  it("preserves literal CPP root inputs through both version directions and edits quoted entry rename or removal in place",async()=>{
    const created=await post<{item:{resourceId:string}}>("/api/v2/shared-dtsi",{name:"Literal CPP entry",members:[
      {sourceName:"literal.dtsi",content:'/ { literal { compatible = "acme,power"; iin_max = <41>; }; };'},
      {sourceName:"literal-support.dtsi",content:'/ { literal_support { status = "okay"; }; };'}],changeDescription:"Fixed literal CPP inputs"});expect(created.status,created.bodyText).toBe(201);
    const resource=created.body.item.resourceId;
    const publish=async(revision:number)=>{
      const preview=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${resource}/publication-preview`,{expectedRevision:revision});expect(preview.status,preview.bodyText).toBe(201);
      const result=await post<{item:SharedDtsiVersion}>(`/api/v2/shared-dtsi/${resource}/publications`,{previewId:preview.body.item.id,idempotencyKey:preview.body.item.id});expect(result.status,result.bodyText).toBe(201);return result.body.item;
    };
    const first=await publish(1),initial={sharedReference:{resourceId:resource,versionId:first.id},role:"misc",sortOrder:1};
    const preview=await post<Preview>(`${path(A)}/preview`,initial);expect(preview.status,preview.bodyText).toBe(200);
    const added=await post<Applied>(`${path(A)}/apply`,{...initial,proofToken:preview.body.item.proofToken,reason:"Literal CPP root",clientMutationId:"literal-initial"});expect(added.status,added.bodyText).toBe(200);
    const files=(await requestJson<{items:{fileId:string;fileName:string;role:string;currentVersionId:string}[]}>(server(),`/api/v1/projects/${A}/config-sets/${sets[A]}/files`)).body.items;
    const root=files.find(file=>file.role==="base")!,original=await requestJson(server(),`/api/v1/projects/${A}/parameter-files/${root.fileId}/versions/${root.currentVersionId}/content`);
    const cppRoot=original.bodyText.replace('/include/ "literal.dtsi"','#include "literal.dtsi"').replace('/include/ "literal-support.dtsi"','#include "literal-support.dtsi"');expect(cppRoot).not.toBe(original.bodyText);
    const candidate=await post<{item:{id:string}}>(`/api/v1/projects/${A}/parameter-file-candidates`,{fileId:root.fileId,fileName:root.fileName,intent:"source_revision",contentBase64:Buffer.from(cppRoot).toString("base64"),
      expectedCurrentVersionId:root.currentVersionId,expectedConfigRevisionId:added.body.item.configRevisionId,clientMutationId:"literal-root-edit"});expect(candidate.status,candidate.bodyText).toBe(201);
    const sourcePreview=await requestJson<{item:SourceRevisionPreview}>(server(),`/api/v1/projects/${A}/parameter-file-candidates/${candidate.body.item.id}/source-preview`);expect(sourcePreview.status,sourcePreview.bodyText).toBe(200);
    const edited=await post<Applied>(`/api/v1/projects/${A}/parameter-file-candidates/${candidate.body.item.id}/source-apply`,{expectedCurrentVersionId:root.currentVersionId,expectedProofToken:sourcePreview.body.item.proofToken,reason:"Literal project include spelling",clientMutationId:"literal-root-edit-apply"});expect(edited.status,edited.bodyText).toBe(200);
    const successor=async(base:SharedDtsiVersion,members:{id:string;sourceName:string;content:string}[])=>{
      const clone=await post<{item:{revision:number}}>(`/api/v2/shared-dtsi/${resource}/draft`,{baseVersionId:base.id});expect(clone.status,clone.bodyText).toBe(201);
      const saved=await requestJson<{item:{revision:number}}>(server(),`/api/v2/shared-dtsi/${resource}/draft`,{method:"PUT",body:JSON.stringify({expectedRevision:clone.body.item.revision,name:"Literal CPP entry",members,changeDescription:"Selected exact literal entry version"})});expect(saved.status,saved.bodyText).toBe(200);return publish(saved.body.item.revision);
    };
    const second=await successor(first,first.members.map(({id,sourceName,content})=>({id,sourceName,content:content.replace("<41>","<43>")})));
    for(const [index,target] of [second,first].entries()) {
      const body={sharedReference:{resourceId:resource,versionId:target.id,replaceVersionId:index===0?first.id:second.id},role:"misc",sortOrder:1};
      const checked=await post<Preview>(`${path(A)}/preview`,body);expect(checked.status,checked.bodyText).toBe(200);
      expect(checked.body.item.rootEdit?.before).toBe(cppRoot);expect(checked.body.item.rootEdit?.after).toBe(cppRoot);
      const applied=await post<Applied>(`${path(A)}/apply`,{...body,proofToken:checked.body.item.proofToken,reason:"Retain literal CPP root input",clientMutationId:`literal-switch-${index}`});expect(applied.status,applied.bodyText).toBe(200);
      expect((await listCatalogBindingRowsForProject(api,admin,{projectId:A})).some(row=>row.rawValue===(index===0?"<43>":"<41>"))).toBe(true);
    }
    const renamed=await successor(second,second.members.map(({id,sourceName,content})=>({id,sourceName:sourceName==="literal.dtsi"?"literal-renamed.dtsi":sourceName,content})));
    const removed=await successor(renamed,renamed.members.filter(member=>member.sourceName!=="literal-support.dtsi").map(({id,sourceName,content})=>({id,sourceName,content})));
    let beforeRoot=cppRoot;
    for(const [index,target] of [renamed,removed].entries()) {
      const body={sharedReference:{resourceId:resource,versionId:target.id,replaceVersionId:index===0?first.id:renamed.id},role:"misc",sortOrder:1};
      const checked=await post<Preview>(`${path(A)}/preview`,body);expect(checked.status,checked.bodyText).toBe(200);
      const afterRoot=index===0?cppRoot.replace('#include "literal.dtsi"','#include "literal-renamed.dtsi"'):beforeRoot.replace('#include "literal-support.dtsi"',"");
      expect(checked.body.item.rootEdit?.before).toBe(beforeRoot);expect(checked.body.item.rootEdit?.after).toBe(afterRoot);
      const applied=await post<Applied>(`${path(A)}/apply`,{...body,proofToken:checked.body.item.proofToken,reason:"Exact quoted CPP include change",clientMutationId:`literal-retarget-${index}`});expect(applied.status,applied.bodyText).toBe(200);
      beforeRoot=afterRoot;
    }
  },120_000);
  it("keeps necessary transitive references and retains an independently declared shared dependency",async()=>{
    const publish=async(name:string,sourceName:string,dependencies:unknown[]=[])=>{
      const draft=await post<{item:{resourceId:string}}>("/api/v2/shared-dtsi",{name,sourceName,content:`/ { ${name} { status = "okay"; }; };`,dependencies,changeDescription:"Required closure"});expect(draft.status,draft.bodyText).toBe(201);
      const resourceId=draft.body.item.resourceId,p=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${resourceId}/publication-preview`,{expectedRevision:1});expect(p.status,p.bodyText).toBe(201);
      const v=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${resourceId}/publications`,{previewId:p.body.item.id,idempotencyKey:name});expect(v.status,v.bodyText).toBe(201);return{resourceId,versionId:v.body.item.id};
    };
    const leaf=await publish("removal_leaf","removal-leaf.dtsi"),parent=await publish("removal_parent","removal-parent.dtsi",[{...leaf,mountPath:""}]);
    const add=async(reference:typeof leaf,key:string)=>{
      const body={sharedReference:reference,role:"misc",sortOrder:3},p=await post<Preview>(`${path(A)}/preview`,body);expect(p.status,p.bodyText).toBe(200);
      const result=await post<Applied>(`${path(A)}/apply`,{...body,proofToken:p.body.item.proofToken,reason:"Declared fixed dependency",clientMutationId:key});expect(result.status,result.bodyText).toBe(200);
    };
    const remove=async(reference:typeof leaf,key:string)=>{
      const body={removeSharedReference:reference,role:"misc",sortOrder:0},p=await post<Preview>(`${path(A)}/preview`,body);expect(p.status,p.bodyText).toBe(200);
      const result=await post<Applied>(`${path(A)}/apply`,{...body,proofToken:p.body.item.proofToken,reason:"Remove only this direct reference",clientMutationId:key});expect(result.status,result.bodyText).toBe(200);return p.body.item;
    };
    await add(leaf,"removal-direct-leaf");await add(parent,"removal-direct-parent");
    const required=await post(`${path(A)}/preview`,{removeSharedReference:leaf,role:"misc",sortOrder:0});expect(required.status,required.bodyText).toBe(409);
    const retained=await remove(parent,"removal-parent-keep-leaf");expect(retained.sharedComposition).toContainEqual(expect.objectContaining({...leaf,direct:true}));
    await remove(leaf,"removal-last-leaf");await add(parent,"removal-parent-readd");
    const transitive=await post(`${path(A)}/preview`,{removeSharedReference:leaf,role:"misc",sortOrder:0});expect(transitive.status,transitive.bodyText).toBe(409);
    expect((await remove(parent,"removal-parent-with-closure")).sharedComposition?.some(item=>item.resourceId===leaf.resourceId)).toBe(false);
  },120_000);

  it("removes a direct shared reference atomically, retaining private JSON, deleted Binding history and the other project", async () => {
    const draft=await post<{item:{resourceId:string;revision:number}}>("/api/v2/shared-dtsi",{name:"Removable limits",sourceName:"removable.dtsi",content:'/ { removable { compatible = "acme,power"; iin_max = <26>; }; };',changeDescription:"Removal fixture"});
    expect(draft.status,draft.bodyText).toBe(201);
    const resourceId=draft.body.item.resourceId;
    const publication=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${resourceId}/publication-preview`,{expectedRevision:1});
    const published=await post<{item:{id:string}}>(`/api/v2/shared-dtsi/${resourceId}/publications`,{previewId:publication.body.item.id,idempotencyKey:"removal-publication"});
    expect(published.status,published.bodyText).toBe(201);
    const versionId=published.body.item.id,body={sharedReference:{resourceId,versionId},role:"misc",sortOrder:1};
    const addedPreview=await post<Preview>(`${path(B)}/preview`,body);expect(addedPreview.status,addedPreview.bodyText).toBe(200);
    const added=await post<Applied>(`${path(B)}/apply`,{...body,proofToken:addedPreview.body.item.proofToken,reason:"Pin removable reference",clientMutationId:"removal-add"});expect(added.status,added.bodyText).toBe(200);
    const before=await listCatalogBindingRowsForProject(api,admin,{projectId:B});
    const otherBefore=await requestJson(server(),`/api/v1/projects/${A}/config-sets/${sets[A]}/files`);
    const remove={removeSharedReference:{resourceId,versionId},role:"misc",sortOrder:0};
    const preview=await post<Preview>(`${path(B)}/preview`,remove);expect(preview.status,preview.bodyText).toBe(200);
    expect(preview.body.item.sharedRemoval).toMatchObject({resourceId,versionId});
    expect(preview.body.item.sharedSwitch?.effective).toContainEqual(expect.objectContaining({node:"/removable",property:"iin_max",before:"<26>",after:null}));
    expect(preview.body.item.members.some(member=>member.sourceName==="private.json")).toBe(true);
    expect(preview.body.item.members.some(member=>member.sourceName==="removable.dtsi")).toBe(false);
    expect((await post(`${path(B)}/preview`,remove,editor)).status).toBe(403);
    const confirm={...remove,proofToken:preview.body.item.proofToken,reason:"Remove this project reference",clientMutationId:"remove-reference"};
    await db.query("delete from user_role_bindings where id='shared-ref-role'");
    try{expect((await post(`${path(B)}/apply`,confirm)).status).toBe(403);}
    finally{await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('shared-ref-role',$1,$2,'admin')",[ADMIN,ORG]);}
    const filesBefore=(await requestJson(server(),`/api/v1/projects/${B}/config-sets/${sets[B]}/files`)).body,objectsBefore=await readdir(directory,{recursive:true});
    expect((await post(`${path(B)}/apply`,confirm,admin,{...storage,put:async()=>{throw new Error("Injected removal storage failure");}})).status).toBe(500);
    for(const [label,install] of [
      ["present-member",()=>db.query(`create function reject_bad_removal_pin() returns trigger language plpgsql security definer set search_path=pg_catalog,public,parameter_catalog as $$begin
        if new.value_state='present' then
          select previous.file_id,previous.file_version_id into new.file_id,new.file_version_id
          from public.dts_config_revision_members previous join public.dts_config_revisions revision on revision.id=previous.config_revision_id
          where revision.organization_id=new.organization_id and revision.project_id=new.project_id and previous.shared_reference is not null
            and not exists(select 1 from public.dts_config_revision_members current_member
              where current_member.config_revision_id=new.config_revision_id and current_member.file_id=previous.file_id)
          limit 1;
        end if;
        return new; end $$`)],
      ["wrong-before",()=>db.query(`create function reject_bad_removal_pin() returns trigger language plpgsql security definer set search_path=pg_catalog,public,parameter_catalog as $$begin
        if new.locator->>'kind'='dts-source-absence' then new.locator=jsonb_set(new.locator,'{baseFileVersionId}','"forged-before"'); new.locator_digest=parameter_catalog.canonical_source_absence_locator_digest(new.locator); end if;
        return new; end $$`)],
      ["forged-absence",()=>db.query(`create function reject_bad_removal_pin() returns trigger language plpgsql security definer set search_path=pg_catalog,public,parameter_catalog as $$begin
        if new.locator->>'kind'='dts-source-absence' then new.delete_proof=jsonb_set(new.delete_proof,'{beforeSourceDigest}',to_jsonb('sha256:'||repeat('0',64))); end if;
        return new; end $$`)]
    ] as const) {
      await install();
      await db.query("create trigger reject_bad_removal_pin before insert on parameter_catalog.project_value_source_pins for each row execute function reject_bad_removal_pin()");
      try {expect((await post(`${path(B)}/apply`,{...confirm,clientMutationId:label})).status,label).toBe(500);}
      finally {await db.query("drop trigger reject_bad_removal_pin on parameter_catalog.project_value_source_pins");await db.query("drop function reject_bad_removal_pin()");}
      expect((await requestJson(server(),`/api/v1/projects/${B}/config-sets/${sets[B]}/files`)).body).toEqual(filesBefore);
      expect(await readdir(directory,{recursive:true})).toEqual(objectsBefore);
    }
    await db.query(`create function reject_removal_audit() returns trigger language plpgsql as $$begin if new.metadata->>'operation'='remove_shared_reference' then raise exception 'Injected removal audit failure'; end if; return new; end $$`);
    await db.query("create trigger reject_removal_audit before insert on public.audit_events for each row execute function reject_removal_audit()");
    try {expect((await post(`${path(B)}/apply`,confirm)).status).toBe(500);}
    finally{await db.query("drop trigger reject_removal_audit on public.audit_events");await db.query("drop function reject_removal_audit()");}
    expect((await requestJson(server(),`/api/v1/projects/${B}/config-sets/${sets[B]}/files`)).body).toEqual(filesBefore);
    expect(await readdir(directory,{recursive:true})).toEqual(objectsBefore);
    const competing={...confirm,clientMutationId:"remove-reference-concurrent"},attempts=await Promise.all([post<Applied>(`${path(B)}/apply`,confirm),post<Applied>(`${path(B)}/apply`,competing)]);
    expect(attempts.map(result=>result.status).sort()).toEqual([200,409]);const applied=attempts.find(result=>result.status===200)!;
    expect((await post(`${path(B)}/apply`,attempts[0]!.status===200?confirm:competing)).body).toEqual(applied.body);
    expect((await post(`${path(B)}/apply`,{...confirm,clientMutationId:"remove-stale"})).status).toBe(409);
    expect((await requestJson(server(),`/api/v1/projects/${A}/config-sets/${sets[A]}/files`)).body).toEqual(otherBefore.body);
    const after=await listCatalogBindingRowsForProject(api,admin,{projectId:B});
    const removed=before.find(row=>row.rawValue==="<26>")!;expect(removed).toBeDefined();
    expect(after.find(row=>row.id===removed.id)).toBeUndefined();
    const history=await requestJson<{items:{valueState:string}[]}>(server(),`/api/v2/projects/${B}/parameter-bindings/${removed.id}/change-history`);
    expect(history.status,history.bodyText).toBe(200);expect(history.body.items.some(row=>row.valueState==="deleted")).toBe(true);
    const files=await requestJson<{items:{fileName:string}[]}>(server(),`/api/v1/projects/${B}/config-sets/${sets[B]}/files`);
    expect(files.body.items.map(row=>row.fileName)).toContain("private.json");
    expect(files.body.items.map(row=>row.fileName)).not.toContain("removable.dtsi");
    const readd=await post<Preview>(`${path(B)}/preview`,body);expect(readd.status,readd.bodyText).toBe(200);
    const restored=await post<Applied>(`${path(B)}/apply`,{...body,proofToken:readd.body.item.proofToken,reason:"Restore the same exact published source",clientMutationId:"remove-readd"});expect(restored.status,restored.bodyText).toBe(200);
    expect((await listCatalogBindingRowsForProject(api,admin,{projectId:B})).find(row=>row.rawValue==="<26>")?.id).toBe(removed.id);
    const root=(await requestJson<{items:{fileId:string;fileName:string;currentVersionId:string;role:string}[]}>(server(),`/api/v1/projects/${B}/config-sets/${sets[B]}/files`)).body.items.find(file=>file.role==="base")!;
    const original=await requestJson(server(),`/api/v1/projects/${B}/parameter-files/${root.fileId}/versions/${root.currentVersionId}/content`);
    const currentRemoval=await post<Preview>(`${path(B)}/preview`,remove);expect(currentRemoval.status,currentRemoval.bodyText).toBe(200);
    const candidate=await post<{item:{id:string}}>(`/api/v1/projects/${B}/parameter-file-candidates`,{fileId:root.fileId,fileName:root.fileName,intent:"source_revision",contentBase64:Buffer.from(original.bodyText+'\n/ { removable { compatible = "acme,power"; iin_max = <27>; }; };\n').toString("base64"),expectedCurrentVersionId:root.currentVersionId,expectedConfigRevisionId:restored.body.item.configRevisionId,clientMutationId:"removal-private-continuation"});expect(candidate.status,candidate.bodyText).toBe(201);
    const privatePreview=await requestJson<{item:SourceRevisionPreview}>(server(),`/api/v1/projects/${B}/parameter-file-candidates/${candidate.body.item.id}/source-preview`);expect(privatePreview.status,privatePreview.bodyText).toBe(200);
    const privateApplied=await post<Applied>(`/api/v1/projects/${B}/parameter-file-candidates/${candidate.body.item.id}/source-apply`,{expectedCurrentVersionId:root.currentVersionId,expectedProofToken:privatePreview.body.item.proofToken,reason:"Retain this value in project source",clientMutationId:"removal-private-continuation-apply"});expect(privateApplied.status,privateApplied.bodyText).toBe(200);
    expect((await post(`${path(B)}/apply`,{...remove,proofToken:currentRemoval.body.item.proofToken,reason:"Old absence proof must not delete a still-present property",clientMutationId:"removal-stale-absence"})).status).toBe(409);
    const retainedPreview=await post<Preview>(`${path(B)}/preview`,remove);expect(retainedPreview.status,retainedPreview.bodyText).toBe(200);
    expect(retainedPreview.body.item.sharedSwitch?.effective).toContainEqual(expect.objectContaining({node:"/removable",property:"iin_max",before:"<27>",after:"<27>",originAfter:"board.dts"}));
    const retainedApplied=await post<Applied>(`${path(B)}/apply`,{...remove,proofToken:retainedPreview.body.item.proofToken,reason:"Retain the project-owned value and original Binding",clientMutationId:"removal-retained-origin"});expect(retainedApplied.status,retainedApplied.bodyText).toBe(200);
    expect((await listCatalogBindingRowsForProject(api,admin,{projectId:B})).find(row=>row.rawValue==="<27>")?.id).toBe(removed.id);
  },120_000);
});
