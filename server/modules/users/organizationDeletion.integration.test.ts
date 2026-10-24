import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { seedBaselineAuthCatalog } from "../auth/baselineCatalog";
import { admitOrganizationDeletion as admitDeletion, previewOrganizationDeletion as readDeletion } from "./organizationDeletion";
import { getAuthContext } from "../auth/repository";
import { createUserInvocation } from "../auth/trustedInvocation";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../../testing/labRuntimeLogins";
import { randomBytes, randomUUID } from "node:crypto";
import { installPublishedReleaseA, SUBJECT_ID } from "../catalog-kernel/runtime/catalogChain.fixture";
import { writeGuardedRegistration } from "../parameter-governance/registration/internalGuardedRegistrationWriter";
import { CatalogSubjectId } from "../parameter-catalog-contract";
import { createXiaozeCheckpointer, type XiaozeCheckpointer } from "../agent/xiaoze/checkpointer";
import { createPostgresCheckpointerSaver } from "../agent/xiaoze/durableCheckpointer";

describe("Organization erasure preview through real HTTP and PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>, db: RootDatabase;
  let agentCheckpointer: XiaozeCheckpointer;
  const previewOrganizationDeletion = (...[connection, caller, id, context]: Parameters<typeof readDeletion>) =>
    readDeletion(connection, caller, id, { ...context, agentCheckpointer });
  const admitOrganizationDeletion = (...[connection, caller, id, version, context]: Parameters<typeof admitDeletion>) =>
    admitDeletion(connection, caller, id, version, { ...context, agentCheckpointer });
  beforeEach(async () => {
    agentCheckpointer = createXiaozeCheckpointer();
    database = await createEphemeralTestDatabase("erasurepreview"); db = createPostgresDatabase(database.url);
    await seedCoreGraph(db, { organization: { id: "preview-home", name: "Platform home" }, users: [{ id: "preview-platform" }] });
    await seedCoreGraph(db, { organization: { id: "preview-target", name: "Deletion target" }, users: [{ id: "preview-member" }, { id: "preview-inactive" }] });
    await seedBaselineAuthCatalog(db);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('preview-platform-role','preview-platform','preview-home','platform-admin'),('preview-member-role','preview-member','preview-target','admin')");
    await db.query("update users set is_active=false where id='preview-inactive'");
    await db.query("insert into projects(id,organization_id,name,code) values('preview-project','preview-target','Target project','PREVIEW'),('preview-foreign-project','preview-home','Keep project','KEEP')");
  });
  afterEach(async () => { await db?.close(); await database?.drop(); });
  const path = "/api/v1/platform/organizations/preview-target/deletion-preview";
  function request<T>(route = path, user = "preview-platform") {
    return requestJson<T>(createWiseEffServer({ db, agentCheckpointer }), route, { headers: { "x-wiseeff-user": user } });
  }
  it("returns a coherent readonly inventory including inactive accounts and preserves foreign data", async () => {
    const before = (await db.query("select (select count(*) from audit_events)::int audits,(select count(*) from users)::int users,(select count(*) from projects)::int projects")).rows;
    const result = await request<{ item: { organizationId: string; inventory: Array<{ key: string; count: number }>; notes: string[]; stateDigest: string } }>();
    expect(result.status, result.bodyText).toBe(200);
    expect(result.body.item.organizationId).toBe("preview-target");
    expect(result.body.item.inventory).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "public.users", count: 2 }), expect.objectContaining({ key: "public.projects", count: 1 })
    ]));
    expect(result.body.item.notes.join(" ")).toContain("备份");
    expect(result.body.item.stateDigest).toMatch(/^[a-f0-9]{64}$/);
    expect((await request<typeof result.body>()).body.item.stateDigest).toBe(result.body.item.stateDigest);
    expect((await db.query("select (select count(*) from audit_events)::int audits,(select count(*) from users)::int users,(select count(*) from projects)::int projects")).rows).toEqual(before);
  });
  it("rejects ordinary administrators and absent targets without exposing another organization", async () => {
    expect((await request(path, "preview-member")).status).toBe(403);
    expect((await request("/api/v1/platform/organizations/missing/deletion-preview")).status).toBe(404);
  });
  it("counts real private Catalog registrations through an API LOGIN without granting private table access", async () => {
    const pool = getRootPostgresPool(db)!;
    const { pinA } = await installPublishedReleaseA(pool);
    await db.query("insert into attribution_subjects(id,organization_id,subject_kind,display_name,source_key) values('preview-attribution','preview-target','driver-registration','Driver','compatible:acme,power')");
    await db.query("insert into driver_registrations(attribution_subject_id,driver_nature,instance_cardinality) values('preview-attribution','physical-device','multiple')");
    await db.query("insert into parameter_modules(id,organization_id,name,path,kind,sort_order,attribution_subject_id) values('preview-driver','preview-target','Driver','/driver','driver-group',0,'preview-attribution')");
    const writer = await pool.connect();
    try {
      await writer.query("begin");
      const result = await writeGuardedRegistration(writer, { kind: "register", organizationId: "preview-target", subjectId: CatalogSubjectId(SUBJECT_ID), subjectKind: "driver", expectedRelease: pinA,
        placement: { mode: "use-default" }, destinationModuleId: "preview-driver", method: "explicit", proof: { reason: "Organization impact" }, idempotencyKey: "preview-registration",
        context: { actorKind: "org-admin", principalId: "preview-member" } });
      expect(result.ok).toBe(true); await writer.query("commit");
    } catch (error) { await writer.query("rollback"); throw error; } finally { writer.release(); }
    const token = `preview${randomBytes(5).toString("hex")}`, runtime = await provisionPublicationRuntimeLogins(database.url, { mode: "lab", runToken: token });
    const api = createPostgresDatabase(runtime.apiUrl);
    try {
      expect((await api.query("select current_user as actor,session_user as login,rolsuper from pg_roles where rolname=current_user")).rows).toEqual([{ actor: runtime.apiRole, login: runtime.apiRole, rolsuper: false }]);
      const response = await requestJson<{ item: { inventory: Array<{ key: string; count: number }> } }>(createWiseEffServer({ db: api }), path, { headers: { "x-wiseeff-user": "preview-platform" } });
      expect(response.status, response.bodyText).toBe(200);
      expect(response.body.item.inventory).toContainEqual(expect.objectContaining({ key: "parameter_catalog.organization_subject_registrations", count: 1 }));
      expect((await api.query("select has_schema_privilege(current_user,'parameter_catalog','CREATE') as schema_write")).rows).toEqual([{ schema_write: false }]);
      await expect(api.query("update parameter_catalog.parameter_definitions set id=id where false")).rejects.toMatchObject({ code: "42501" });
      await expect(api.query("select * from parameter_catalog.preview_organization_deletion($1,$2)", ["preview-target", "preview-member"])).rejects.toMatchObject({ code: "42501" });
      expect((await db.query("select count(*)::int n from parameter_catalog.organization_subject_registrations where organization_id='preview-target'")).rows).toEqual([{ n: 1 }]);
    } finally { await api.close(); await dropLabRuntimeLogins(database.url, token); }
  });
  it("counts foreign-Home notification copies, shared object keys, and official runtime checkpoints without deleting any", async () => {
    await db.query("insert into log_file_objects(id,organization_id,storage_key,file_name,content_type,file_size_bytes,checksum_sha256) values('preview-object','preview-target','same-object','target.log','text/plain',5,'abc'),('preview-object-foreign','preview-home','same-object','keep.log','text/plain',5,'abc'),('preview-object-own','preview-target','own-object','own.log','text/plain',5,'abc')");
    const notification = randomUUID();
    await db.query("insert into user_notifications(id,organization_id,recipient_user_id,category,title,body,metadata) values($1,'preview-home','preview-platform','feedback','Target feedback','Target content',$2)", [notification, { feedbackOrganizationId: "preview-target", feedbackId: randomUUID() }]);
    await db.query("insert into agent_sessions(id,organization_id,actor_user_id,page_key,context,status,title) values('preview-thread','preview-target','preview-platform','organization','{}','active','Target thread'),('preview-foreign-thread','preview-home','preview-platform','organization','{}','active','Keep thread')");
    const handle = createPostgresCheckpointerSaver({ connectionString: database.url });
    const saver = handle.saver;
    agentCheckpointer = createXiaozeCheckpointer({ mode: "postgres", saver, withNamespaceLease: handle.withNamespaceLease, ensureReady: handle.ensureSetup });
    try {
      await saver.setup();
      for (const threadId of ["preview-target:preview-platform:preview-thread", "preview-home:preview-platform:preview-foreign-thread"]) await handle.withNamespaceLease(threadId, () => saver.put({ configurable: { thread_id: threadId, checkpoint_ns: "" } }, { v: 1, id: threadId, ts: new Date().toISOString(), channel_values: {}, channel_versions: {}, versions_seen: {} }, { source: "input", step: 0, parents: {} }, {}));
      const result = await request<{ item: { inventory: Array<{ key: string; count: number }>; storage: { exclusiveObjects: number; sharedObjects: number } } }>();
      expect(result.status, result.bodyText).toBe(200);
      expect(result.body.item.inventory).toEqual(expect.arrayContaining([expect.objectContaining({ key: "public.user_notifications", count: 1 }), expect.objectContaining({ key: "public.checkpoints", count: 1 })]));
      expect(result.body.item.storage).toEqual({ exclusiveObjects: 1, sharedObjects: 1 });
      expect((await db.query("select count(*)::int n from checkpoints")).rows).toEqual([{ n: 2 }]);
      expect((await db.query("select body from user_notifications where id=$1", [notification])).rows).toEqual([{ body: "Target content" }]);
    } finally { await saver.end(); }
  });
  it("rechecks persisted authority, changed counts, public registration and the last usable platform entry at admission", async () => {
    const actor = createUserInvocation(await getAuthContext(db, "preview-platform"));
    const preview = await previewOrganizationDeletion(db, actor, "preview-target");
    await db.query("insert into organization_teams(id,organization_id,name) values('preview-added','preview-target','Added later')");
    await expect(db.transaction(tx => admitOrganizationDeletion(tx, actor, "preview-target", preview.stateDigest))).rejects.toMatchObject({ code: "CONFLICT", details: { code: "organization-deletion-preview-stale" } });
    const fresh = await previewOrganizationDeletion(db, actor, "preview-target");
    await db.transaction(async tx => { expect((await admitOrganizationDeletion(tx, actor, "preview-target", fresh.stateDigest)).organizationId).toBe("preview-target"); });
    await db.query("update public_experience_registration set enabled=true,organization_id='preview-target' where singleton=true");
    const registration = await previewOrganizationDeletion(db, actor, "preview-target");
    expect(registration.blockers.map(item => item.code)).toContain("experience-registration");
    await expect(db.transaction(tx => admitOrganizationDeletion(tx, actor, "preview-target", registration.stateDigest))).rejects.toMatchObject({ code: "CONFLICT" });
    const home = await previewOrganizationDeletion(db, actor, "preview-home");
    expect(home.blockers.map(item => item.code)).toEqual(expect.arrayContaining(["last-platform-administrator", "actor-home-organization"]));
    await db.query("delete from user_role_bindings where user_id='preview-platform'");
    await expect(db.transaction(tx => admitOrganizationDeletion(tx, actor, "preview-target", registration.stateDigest))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await db.query("select count(*)::int n from organizations where id='preview-target'")).rows).toEqual([{ n: 1 }]);
  });
  it("does not count a pending OIDC identity as a surviving platform login", async () => {
    const caller = createUserInvocation(await getAuthContext(db, "preview-platform")), issuer = "https://preview-identity.example";
    await db.query("update user_oidc_identities set issuer=$1,subject=user_id,transfer_pending_since=clock_timestamp(),transfer_verified_at=null where user_id='preview-platform'", [issuer]);
    const preview = await previewOrganizationDeletion(db, caller, "preview-target", { authenticationProvider: "oidc", oidcIssuer: issuer });
    expect(preview.survivingPlatformAdministrators).toBe(0);
    expect(preview.blockers.map(item => item.code)).toContain("last-platform-administrator");
    await expect(db.transaction(tx => admitOrganizationDeletion(tx, caller, "preview-target", preview.stateDigest, { authenticationProvider: "oidc", oidcIssuer: issuer }))).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("fails closed on an unclassified organization-owned relation even when it is empty", async () => {
    await db.query("create table public.preview_unknown_owner(id text,organization_id text)");
    const caller = createUserInvocation(await getAuthContext(db, "preview-platform"));
    const preview = await previewOrganizationDeletion(db, caller, "preview-target");
    expect(preview.inventory).toContainEqual({ key: "public.preview_unknown_owner", category: "unclassified", count: 1 });
    expect(preview.blockers.map(item => item.code)).toContain("unclassified-ownership");
    await expect(db.transaction(tx => admitOrganizationDeletion(tx, caller, "preview-target", preview.stateDigest))).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("checks authority after a concurrent administrator mutation releases its serialization lock", async () => {
    const caller = createUserInvocation(await getAuthContext(db, "preview-platform")), preview = await previewOrganizationDeletion(db, caller, "preview-target");
    let release!: () => void, enter!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { enter = resolve; });
    const mutation = db.transaction(async tx => {
      await tx.query("select pg_advisory_xact_lock(hashtextextended('administrator-continuity',0))");
      await tx.query("delete from user_role_bindings where user_id='preview-platform'"); enter(); await held;
    });
    await entered;
    const admission = db.transaction(tx => admitOrganizationDeletion(tx, caller, "preview-target", preview.stateDigest));
    const denied = expect(admission).rejects.toMatchObject({ code: "FORBIDDEN" });
    release(); await mutation; await denied;
    expect((await db.query("select count(*)::int n from users where organization_id='preview-target'")).rows).toEqual([{ n: 2 }]);
  });
  it("keeps live heartbeats and progress usable while owned records, identity and shared files still invalidate impact", async () => {
    await db.query("insert into device_bridges(id,user_id,organization_id,machine_label,platform,arch,client_version) values('preview-live-bridge','preview-member','preview-target','Live device','linux','amd64','1')");
    await db.query("insert into jobs(id,organization_id,kind,target_type,target_id,status) values('preview-live-job','preview-target','preview','preview','preview','processing')");
    await db.query("insert into log_file_objects(id,organization_id,storage_key,file_name,content_type,file_size_bytes,checksum_sha256) values('preview-live-object','preview-target','live-key','live.log','text/plain',5,'abc')");
    const caller = createUserInvocation(await getAuthContext(db, "preview-platform"));
    const initial = await previewOrganizationDeletion(db, caller, "preview-target");
    await db.query("update device_bridges set last_seen_at=clock_timestamp() where id='preview-live-bridge'");
    await db.query("update users set last_active_at=clock_timestamp() where id='preview-member'");
    await db.query("update jobs set progress=50,current_stage='working',updated_at=clock_timestamp(),lease_owner='same-worker',lease_expires_at=clock_timestamp()+interval '1 minute' where id='preview-live-job'");
    expect((await previewOrganizationDeletion(db, caller, "preview-target")).stateDigest).toBe(initial.stateDigest);
    await db.transaction(tx => admitOrganizationDeletion(tx, caller, "preview-target", initial.stateDigest));
    const stale = (digest: string) => expect(db.transaction(tx => admitOrganizationDeletion(tx, caller, "preview-target", digest))).rejects.toMatchObject({ code: "CONFLICT", details: { code: "organization-deletion-preview-stale" } });
    await db.query("insert into organization_teams(id,organization_id,name) values('preview-impact-record','preview-target','Impact')");
    await stale(initial.stateDigest);
    const added = await previewOrganizationDeletion(db, caller, "preview-target");
    await db.query("delete from organization_teams where id='preview-impact-record'");
    await stale(added.stateDigest);
    const identity = await previewOrganizationDeletion(db, caller, "preview-target");
    await db.query("update users set is_active=false where id='preview-member'");
    await stale(identity.stateDigest);
    const file = await previewOrganizationDeletion(db, caller, "preview-target");
    await db.query("insert into log_file_objects(id,organization_id,storage_key,file_name,content_type,file_size_bytes,checksum_sha256) values('preview-live-foreign-object','preview-home','live-key','keep.log','text/plain',5,'abc')");
    await stale(file.stateDigest);
    expect((await previewOrganizationDeletion(db, caller, "preview-target")).storage).toEqual({ exclusiveObjects: 0, sharedObjects: 1 });
  });
  it("detects shared-file ownership changes even when both file counts stay unchanged", async () => {
    await db.query(`insert into log_file_objects(id,organization_id,storage_key,file_name,content_type,file_size_bytes,checksum_sha256) values
      ('preview-a','preview-target','a','a','text/plain',1,'a'),('preview-bc','preview-target','bc','bc','text/plain',1,'a'),
      ('preview-ab','preview-target','ab','ab','text/plain',1,'a'),('preview-c','preview-target','c','c','text/plain',1,'a'),
      ('preview-foreign-a','preview-home','a','a','text/plain',1,'a'),('preview-foreign-bc','preview-home','bc','bc','text/plain',1,'a')`);
    const caller = createUserInvocation(await getAuthContext(db, "preview-platform")), before = await previewOrganizationDeletion(db, caller, "preview-target");
    await db.query("update log_file_objects set storage_key=case id when 'preview-foreign-a' then 'ab' else 'c' end where organization_id='preview-home'");
    const after = await previewOrganizationDeletion(db, caller, "preview-target");
    expect(after.storage).toEqual(before.storage);
    await expect(db.transaction(tx => admitOrganizationDeletion(tx, caller, "preview-target", before.stateDigest))).rejects.toMatchObject({ code: "CONFLICT", details: { code: "organization-deletion-preview-stale" } });
  });
  it("retains global definition erasure work associated with an operator Home without adopting its foreign files", async () => {
    await db.query("insert into parameter_catalog.definition_erasures(definition_id,organization_id,erased_by,audit_event_id,pending_object_refs) values('preview-global-erasure','preview-target','preview-member','preview-global-audit',array['plane::foreign-global-key'])");
    await db.query("insert into log_file_objects(id,organization_id,storage_key,file_name,content_type,file_size_bytes,checksum_sha256) values('preview-global-foreign-file','preview-home','foreign-global-key','keep.log','text/plain',1,'a')");
    const caller = createUserInvocation(await getAuthContext(db, "preview-platform")), preview = await previewOrganizationDeletion(db, caller, "preview-target");
    expect(preview.inventory).toContainEqual({ key: "parameter_catalog.definition_erasures", category: "shared-references", count: 1 });
    expect(preview.storage).toEqual({ exclusiveObjects: 0, sharedObjects: 0 });
    expect(preview.admissionAvailable).toBe(true);
    await db.transaction(tx => admitOrganizationDeletion(tx, caller, "preview-target", preview.stateDigest));
    await db.query("update parameter_catalog.definition_erasures set organization_id=null where definition_id='preview-global-erasure'");
    expect((await db.query("select parameter_catalog.read_parameter_definition_erasure('preview-global-erasure') as receipt")).rows)
      .toEqual([{ receipt: expect.objectContaining({ definition_id: "preview-global-erasure", pending_object_refs: ["plane::foreign-global-key"] }) }]);
    expect((await db.query("select storage_key from log_file_objects where id='preview-global-foreign-file'")).rows).toEqual([{ storage_key: "foreign-global-key" }]);
  });
  it("compares real pending plane keys and private encrypted refs by store without adopting global custody", async () => {
    const { pinA } = await installPublishedReleaseA(getRootPostgresPool(db)!);
    await db.query("insert into parameter_specs(id,organization_id,source_kind,specification_key) values('typed-preview-spec','preview-target','manual','manual/typed-preview')");
    await db.query("insert into parameter_catalog.legacy_identities(id,source_system,source_kind,owner_scope_kind,owner_scope_id,source_id) values('typed-preview-identity','test','parameter-spec','organization','preview-target','typed-preview-spec')");
    await db.query("insert into parameter_catalog.parameter_catalog_cutover_runs(id,source_snapshot_fingerprint,target_artifact_sha,target_catalog_release_digest,migration_contract_version,plan_digest,current_phase,state) values('typed-preview-cutover','test',$1,$2,'v1','test','P0','planned')", ["a".repeat(40), pinA.digest]);
    await db.query(`insert into parameter_catalog.parameter_catalog_archives(id,legacy_identity_id,owner_scope_kind,owner_scope_id,r_class,reason,source_checksum,graph_checksum,encrypted_object_ref,protected_references,cutover_run_id,catalog_release_id,success_audit_ref,retain_until)
      values('typed-preview-archive','typed-preview-identity','organization','preview-target','R0','Typed preview','checksum','checksum','cipher-key','[]','typed-preview-cutover',$1,'test',now()+interval '1 day')`, [pinA.id]);
    await db.query("insert into log_file_objects(id,organization_id,storage_key,file_name,content_type,file_size_bytes,checksum_sha256) values('typed-plane-shared','preview-target','plane-key','shared.log','text/plain',1,'a'),('typed-plane-exclusive','preview-target','cipher-key','same-string.log','text/plain',1,'a')");
    await db.query("insert into parameter_catalog.definition_erasures(definition_id,organization_id,erased_by,audit_event_id,pending_object_refs) values('typed-global-receipt','preview-home','preview-platform','typed-global-audit',array['plane::plane-key','catalog::cipher-key'])");
    const preview = await previewOrganizationDeletion(db, createUserInvocation(await getAuthContext(db, "preview-platform")), "preview-target");
    expect(preview.storage).toEqual({ exclusiveObjects: 1, sharedObjects: 2 });
    expect((await db.query("select pending_object_refs from parameter_catalog.definition_erasures where definition_id='typed-global-receipt'")).rows)
      .toEqual([{ pending_object_refs: ["plane::plane-key", "catalog::cipher-key"] }]);
  });
  it("refuses admission when a global pending object has no verified store type, even outside the target", async () => {
    await db.query("insert into parameter_catalog.definition_erasures(definition_id,organization_id,erased_by,audit_event_id,pending_object_refs) values('untyped-global-receipt','preview-home','preview-platform','untyped-global-audit',array['untyped-global-key'])");
    const result = await request<{ item: { stateDigest: string; admissionAvailable: boolean; executionAvailable: boolean; inventory: Array<{ key: string; category: string; count: number }>; blockers: Array<{ code: string }> } }>();
    expect(result.status, result.bodyText).toBe(200);
    expect(result.body.item.inventory).toContainEqual({ key: "storage.unknown-global-reference", category: "unclassified", count: 1 });
    expect(result.body.item.blockers).toContainEqual(expect.objectContaining({ code: "unclassified-ownership" }));
    expect(result.body.item).toMatchObject({ admissionAvailable: false, executionAvailable: false });
    const caller = createUserInvocation(await getAuthContext(db, "preview-platform"));
    await expect(db.transaction(tx => admitOrganizationDeletion(tx, caller, "preview-target", result.body.item.stateDigest)))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect((await db.query("select pending_object_refs from parameter_catalog.definition_erasures where definition_id='untyped-global-receipt'")).rows).toEqual([{ pending_object_refs: ["untyped-global-key"] }]);
  });
  it.each(["preview-target", null])("reports retained global erasure provenance when its ledger Home differs from the audited organization (audit owner: %s)", async owner => {
    await db.query("insert into audit_events(id,organization_id,actor_user_id,actor_type,app,kind,action,severity,target_type,target_id,metadata,trace_id) values('foreign-global-proof',$1,'preview-platform','user','admin','definition-erasure','delete','info','parameter-definition','global-definition',$2,'foreign-global-trace')", [owner, { operatingOrganizationId: "preview-target" }]);
    await db.query("insert into parameter_catalog.definition_erasures(definition_id,organization_id,erased_by,audit_event_id) values('foreign-global-definition','preview-home','preview-platform','foreign-global-proof')");
    const preview = await previewOrganizationDeletion(db, createUserInvocation(await getAuthContext(db, "preview-platform")), "preview-target");
    expect(preview.inventory).toContainEqual({ key: "parameter_catalog.definition_erasure_audit_provenance", category: "shared-references", count: 1 });
    expect((await db.query("select organization_id,audit_event_id from parameter_catalog.definition_erasures where definition_id='foreign-global-definition'")).rows)
      .toEqual([{ organization_id: "preview-home", audit_event_id: "foreign-global-proof" }]);
  });
});
