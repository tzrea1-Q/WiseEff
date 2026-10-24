import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createLocalObjectStore, type ObjectStore } from "../logs/objectStore";
import { createXiaozeCheckpointer } from "../agent/xiaoze/checkpointer";
import { seedCoreGraph } from "../../testing/fixtures";
import { seedBaselineAuthCatalog } from "../auth/baselineCatalog";
import { makeTestAuthContext } from "../../testing/authContext";
import { installConfigurationSourceFixture } from "../../testing/parameterCatalog/configurationSource";
import { uploadProjectParameterFile } from "../parameter-files/service";
import { randomBytes } from "node:crypto";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../../testing/labRuntimeLogins";
import pg from "pg";
import { createArchiveAdapter, createLocalArchiveObjectStore, type ArchiveObjectStore } from "../catalog-cutover/archive";
import { applyParameterIdentityCutover } from "../parameter-topology/migration";
import { lowFacts, persistHandBuiltCandidate } from "../catalog-publication/authorization/testHarness";
import { DefinitionProposalId, DefinitionProposalRevisionId } from "../parameter-catalog-contract";
import { withPublicationCoordinator } from "../catalog-publication/coordinator";
import { claimPublicationJob } from "../catalog-publication/jobs/claim";
import { executeClaimedPublicationJob } from "../catalog-publication/jobs/execute";
import { createCatalogInstaller } from "../catalog-kernel/install/installer";
import { createUserInvocation } from "../auth/trustedInvocation";
import { getAuthContext } from "../auth/repository";

describe("Organization project/parameter erasure through HTTP and native PostgreSQL", () => {
  let lane: Awaited<ReturnType<typeof createEphemeralTestDatabase>>, db: ReturnType<typeof createPostgresDatabase>;
  let api: ReturnType<typeof createPostgresDatabase>, manager: ReturnType<typeof createPostgresDatabase>;
  const token = `org1395${randomBytes(5).toString("hex")}`;
  let directory: string, store: ObjectStore;
  let archiveStore: ArchiveObjectStore;
  const archiveKey = randomBytes(32);
  const agentCheckpointer = createXiaozeCheckpointer();
  beforeAll(async () => {
    lane = await createEphemeralTestDatabase("org1395"); db = createPostgresDatabase(lane.url);
    directory = await mkdtemp(join(tmpdir(), "org1395-objects-")); store = createLocalObjectStore(directory);
    archiveStore = createLocalArchiveObjectStore(join(directory, "catalog"));
    await seedCoreGraph(db, { organization: { id: "parameter-home" }, users: [{ id: "parameter-platform" }] });
    await seedCoreGraph(db, { organization: { id: "parameter-target" }, users: [{ id: "parameter-member" }] });
    await seedBaselineAuthCatalog(db);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('parameter-platform-role','parameter-platform','parameter-home','platform-admin')");
    await installConfigurationSourceFixture(db, makeTestAuthContext({ userId: "parameter-member", organizationId: "parameter-target", roleId: "admin" }),
      { subjectId: "csub_org1395", schemaId: "org1395.configuration" });
    const runtime = await provisionPublicationRuntimeLogins(lane.url, { mode: "lab", runToken: token });
    api = createPostgresDatabase(runtime.apiUrl);
    manager = createPostgresDatabase(runtime.managerUrl);
    expect((await api.query("select rolsuper from pg_roles where rolname=current_user")).rows).toEqual([{ rolsuper: false }]);
    await expect(api.query("delete from parameter_catalog.organization_parameter_erasure_objects where false")).rejects.toMatchObject({ code: "42501" });
  });
  afterAll(async () => { await api?.close(); await manager?.close(); if (lane) await dropLabRuntimeLogins(lane.url, token); await db?.close(); await lane?.drop(); if (directory) await rm(directory, { recursive: true, force: true }); });
  const target = "/api/v1/platform/organizations/parameter-target";
  function request<T>(path: string, method = "GET", body?: unknown, objectStore = store) {
    return requestJson<T>(createWiseEffServer({ db: api, objectStore, catalogArchiveStore: archiveStore, catalogArchiveKey: archiveKey, agentCheckpointer }), path,
      { method, headers: { "x-wiseeff-user": "parameter-platform" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  it("keeps completed domain progress when later management fails, then retries only unfinished work", async () => {
    // Real legacy cross-domain FK: knowledge must release its own reference
    // before the parameter adapter can remove this Organization Spec.
    await db.query("insert into parameter_specs(id,organization_id,source_kind,specification_key,definition_lifecycle) values('parameter-knowledge-spec','parameter-target','manual','parameter-knowledge-spec','active')");
    await db.query("insert into knowledge_entries(id,organization_id,title,content_form) values('00000000-0000-4000-8000-000000001395','parameter-target','Legacy parameter reference','markdown')");
    await db.query("insert into knowledge_parameter_references(id,organization_id,entry_id,parameter_spec_id,created_by_user_id) values('00000000-0000-4000-8000-000000001396','parameter-target','00000000-0000-4000-8000-000000001395','parameter-knowledge-spec','parameter-member')");
    await db.query("insert into projects(id,organization_id,name,code) values('parameter-project','parameter-target','Erase project','ERASE')");
    await db.query("insert into organization_teams(id,organization_id,name) values('parameter-team','parameter-target','Erase team')");
    await db.query(`create function fail_parameter_management() returns trigger language plpgsql as $$ begin raise exception 'temporary management failure'; end $$;
      create trigger parameter_management_failure before delete on organization_teams for each row execute function fail_parameter_management()`);
    const preview = await request<{ item: { stateDigest: string } }>(`${target}/deletion-preview`);
    expect(preview.status, preview.bodyText).toBe(200);
    const started = await request<{ item: { id: string; status: string; domains: Record<string, { status: string; attempts: number }> } }>(`${target}/deletions`, "POST",
      { stateDigest: preview.body.item.stateDigest, confirmationOrganizationId: "parameter-target" });
    expect(started.status, started.bodyText).toBe(202);
    expect(started.body.item.status).toBe("failed");
    expect(started.body.item.domains["projects-parameters"]).toMatchObject({ status: "complete", attempts: 1 });
    expect((await db.query("select id from projects where id='parameter-project'")).rows).toEqual([]);
    expect((await db.query("select id from knowledge_parameter_references where parameter_spec_id='parameter-knowledge-spec'")).rows).toEqual([]);
    await db.query("drop trigger parameter_management_failure on organization_teams");
    const retried = await request<typeof started.body>(`/api/v1/platform/organization-deletions/${started.body.item.id}/retry`, "POST");
    expect(retried.status, retried.bodyText).toBe(200);
    expect(retried.body.item.status).toBe("deleted");
    expect(retried.body.item.domains).toEqual({});
    expect((await db.query("select id from parameter_catalog.parameter_definitions where id='pdef_acme_power_iin_max'")).rows).toHaveLength(1);
  });
  it("retains durable object obligations across store failure and a fresh server retry", async () => {
    const org = "parameter-objects", project = "parameter-object-project";
    await seedCoreGraph(db, { organization: { id: org }, users: [{ id: "parameter-object-member" }] });
    await db.query("insert into projects(id,organization_id,name,code) values($1,$2,'Source project','OBJECTS')", [project, org]);
    const uploaded = await uploadProjectParameterFile(db, store, makeTestAuthContext({ userId: "parameter-object-member", organizationId: org, roleId: "admin" }),
      { projectId: project, fileName: "settings.json", bytes: Buffer.from('{"limit":42}') });
    const path = `/api/v1/platform/organizations/${org}`;
    const preview = await request<{ item: { stateDigest: string } }>(`${path}/deletion-preview`);
    const started = await request<{ item: { id: string; status: string; domains: Record<string, { status: string; attempts: number }> } }>(`${path}/deletions`, "POST",
      { stateDigest: preview.body.item.stateDigest, confirmationOrganizationId: org }, { ...store, delete: async () => { throw new Error("isolated storage offline"); } });
    expect(started.status, started.bodyText).toBe(202);
    expect(started.body.item).toMatchObject({ status: "failed", domains: { "projects-parameters": { status: "failed" } } });
    expect((await db.query("select id from projects where id=$1", [project])).rows).toEqual([]);
    expect((await store.get(uploaded.version.storageKey)).toString()).toBe('{"limit":42}');
    const retried = await request<typeof started.body>(`/api/v1/platform/organization-deletions/${started.body.item.id}/retry`, "POST");
    expect(retried.body.item.status, retried.body).toBe("deleted");
    await expect(store.get(uploaded.version.storageKey)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("keeps global Definition cleanup discoverable after its original account and Home vanish", async () => {
    const org = "parameter-old-home", operator = "parameter-old-operator";
    await seedCoreGraph(db, { organization: { id: org }, users: [{ id: operator }] });
    const object = await store.put({ organizationId: "parameter-home", fileName: "global-old-archive.json", contentType: "application/json", bytes: Buffer.from("old global archive") });
    await db.query(`insert into parameter_catalog.definition_erasures(definition_id,organization_id,erased_by,audit_event_id,pending_object_refs)
      values('global-erased-definition',$1,$2,'global-erasure-proof',array[$3])`, [org, operator, `plane::${object.storageKey}`]);
    const path = `/api/v1/platform/organizations/${org}`;
    const preview = await request<{ item: { stateDigest: string } }>(`${path}/deletion-preview`);
    const started = await request<{ item: { status: string } }>(`${path}/deletions`, "POST", { stateDigest: preview.body.item.stateDigest, confirmationOrganizationId: org });
    expect(started.status, started.bodyText).toBe(202); expect(started.body.item.status).toBe("deleted");
    expect((await db.query("select id from users where id=$1", [operator])).rows).toEqual([]);
    const list = await request<{ items: { definitionId: string; pendingObjectCount: number }[] }>("/api/v2/catalog/definition-erasures");
    expect(list.status, list.bodyText).toBe(200); expect(list.body.items).toContainEqual(expect.objectContaining({ definitionId: "global-erased-definition", pendingObjectCount: 1 }));
    const retry = await request("/api/v2/catalog/definition-erasures/global-erased-definition/retry-cleanup", "POST");
    expect(retry.status, retry.bodyText).toBe(200);
    expect((await db.query("select organization_id,pending_object_refs,erased_by,audit_event_id from parameter_catalog.definition_erasures where definition_id='global-erased-definition'")).rows)
      .toEqual([{ organization_id: null, pending_object_refs: [], erased_by: operator, audit_event_id: "global-erasure-proof" }]);
    await expect(store.get(object.storageKey)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("tracks a committed uncertain put and prevents its late metadata from surviving erasure", async () => {
    const org = "parameter-late", project = "parameter-late-project";
    await seedCoreGraph(db, { organization: { id: org }, users: [{ id: "parameter-late-member" }] });
    await db.query("insert into projects(id,organization_id,name,code) values($1,$2,'Late upload project','LATE')", [project, org]);
    let entered!: () => void, release!: () => void;
    const uploading = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    let key = "";
    const uncertainStore: ObjectStore = { ...store, async put(input) {
      const object = await store.put(input); key = object.storageKey; entered(); await gate;
      throw new Error("Object committed but acknowledgement is uncertain");
    } };
    const writer = request(`/api/v1/projects/${project}/parameter-file-candidates?organizationId=${org}`, "POST", {
      fileName: "late.json", contentBase64: Buffer.from('{"limit":99}').toString("base64")
    }, uncertainStore);
    await Promise.race([uploading, writer.then(response => { throw new Error(`Upload did not enter IO: ${response.status} ${response.bodyText}`); })]);
    const path = `/api/v1/platform/organizations/${org}`;
    const preview = await request<{ item: { stateDigest: string } }>(`${path}/deletion-preview`);
    const erasing = request<{ item: { status: string } }>(`${path}/deletions`, "POST", { stateDigest: preview.body.item.stateDigest, confirmationOrganizationId: org });
    try {
      expect((await db.query("select count(*)::int n from parameter_object_writes where organization_id=$1", [org])).rows).toEqual([{ n: 1 }]);
    } finally { release(); }
    expect((await writer).status).toBe(500);
    const erased = await erasing; expect(erased.status, erased.bodyText).toBe(202); expect(erased.body.item.status).toBe("deleted");
    await expect(store.get(key)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await db.query("select id from project_parameter_file_candidates where organization_id=$1", [org])).rows).toEqual([]);
  });
  it("cleans an uncertain encrypted archive write while preserving global migration and shared Catalog proof", async () => {
    const org = "parameter-archive", identity = "legacy-parameter-archive", run = "org1395-cutover-run";
    await seedCoreGraph(db, { organization: { id: org }, users: [{ id: "archive-member" }] });
    const release = (await db.query<{ id: string; digest: string }>(`select r.id,r.release_digest digest from parameter_catalog.catalog_state s join parameter_catalog.catalog_releases r on r.id=s.current_catalog_release_id where s.singleton`)).rows[0]!;
    await db.query("insert into public.parameter_specs(id,organization_id,source_kind,specification_key,definition_lifecycle) values('org1395-source-spec',$1,'manual','org1395-archive','active')", [org]);
    await db.query("insert into parameter_catalog.legacy_identities(id,source_system,source_kind,owner_scope_kind,owner_scope_id,source_id) values($1,'wiseeff-v1','parameter-spec','organization',$2,'org1395-source-spec')", [identity, org]);
    await db.query(`insert into parameter_catalog.parameter_catalog_cutover_runs(id,source_snapshot_fingerprint,target_artifact_sha,target_catalog_release_digest,migration_contract_version,plan_digest,current_phase,state)
      values($1,'sha256:org1395-snapshot','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',$2,'v1','sha256:org1395-plan','P10','running')`, [run, release.digest]);
    const client = new pg.Client({ connectionString: lane.url }); await client.connect();
    let key = "";
    try {
      await client.query("set role catalog_migration_owner");
      const archive = createArchiveAdapter({ client, encryptionKey: archiveKey, objectStore: { ...archiveStore, async putExclusive(ref, bytes) {
        await archiveStore.putExclusive(ref, bytes); key = ref; throw new Error("Ciphertext committed, response unknown");
      } } });
      const command = { actor: { role: "cutover-operator" as const, auditRef: "org1395-archive-audit" }, legacyIdentityId: identity,
        ownerScopeId: org, reason: "erase owned archive",
        sourceGraph: { sourcePayload: { kind: "legacy-row", cls: "R7", disposition: "archived" }, relationGraph: { edges: [] } },
        protectedReferences: [{ kind: "legacy-identity" as const, id: identity }], cutoverRunId: run, catalogReleaseId: release.id,
        successAuditRef: "org1395-archive-audit", retainUntil: new Date("2027-09-03T00:00:00Z"), rClass: "R7" as const, ownerScopeKind: "organization" as const };
      const result = await archive.persistArchive(command);
      expect(result.ok).toBe(false); expect(key).not.toBe(""); expect(await archiveStore.exists(key)).toBe(true);
      const committed = await createArchiveAdapter({ client, encryptionKey: archiveKey, objectStore: archiveStore }).persistArchive(command);
      expect(committed.ok).toBe(true);
    } finally { await client.end(); }
    const path = `/api/v1/platform/organizations/${org}`;
    const preview = await request<{ item: { stateDigest: string } }>(`${path}/deletion-preview`);
    const erased = await request<{ item: { status: string } }>(`${path}/deletions`, "POST", { stateDigest: preview.body.item.stateDigest, confirmationOrganizationId: org });
    expect(erased.status, erased.bodyText).toBe(202); expect(erased.body.item.status).toBe("deleted");
    expect(await archiveStore.exists(key)).toBe(false);
    expect((await db.query("select id from parameter_catalog.legacy_identities where id=$1", [identity])).rows).toEqual([]);
    expect((await db.query("select id from parameter_catalog.parameter_catalog_archives where legacy_identity_id=$1", [identity])).rows).toEqual([]);
    expect((await db.query("select id from parameter_catalog.parameter_catalog_cutover_runs where id=$1", [run])).rows).toEqual([{ id: run }]);
    expect((await db.query("select id from parameter_catalog.catalog_releases where id=$1", [release.id])).rows).toEqual([{ id: release.id }]);
  });
  it("retains actual plane-prefixed global pending keys shared with target sources until platform cleanup", async () => {
    const org = "parameter-shared", project = "parameter-shared-project";
    await seedCoreGraph(db, { organization: { id: org }, users: [{ id: "parameter-shared-member" }] });
    await db.query("insert into projects(id,organization_id,name,code) values($1,$2,'Shared source','SHARED')", [project, org]);
    const uploaded = await uploadProjectParameterFile(db, store, makeTestAuthContext({ userId: "parameter-shared-member", organizationId: org, roleId: "admin" }),
      { projectId: project, fileName: "shared.json", bytes: Buffer.from('{"shared":true}') });
    await db.query(`insert into parameter_catalog.definition_erasures(definition_id,organization_id,erased_by,audit_event_id,pending_object_refs)
      values('shared-global-definition',$1,'parameter-shared-member','shared-global-proof',array[$2])`, [org, `plane::${uploaded.version.storageKey}`]);
    const path = `/api/v1/platform/organizations/${org}`;
    const preview = await request<{ item: { stateDigest: string; storage: { sharedObjects: number } } }>(`${path}/deletion-preview`);
    expect(preview.body.item.storage.sharedObjects).toBe(1);
    const erased = await request<{ item: { status: string } }>(`${path}/deletions`, "POST", { stateDigest: preview.body.item.stateDigest, confirmationOrganizationId: org },
      { ...store, delete: async () => { throw new Error("This shared key must not be deleted by Organization cleanup"); } });
    expect(erased.status, erased.bodyText).toBe(202); expect(erased.body.item.status).toBe("deleted");
    expect((await store.get(uploaded.version.storageKey)).toString()).toBe('{"shared":true}');
    expect((await request("/api/v2/catalog/definition-erasures/shared-global-definition/retry-cleanup", "POST")).status).toBe(200);
    await expect(store.get(uploaded.version.storageKey)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("uses actual renamed legacy tables on a prepared finalized-cutover upgrade", async () => {
    const org = "parameter-upgraded", project = "parameter-upgraded-project";
    await seedCoreGraph(db, { organization: { id: org }, users: [{ id: "parameter-upgraded-member" }] });
    await db.query("insert into projects(id,organization_id,name,code) values($1,$2,'Upgraded project','UPGRADE')", [project, org]);
    await db.query("insert into parameter_specs(id,organization_id,source_kind,specification_key,definition_lifecycle) values('upgraded-spec',$1,'manual','upgraded-spec','active')", [org]);
    await db.query("insert into project_parameter_bindings(id,organization_id,project_id,parameter_spec_id) values('upgraded-binding',$1,$2,'upgraded-spec')", [org, project]);
    await db.query("insert into parameter_definitions(id,organization_id,name,description,explanation,config_format,module,default_range,unit,risk) values('upgraded-definition',$1,'Legacy private definition','Private legacy description','Private explanation','json','upgrade','0-10','V','Low')", [org]);
    await db.query("insert into project_parameter_values(id,organization_id,project_id,parameter_definition_id,current_value,recommended_value) values('upgraded-value',$1,$2,'upgraded-definition','private old value','private old recommendation')", [org, project]);
    await db.query("insert into legacy_parameter_migration_evidence(id,organization_id,legacy_kind,legacy_id,project_parameter_binding_id) values('upgraded-evidence',$1,'project_parameter_value','upgraded-value','upgraded-binding')", [org]);
    // Prepared historical state; run the real atomic cutover, rather than
    // imitating renamed tables or claiming this fixture ran a migration review.
    await db.query("insert into parameter_identity_migration_runs(id,mode,status,report) values('org1395-finalized','apply','finalized','{}')");
    await db.query("insert into parameter_identity_migration_phases(id,migration_run_id,phase,status,report) values('org1395-finalized-phase','org1395-finalized','finalize','finalized','{}')");
    await applyParameterIdentityCutover(db, { migrationRunId: "org1395-finalized" });
    expect((await db.query("select current_value from legacy_project_parameter_values where id='upgraded-value'")).rows).toEqual([{ current_value: "private old value" }]);
    const path = `/api/v1/platform/organizations/${org}`;
    const preview = await request<{ item: { stateDigest: string; inventory: { key: string; count: number }[] } }>(`${path}/deletion-preview`);
    expect(preview.status, preview.bodyText).toBe(200);
    expect(preview.body.item.inventory).toContainEqual(expect.objectContaining({ key: "public.legacy_parameter_definitions", count: 1 }));
    const erased = await request<{ item: { status: string } }>(`${path}/deletions`, "POST", { stateDigest: preview.body.item.stateDigest, confirmationOrganizationId: org });
    expect(erased.status, erased.bodyText).toBe(202); expect(erased.body.item.status).toBe("deleted");
    expect((await db.query("select id from legacy_parameter_definitions where organization_id=$1", [org])).rows).toEqual([]);
    expect((await db.query("select id from legacy_project_parameter_values where organization_id=$1", [org])).rows).toEqual([]);
  });
  it("keeps global cleanup pending while a separately committed parameter write still owns its exact key", async () => {
    const object = await store.put({ organizationId: "parameter-home", fileName: "pending-custody.json", contentType: "application/json", bytes: Buffer.from("pending parameter write") });
    const reservation = (await api.query<{ id: string }>("select parameter_catalog.reserve_parameter_object_write($1,$2) id", ["parameter-home", object.storageKey])).rows[0]!.id;
    await db.query(`insert into parameter_catalog.definition_erasures(definition_id,organization_id,erased_by,audit_event_id,pending_object_refs)
      values('global-pending-custody','parameter-home','removed-operator','global-pending-custody-proof',array[$1])`, [`plane::${object.storageKey}`]);
    const retry = () => request("/api/v2/catalog/definition-erasures/global-pending-custody/retry-cleanup", "POST");
    expect((await retry()).status).toBe(409);
    expect((await store.get(object.storageKey)).toString()).toBe("pending parameter write");
    expect((await db.query("select cardinality(pending_object_refs) n from parameter_catalog.definition_erasures where definition_id='global-pending-custody'")).rows).toEqual([{ n: 1 }]);
    await db.query("delete from public.parameter_object_writes where id=$1", [reservation]);
    expect((await retry()).status).toBe(200);
    await expect(store.get(object.storageKey)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("erases the private proposal cycle but retains the immutable Candidate and original approval tuple", async () => {
    const org = "parameter-proposal";
    await seedCoreGraph(db, { organization: { id: org }, users: [{ id: "proposal-member" }] });
    await db.transaction(async tx => {
      await tx.query(`insert into parameter_catalog.definition_proposals(id,organization_id,author_principal_id,base_catalog_release_id,status,current_proposal_revision_id,etag_version)
        select 'org1395-proposal',$1,'proposal-member',current_catalog_release_id,'submitted','org1395-proposal-revision',1 from parameter_catalog.catalog_state where singleton`, [org]);
      await tx.query("insert into parameter_catalog.definition_proposal_revisions(id,proposal_id,revision_number,payload,reason,evidence_refs) values('org1395-proposal-revision','org1395-proposal',1,'{}','private authored proposal','[]')");
    });
    const client = new pg.Client({ connectionString: lane.url }); await client.connect();
    try {
      await persistHandBuiltCandidate(client, { token: "org1395_proposal", authorPrincipalId: "proposal-member", authorOrganizationId: org, impactFacts: lowFacts("proposal-member"),
        proposalId: DefinitionProposalId("org1395-proposal"), proposalRevisionId: DefinitionProposalRevisionId("org1395-proposal-revision") });
    } finally { await client.end(); }
    await db.query(`insert into catalog_publication.publication_authorizations(id,event_kind,candidate_id,artifact_digest,expected_base_release_id,expected_base_release_digest,proposal_revision_id,impact_report_digest,capability_contract_digest,policy_revision,actor_principal_id)
      select 'cauth_org1395_proposal','approve',id,artifact_digest,expected_base_release_id,expected_base_release_digest,proposal_revision_id,impact_report_digest,catalog_publication.digest_jsonb(capability_contract),1,'parameter-platform'
      from catalog_publication.candidates where id='ccand_org1395_proposal'`);
    await db.query(`insert into catalog_publication.publication_jobs(id,candidate_id,authorization_id,request_scope,idempotency_key,request_digest,status)
      select 'cjob_org1395_proposal',id,'cauth_org1395_proposal','org1395-publication','org1395-publication',artifact_digest,'queued' from catalog_publication.candidates where id='ccand_org1395_proposal'`);
    const before = (await db.query("select * from catalog_publication.publication_authorizations where id='cauth_org1395_proposal'")).rows;
    const claimed = await withPublicationCoordinator(manager, tx => claimPublicationJob(tx, { leaseOwner: "org1395-manager", leaseSeconds: 30 }));
    expect(claimed.ok).toBe(true); if (!claimed.ok) throw new Error("Expected real publication worker claim");
    const pointer = (await db.query("select current_catalog_release_id from parameter_catalog.catalog_state where singleton")).rows;
    let entered!: () => void, release!: () => void;
    const preparing = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const pool = getRootPostgresPool(manager)!;
    const worker = executeClaimedPublicationJob({ db: manager, pool, installer: createCatalogInstaller(pool), claimed: claimed.value,
      retryBudget: 2, resolvePublisherActor: async () => { entered(); await gate; return createUserInvocation(await getAuthContext(db, "parameter-platform")); } });
    await Promise.race([preparing, worker.then(result => { throw new Error(`Claimed worker did not prepare: ${result.kind}`); })]);
    const path = `/api/v1/platform/organizations/${org}`;
    try {
      const preview = await request<{ item: { stateDigest: string; blockers: unknown[] } }>(`${path}/deletion-preview`);
      expect(preview.body.item.blockers).toEqual([]);
      const erased = await request<{ item: { status: string } }>(`${path}/deletions`, "POST", { stateDigest: preview.body.item.stateDigest, confirmationOrganizationId: org });
      expect(erased.status, erased.bodyText).toBe(202); expect(erased.body.item.status).toBe("deleted");
    } finally { release(); }
    expect(await worker).toMatchObject({ kind: "stale-fence", job: { status: "cancelled", fencingToken: claimed.value.fencingToken + 1 } });
    expect((await db.query("select current_catalog_release_id from parameter_catalog.catalog_state where singleton")).rows).toEqual(pointer);
    expect((await db.query("select id from parameter_catalog.catalog_activation_receipts where publication_job_id='cjob_org1395_proposal'")).rows).toEqual([]);
    expect((await db.query("select id from parameter_catalog.definition_proposals where organization_id=$1", [org])).rows).toEqual([]);
    expect((await db.query("select proposal_id,proposal_revision_id from catalog_publication.candidates where id='ccand_org1395_proposal'")).rows).toEqual([{ proposal_id: null, proposal_revision_id: null }]);
    expect((await db.query("select * from catalog_publication.publication_authorizations where id='cauth_org1395_proposal'")).rows).toEqual(before);
    expect((await db.query("select event_kind,approved_authorization_id,proposal_revision_id from catalog_publication.publication_authorizations where approved_authorization_id='cauth_org1395_proposal'")).rows)
      .toEqual([{ event_kind: "revoke", approved_authorization_id: "cauth_org1395_proposal", proposal_revision_id: "org1395-proposal-revision" }]);
    expect((await db.query("select status from catalog_publication.publication_jobs where id='cjob_org1395_proposal'")).rows).toEqual([{ status: "cancelled" }]);
  });
  it("keeps a mixed encrypted graph incomplete and blocks a foreign archive protecting the target", async () => {
    const org = "parameter-mixed-archive", foreign = "parameter-foreign-archive";
    for (const id of [org, foreign]) {
      await seedCoreGraph(db, { organization: { id }, users: [{ id: `${id}-member` }] });
      await db.query("insert into parameter_specs(id,organization_id,source_kind,specification_key,definition_lifecycle) values($1,$2,'manual',$1,'active')", [`${id}-spec`, id]);
      await db.query("insert into parameter_catalog.legacy_identities(id,source_system,source_kind,owner_scope_kind,owner_scope_id,source_id) values($1,'wiseeff-v1','parameter-spec','organization',$2,$3)", [`${id}-identity`, id, `${id}-spec`]);
    }
    await db.query("insert into parameter_specs(id,organization_id,source_kind,specification_key,definition_lifecycle) values('mixed-target-spec',$1,'manual','mixed-target-spec','active')", [org]);
    const release = (await db.query<{ id: string }>("select current_catalog_release_id id from parameter_catalog.catalog_state where singleton")).rows[0]!.id;
    const client = new pg.Client({ connectionString: lane.url }); await client.connect();
    let mixedRef = "";
    try {
      await client.query("set role catalog_migration_owner");
      const archive = createArchiveAdapter({ client, encryptionKey: archiveKey, objectStore: archiveStore });
      const mixed = await archive.persistArchive({ actor: { role: "cutover-operator", auditRef: "org1395-mixed-audit" }, legacyIdentityId: `${org}-identity`,
        ownerScopeKind: "organization", ownerScopeId: org, rClass: "R7", reason: "mixed graph fixture", sourceGraph: {
          sourcePayload: { kind: "legacy-row", cls: "R7", disposition: "archived" },
          relationGraph: { edges: [{ from: `${org}-identity`, to: "pdef_acme_power_iin_max", kind: "unowned-global-proof" }] } },
        protectedReferences: [{ kind: "legacy-identity", id: `${org}-identity` }], cutoverRunId: "org1395-cutover-run", catalogReleaseId: release,
        successAuditRef: "org1395-mixed-audit", retainUntil: new Date("2027-09-03T00:00:00Z") });
      expect(mixed.ok).toBe(true); if (mixed.ok) mixedRef = mixed.value.encryptedObjectRef;
      const path = `/api/v1/platform/organizations/${org}`;
      const preview = await request<{ item: { stateDigest: string } }>(`${path}/deletion-preview`);
      const erased = await request<{ item: { status: string; domains: Record<string, { status: string }> } }>(`${path}/deletions`, "POST", { stateDigest: preview.body.item.stateDigest, confirmationOrganizationId: org });
      expect(erased.status, erased.bodyText).toBe(202); expect(erased.body.item).toMatchObject({ status: "failed", domains: { "projects-parameters": { status: "failed" } } });
      expect(await archiveStore.exists(mixedRef)).toBe(true);
      expect((await db.query("select id from parameter_specs where id='mixed-target-spec'")).rows).toHaveLength(1);
      const retained = await archive.persistArchive({ actor: { role: "cutover-operator", auditRef: "org1395-foreign-audit" }, legacyIdentityId: `${foreign}-identity`,
        ownerScopeKind: "organization", ownerScopeId: foreign, rClass: "R7", reason: "foreign protected graph fixture",
        sourceGraph: { sourcePayload: { kind: "legacy-row", cls: "R7", disposition: "archived" }, relationGraph: { edges: [] } },
        protectedReferences: [{ kind: "parameter-spec", id: "mixed-target-spec" }], cutoverRunId: "org1395-cutover-run", catalogReleaseId: release,
        successAuditRef: "org1395-foreign-audit", retainUntil: new Date("2027-09-03T00:00:00Z") });
      expect(retained.ok).toBe(true);
      const blocked = await request<{ item: { blockers: { code: string }[] } }>(`${path}/deletion-preview`);
      expect(blocked.body.item.blockers).toContainEqual(expect.objectContaining({ code: "unclassified-ownership" }));
    } finally { await client.end(); }
  });
});
