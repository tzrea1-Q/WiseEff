import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { migrationsDir, withTempDatabase } from "../../testing/tempDatabase";
import { applyMigrations } from "../../shared/database/migrations";
import { makeTestAuthContext } from "../../testing/authContext";
import { captureConfigurationSourceState, installConfigurationSourceFixture, seedMixedRevisionCohortProbe } from "../../testing/parameterCatalog/configurationSource";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createLocalObjectStore } from "../logs/objectStore";
import { createUserInvocation } from "../auth/trustedInvocation";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { asValueClient, listCatalogBindingRowsForProject, loadPublishedCatalog, readCanonicalBindingChangeHistory } from "../parameter-bindings/catalogProjectValueSync";
import { casCurrentTip, insertProjectValue, loadProjectValueById } from "../parameter-bindings/values/repositories";
import { loadOwnedProjectValueSourcePin } from "../parameter-bindings/values";
import { loadCanonicalSourceSnapshot, preparePinnedSourceChange } from "./canonicalSource";
import { registerCanonicalJsonSource } from "./canonicalJsonSource";
import { uploadProjectParameterFile } from "./service";
import { getProjectParameterFileById, insertFileVersion } from "./repository";
import { applyImportBatch as applyLegacyImportBatch } from "../parameters/service";
import { commitCanonicalSourceRevision } from "./canonicalSourceCommit";
import { addConfigSetFile, createConfigSet } from "./configSetService";
import { createCanonicalValueDraft, listCanonicalValueDraftsForUser } from "../parameter-bindings/drafts/service";
import { submitCanonicalValueChange, reviewCanonicalValueChange } from "../parameter-bindings/drafts/changeService";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { registerCatalogProjectValueConsumerRoutes } from "../parameter-bindings/catalogProjectValueRoutes";
import { createWiseEffServer } from "../../app";
import { createLocalAuthService } from "../auth/localAuth";
import { hashLocalAccountPassword } from "../auth/localAccountCredentials";
import { catalogBindingExportResponseSchema, catalogValueChangeRequestResponseSchema, catalogValueChangeSourceDiffResponseSchema, projectValueDraftListResponseSchema } from "../contracts/dtoSchemas/parameterCatalog";

const ORG = "org-t11-json";
const PROJECT = "project-t11-json";
const USER = "user-t11-json";
const SUBJECT = "csub_t11_json";
const MODEL = "wiseeff.t11.limits";
const DEFINITION = "pdef_acme_power_iin_max";
const SOURCE = '{ "a/b":{"":{"limit":36.5,"enabled":false}}, "untouched":[1,2] }\n';

it("atomically refuses an existing incorrect JSON root digest when upgrading 0152", async () => {
  await withTempDatabase({ prefix: "json_digest_upgrade",migrate: false },async ({ db: migrationDb,connectionString }) => {
    await applyMigrations(migrationDb,migrationsDir,{ through: "0152_pinned_source_graph_immutability.sql" });
    const db = createPostgresDatabase(connectionString);
    try {
      await db.query("insert into organizations(id,name) values ($1,'Digest upgrade')",[ORG]);
      await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Digest author','Admin',true)",[USER,ORG]);
      await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'Digest project','DUP','initialized')",[PROJECT,ORG]);
      const auth = makeTestAuthContext({ userId: USER,organizationId: ORG,permissions: ["parameter:view","parameter:edit","admin:access"] });
      await installConfigurationSourceFixture(db,auth,{ subjectId: SUBJECT,schemaId: MODEL });
      const set = await createConfigSet(db,auth,{ projectId: PROJECT,name: "Digest upgrade" });
      await db.query(`insert into project_parameter_files(id,organization_id,project_id,file_name,format,config_set_id,config_set_role)
        values ('digest-upgrade-file',$1,$2,'settings.json','json',$3,'base')`,[ORG,PROJECT,set.id]);
      await db.query(`insert into parameter_catalog.project_parameter_source_occurrences
        (id,organization_id,project_id,config_set_id,file_id,occurrence_kind,configuration_instance_id,configuration_schema_subject_id,root_pointer,root_pointer_digest)
        values ('digest-upgrade',$1,$2,$3,'digest-upgrade-file','json','digest-instance',$4,'/温度',$5)`,
      [ORG,PROJECT,set.id,SUBJECT,`sha256:${"0".repeat(64)}`]);
      const before = (await db.query("select * from parameter_catalog.project_parameter_source_occurrences")).rows;
      await expect(applyMigrations(migrationDb,migrationsDir)).rejects.toMatchObject({ code: "23514" });
      expect((await db.query("select * from parameter_catalog.project_parameter_source_occurrences")).rows).toEqual(before);
      expect((await db.query("select name from schema_migrations where name like '0153%'")).rows).toEqual([]);
      expect((await db.query(`select conname from pg_constraint where conname='project_parameter_source_occurrence_root_digest_ck'`)).rows).toEqual([]);
    } finally { await db.close(); }
  });
},120_000);

describe("canonical JSON configuration source", () => {
  let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let storageDirectory: string;
  let storage: ReturnType<typeof createLocalObjectStore>;
  let refusalSink: ReturnType<typeof createTrustedRefusalAuditSink>;
  let fileId: string;
  let versionId: string;
  let SET: string;
  const auth = makeTestAuthContext({ userId: USER, organizationId: ORG, permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"] });

  async function readSourceBindings() {
    const bindings = await listCatalogBindingRowsForProject(db,auth,{ projectId: PROJECT });
    return Promise.all(bindings.map(async (binding) => {
      const pin = await loadOwnedProjectValueSourcePin(db,{ organizationId: ORG,projectId: PROJECT,bindingId: binding.id,projectValueId: binding.currentValueId });
      if (!pin) throw new Error("Configuration Binding has no owned source pin");
      return { id: binding.id,current_value_id: binding.currentValueId,config_revision_id: pin.configRevisionId,
        configSetId: pin.configSetId,rootPointer: pin.rootPointer,value: (await loadProjectValueById(asValueClient(db),binding.currentValueId))?.value };
    }));
  }

  it("refuses a digest-only JSON root identity update", async () => {
    const unchanged = await db.query(`select id,root_pointer_digest from parameter_catalog.project_parameter_source_occurrences where project_id=$1`,[PROJECT]);
    // Only beforeAll's source/schema fixture is required, not earlier test results.
    const root = await db.query(`select subject_id from parameter_catalog.catalog_configuration_schemas where subject_id=$1`,[SUBJECT]);
    expect(root.rows).toHaveLength(1);
    await expect(db.transaction(async (tx) => {
      await tx.query("set local role catalog_migration_owner");
      const id = `digest-probe-${randomUUID()}`;
      await tx.query(`insert into parameter_catalog.project_parameter_source_occurrences
        (id,organization_id,project_id,config_set_id,file_id,occurrence_kind,configuration_instance_id,configuration_schema_subject_id,root_pointer,root_pointer_digest)
        values ($1,$2,$3,$4,$5,'json',$6,$7,'/digest-probe',$8)`,
      [id,ORG,PROJECT,SET,fileId,randomUUID(),SUBJECT,`sha256:${createHash("sha256").update("/digest-probe").digest("hex")}`]);
      await tx.query(`update parameter_catalog.project_parameter_source_occurrences set root_pointer_digest=$2 where id=$1`,[id,`sha256:${"0".repeat(64)}`]);
      throw new Error("Digest-only update was accepted");
    })).rejects.toMatchObject({ code: "55000" });
    expect((await db.query(`select id,root_pointer_digest from parameter_catalog.project_parameter_source_occurrences where project_id=$1`,[PROJECT])).rows).toEqual(unchanged.rows);
  });

  it("checks the exact UTF-8 JSON root digest, allowing no-op identity updates", async () => {
    const rollback = new Error("rollback root digest probes");
    for (const pointer of ["","/a~1b/~0/","/温度"]) {
      const digest = `sha256:${createHash("sha256").update(pointer).digest("hex")}`;
      await expect(db.transaction(async (tx) => {
        await tx.query("set local role catalog_migration_owner");
        const id = `digest-probe-${randomUUID()}`;
        await tx.query(`insert into parameter_catalog.project_parameter_source_occurrences
          (id,organization_id,project_id,config_set_id,file_id,occurrence_kind,configuration_instance_id,configuration_schema_subject_id,root_pointer,root_pointer_digest)
          values ($1,$2,$3,$4,$5,'json',$6,$7,$8,$9)`,[id,ORG,PROJECT,SET,fileId,randomUUID(),SUBJECT,pointer,digest]);
        await tx.query(`update parameter_catalog.project_parameter_source_occurrences set root_pointer_digest=$2 where id=$1`,[id,digest]);
        await tx.query("set constraints all immediate");
        throw rollback;
      })).rejects.toBe(rollback);
      await expect(db.transaction(async (tx) => {
        await tx.query("set local role catalog_migration_owner");
        await tx.query(`insert into parameter_catalog.project_parameter_source_occurrences
          (id,organization_id,project_id,config_set_id,file_id,occurrence_kind,configuration_instance_id,configuration_schema_subject_id,root_pointer,root_pointer_digest)
          values ($1,$2,$3,$4,$5,'json',$6,$7,$8,$9)`,[`digest-bad-${randomUUID()}`,ORG,PROJECT,SET,fileId,randomUUID(),SUBJECT,pointer,`sha256:${"0".repeat(64)}`]);
        await tx.query("set constraints all immediate");
        throw new Error("Wrong root digest was accepted");
      })).rejects.toMatchObject({ code: "23514" });
    }
  });

  async function readTarget() {
    const targets = (await readSourceBindings()).filter((binding) => binding.configSetId === SET && binding.rootPointer === "/a~1b/");
    expect(targets).toHaveLength(1);
    return targets[0]!;
  }

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("t11json");
    db = createPostgresDatabase(database.url);
    refusalSink = createTrustedRefusalAuditSink(db);
    storageDirectory = await mkdtemp(join(tmpdir(), "wiseeff-t11-json-"));
    storage = createLocalObjectStore(storageDirectory);
    await db.query(`insert into organizations(id,name) values ($1,'JSON source')`, [ORG]);
    await db.query(`insert into users(id,organization_id,name,title,is_active) values ($1,$2,'JSON editor','Admin',true)`, [USER, ORG]);
    await db.query(`insert into users(id,organization_id,name,title,is_active) values ('reviewer-t11-json',$1,'JSON reviewer','Admin',true)`, [ORG]);
    await db.query(`insert into projects(id,organization_id,name,code,status) values ($1,$2,'JSON source','T11J','initialized')`, [PROJECT, ORG]);
    await db.query(
      `insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
       values ('t11-json-admin-role',$1,$2,null,'admin')`,
      [USER, ORG]
    );
    await db.query(
      `insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
       values ('t11-json-reviewer-role','reviewer-t11-json',$1,$2,'software-committer')`,
      [ORG, PROJECT]
    );
    await installConfigurationSourceFixture(db,auth,{ subjectId: SUBJECT,schemaId: MODEL });
    SET = (await createConfigSet(db,auth,{ projectId: PROJECT,name: "JSON configuration" })).id;
    const uploaded = await uploadProjectParameterFile(db,storage,auth,{ projectId: PROJECT,fileName: "settings.json",bytes: Buffer.from(SOURCE) });
    fileId = uploaded.file.id; versionId = uploaded.version.id;
    await addConfigSetFile(db,auth,{ configSetId: SET,fileId,role: "base",sortOrder: 0 });
  }, 60_000);

  afterAll(async () => {
    await db?.close(); await database?.drop();
    if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
  });

  it("registers an explicit governed root without a DTS node and prepares a typed decimal edit", async () => {
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published fixture is unavailable");
    const registered = await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, auth, snapshot, {
      projectId: PROJECT, configSetId: SET, fileId, fileVersionId: versionId,
      configurationSchemaId: MODEL, rootPointer: "/a~1b/", mappings: [{ definitionId: DEFINITION, pointer: "/a~1b//limit" }],
      invocation: createUserInvocation(auth), requestId: "t11-json-initialize",refusalSink,
    }));
    expect(registered.bindings).toHaveLength(1);
    const binding = registered.bindings[0]!;
    const source = await loadCanonicalSourceSnapshot(db, storage, { organizationId: ORG, projectId: PROJECT, bindingId: binding.id, projectValueId: binding.currentValueId });
    expect(source.manifest).toMatchObject({ format: "json", logicalNodeId: null, configurationSchemaSubjectId: SUBJECT, rootPointer: "/a~1b/", locator: { kind: "json-pointer", pointer: "/a~1b//limit" } });
    expect(source.manifest.configurationInstanceId).toBeTruthy();
    expect((await db.query(`select count(*)::int as count from dts_logical_nodes where project_id=$1`, [PROJECT])).rows[0]?.count).toBe(0);
    expect((await loadProjectValueById(asValueClient(db),binding.currentValueId))?.value).toBe(36.5);
    const router = createRouter();
    registerCatalogProjectValueConsumerRoutes(router, { db,objectStore: storage,getCurrentAuthContext: () => auth });
    const read = await requestJson<{ items: Array<{ id: string; effectiveValue: unknown; rawValue: string }> }>(
      createHttpServer(router), `/api/v2/projects/${PROJECT}/parameter-bindings`);
    expect(read.status).toBe(200);
    expect(read.body.items).toEqual([expect.objectContaining({ id: binding.id,effectiveValue: { kind: "json",value: 36.5 },rawValue: "36.5\n" })]);
    const prepared = await db.transaction((tx) => preparePinnedSourceChange(tx, storage, auth, {
      projectId: PROJECT, bindingId: binding.id, expectedValueId: binding.currentValueId,
      target: { format: "json", sourceText: "85.25" }, invocation: createUserInvocation(auth), requestId: "t11-json-prepare", refusalSink,
    }));
    expect(prepared.diff.after).toBe(SOURCE.replace("36.5", "85.25"));
  });

  it("refuses extra JSON locator keys at the source pin database boundary", async () => {
    const binding = await readTarget();
    await expect(db.transaction(async (tx) => {
      await tx.query("set local role catalog_migration_owner");
      const valueId = `json-locator-probe-${randomUUID()}`;
      const current = (await loadProjectValueById(asValueClient(tx),binding.current_value_id))!;
      await insertProjectValue(asValueClient(tx),{ id: valueId,bindingId: binding.id,
        definitionId: current.definition_id,definitionRevisionId: current.definition_revision_id,
        sourceRef: current.source_ref,configRevisionId: current.config_revision_id,
        valueDigest: current.value_digest,valueKind: "json",valueJson: JSON.stringify(current.value) });
      await tx.query(`insert into parameter_catalog.project_value_source_pins
        select (jsonb_populate_record(null::parameter_catalog.project_value_source_pins,
          to_jsonb(pin)||jsonb_build_object('id',$2::text,'project_value_id',$3::text,
            'locator',pin.locator||'{"extra":"not-a-locator-field"}'::jsonb))).*
        from parameter_catalog.project_value_source_pins pin where project_value_id=$1`,
      [binding.current_value_id,`json-locator-pin-${randomUUID()}`,valueId]);
      await tx.query("set constraints all immediate");
      throw new Error("JSON source pin accepted extra locator keys");
    })).rejects.toMatchObject({ code: "23514" });
  });

  it("freezes every sibling Binding for review without moving any current value", async () => {
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published fixture is unavailable");
    const registered = await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, auth, snapshot, {
      projectId: PROJECT, configSetId: SET, fileId, fileVersionId: versionId,
      configurationSchemaId: MODEL, rootPointer: "", mappings: [{ definitionId: DEFINITION, pointer: "/untouched/0" }],
      invocation: createUserInvocation(auth), requestId: "t11-json-second-instance",refusalSink,
    }));
    const binding = registered.bindings[0]!;
    const before = await db.query(`select id,current_value_id from parameter_catalog.current_project_parameter_bindings where project_id=$1 order by id`, [PROJECT]);
    const prepared = await db.transaction((tx) => preparePinnedSourceChange(tx, storage, auth, {
      projectId: PROJECT, bindingId: binding.id, expectedValueId: binding.currentValueId,
      target: { format: "json", sourceText: "7" }, invocation: createUserInvocation(auth), requestId: "t11-json-cohort", refusalSink,
    }));
    expect(prepared.bindings).toHaveLength(2);
    expect(prepared.bindings.map((entry) => ({ id: entry.bindingId, current_value_id: entry.oldValueId }))).toEqual(before.rows);
    expect((await db.query(`select frozen_binding_manifest from project_parameter_file_candidates where id=$1`, [prepared.candidateId])).rows[0]?.frozen_binding_manifest).toEqual(prepared.bindings);
    expect((await db.query(`select id,current_value_id from parameter_catalog.current_project_parameter_bindings where project_id=$1 order by id`, [PROJECT])).rows).toEqual(before.rows);
    const sibling = prepared.bindings.find((entry) => entry.bindingId !== binding.id)!;
    const rollbackProbe = new Error("rollback mixed-revision cohort probe");
    const beforeProbe = await captureConfigurationSourceState(db,{ organizationId: ORG,projectId: PROJECT });
    await expect(db.transaction(async (tx) => {
      await seedMixedRevisionCohortProbe(tx,{ organizationId: ORG,projectId: PROJECT,bindingId: sibling.bindingId,projectValueId: sibling.oldValueId });
      await expect(preparePinnedSourceChange(tx,storage,auth,{
        projectId: PROJECT,bindingId: binding.id,expectedValueId: binding.currentValueId,target: { format: "json",sourceText: "7" },
        invocation: createUserInvocation(auth),requestId: "t11-json-mixed-revisions",refusalSink,
      })).rejects.toMatchObject({ code: "CONFLICT",details: { reason: "mixed-source-revisions" } });
      throw rollbackProbe;
    })).rejects.toBe(rollbackProbe);
    expect(await captureConfigurationSourceState(db,{ organizationId: ORG,projectId: PROJECT })).toEqual(beforeProbe);
    expect((await db.query(`select id,current_value_id from parameter_catalog.current_project_parameter_bindings where project_id=$1 order by id`, [PROJECT])).rows).toEqual(before.rows);
  });

  it("applies approved JSON bytes and advances unchanged siblings in one replayable batch", async () => {
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published fixture is unavailable");
    const target = await readTarget();
    const beforeBindings = await readSourceBindings();
    const draft = await createCanonicalValueDraft(db,auth,{
      projectId: PROJECT,bindingId: target.id,baseRevisionId: target.config_revision_id,
      sourceTarget: { format: "json",sourceText: "85.25" },reason: "raise JSON limit",
    },{ objectStore: storage,invocation: createUserInvocation(auth),requestId: "t11-json-apply-prepare",refusalSink });
    const submitted = await submitCanonicalValueChange(db,auth,{
      projectId: PROJECT,draftId: draft.id,invocation: createUserInvocation(auth),requestId: "t11-json-apply-submit",refusalSink,
    });
    const requestId = submitted.id;
    const reviewer = makeTestAuthContext({ userId: "reviewer-t11-json",organizationId: ORG,permissions: ["parameter:view","parameter:edit","parameter:review"] });
    const apply = () => db.transaction((tx) => commitCanonicalSourceRevision(tx,storage,reviewer,snapshot, {
      projectId: PROJECT,requestId,invocation: createUserInvocation(reviewer),traceId: "t11-json-apply",refusalSink,
    }));
    const applied = await apply();
    expect(applied.status).toBe("approved");
    await db.transaction(async (tx) => {
      await tx.query("savepoint direct_tip_probe");
      const changed = await casCurrentTip(asValueClient(tx), {
        bindingId: target.id,expectedTip: applied.applied_value_id!,nextTip: target.current_value_id,
      });
      await tx.query("rollback to savepoint direct_tip_probe");
      expect(changed, "A low-level CAS cannot reactivate a historical source pin outside source commit").toBe(false);
    });
    const rows = await readSourceBindings();
    expect(rows.find((row) => row.id === target.id)?.value).toBe(85.25);
    expect(rows.find((row) => row.id !== target.id)?.value).toBe(1);
    expect(new Set(rows.map((row) => row.config_revision_id)).size).toBe(1);
    for (const row of rows) {
      expect(beforeBindings.find((entry) => entry.id === row.id)?.current_value_id).not.toBe(row.current_value_id);
      const source = await loadCanonicalSourceSnapshot(db, storage, { organizationId: ORG,projectId: PROJECT,bindingId: row.id,projectValueId: row.current_value_id });
      expect(source.files[0]?.content).toBe(SOURCE.replace("36.5", "85.25"));
    }
    const counts = () => captureConfigurationSourceState(db,{ organizationId: ORG,projectId: PROJECT });
    const once = await counts();
    expect((await apply()).applied_value_id).toBe(applied.applied_value_id);
    expect(await counts()).toEqual(once);
    const reviewWithoutEdit = { ...reviewer,permissions: reviewer.permissions.filter((permission) => permission !== "parameter:edit") };
    await expect(db.transaction((tx) => commitCanonicalSourceRevision(tx,storage,reviewWithoutEdit,snapshot, {
      projectId: PROJECT,requestId,invocation: createUserInvocation(reviewWithoutEdit),traceId: "t11-json-review-without-edit",refusalSink,
    }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await db.query(`select count(*)::int as count from audit_events where trace_id='t11-json-review-without-edit' and action='deny'`)).rows[0]?.count).toBe(1);
    const revoked = { ...reviewer, permissions: [] };
    await expect(db.transaction((tx) => commitCanonicalSourceRevision(tx,storage,revoked,snapshot, {
      projectId: PROJECT,requestId,invocation: createUserInvocation(revoked),traceId: "t11-json-replay-denied",refusalSink,
    }))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses legacy membership additions to a canonical-backed configuration set", async () => {
    const addedId = (await uploadProjectParameterFile(db,storage,auth,{ projectId: PROJECT,fileName: "additional.json",bytes: Buffer.from("{}") })).file.id;
    await expect(addConfigSetFile(db,auth,{ configSetId: SET,fileId: addedId,role: "misc" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await db.query(`select config_set_id from project_parameter_files where id=$1`, [addedId])).rows[0]?.config_set_id).toBeNull();
  });

  it("keeps a newer pending edit when an older immutable submission is approved", async () => {
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published fixture is unavailable");
    const target = await readTarget();
    const draft = async (value: string) => createCanonicalValueDraft(db,auth, {
      projectId: PROJECT,bindingId: target.id,sourceTarget: { format: "json",sourceText: value },reason: "change JSON limit",baseRevisionId: target.config_revision_id,
    },{ objectStore: storage,invocation: createUserInvocation(auth),requestId: `t11-json-draft-${value}`,refusalSink });
    const original = await draft("86");
    const submitted = await submitCanonicalValueChange(db,auth,{ projectId: PROJECT,draftId: original.id,invocation: createUserInvocation(auth),requestId: "t11-json-submit",refusalSink });
    const edited = await draft("87");
    const reviewer = makeTestAuthContext({ userId: "reviewer-t11-json",organizationId: ORG,permissions: ["parameter:view","parameter:edit","parameter:review"] });
    const applied = await reviewCanonicalValueChange(db,reviewer,{ projectId: PROJECT,requestId: submitted.id,decision: "approve" }, {
      objectStore: storage,snapshot,invocation: createUserInvocation(reviewer),traceId: "t11-json-public-approve",refusalSink,
    });
    expect(applied.targetValue).toBe("86");
    expect((await listCanonicalValueDraftsForUser(db,auth,{ projectId: PROJECT })).find((row) => row.id === edited.id)?.targetValue).toBe("87");
  });

  it("legacy upload takes the config-set lock before a file-version FK can block canonical apply", async () => {
    const pool = getRootPostgresPool(db)!;
    const editor = await pool.connect();
    let uploading: Promise<unknown> | undefined;
    try {
      await editor.query("begin");
      const pid = (await editor.query(`select pg_backend_pid() as pid`)).rows[0]!.pid;
      await editor.query(`select id from dts_config_set where id=$1 for update`, [SET]);
      uploading = uploadProjectParameterFile(db,storage,auth,{ projectId: PROJECT,fileName: "settings.json",bytes: Buffer.from(SOURCE) })
        .then(() => ({ applied: true }),error => ({ code: error.code }));
      let waiting = false;
      for (let attempt=0; attempt<100 && !waiting; attempt++) {
        waiting = (await pool.query(`select exists(select 1 from pg_stat_activity
          where datname=current_database() and $1=any(pg_blocking_pids(pid))) as waiting`, [pid])).rows[0]!.waiting;
        if (!waiting) await delay(10);
      }
      expect(waiting).toBe(true);
      await editor.query(`select id from project_parameter_files where id=$1 for update nowait`, [fileId]);
    } finally {
      await editor.query("rollback");
      editor.release();
      if (uploading) expect(await uploading).toEqual({ code: "CONFLICT" });
    }
  });

  it("uses independent local logins for JSON draft, submit, review, replay and exact export", async () => {
    const server = createWiseEffServer({ db,objectStore: storage,auth: { mode: "production" },localAuthService: createLocalAuthService(db) });
    const password = randomUUID();
    const tokens: string[] = [];
    for (const [index,role] of ["software-user","software-committer"].entries()) {
      const id = `t11-http-json-${index}`;
      await db.query(`insert into users(id,organization_id,name,title,is_active) values ($1,$2,$1,'JSON workflow',true)`, [id,ORG]);
      await db.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ($1,$1,$2,$3,$4)`, [id,ORG,PROJECT,role]);
      await db.query(`insert into user_password_credentials(user_id,username,password_hash) values ($1,$1,$2)`, [id,await hashLocalAccountPassword(password)]);
      const login = await requestJson<{ token: string }>(server,"/api/v1/auth/login",{ method: "POST",body: JSON.stringify({ username: id,password }) });
      expect(login.status).toBe(200);
      tokens.push(login.body.token);
    }
    const api = <T,>(actor: number,path: string,body?: unknown) => requestJson<T>(server,path,{
      headers: { Authorization: `Bearer ${tokens[actor]}` }, ...(body === undefined ? {} : { method: "POST",body: JSON.stringify(body) }),
    });
    const target = await readTarget();
    const bindingPath = `/api/v2/projects/${PROJECT}/parameter-bindings/${target.id}`;
    const before = await api<{ item: { currentValueId: string } }>(0,`${bindingPath}/export`);
    expect(before.status).toBe(200);
    const draft = await api<{ item: { draftId: string } }>(0,`${bindingPath}/drafts`, {
      baseRevisionId: target.config_revision_id,sourceTarget: { format: "json",sourceText: "91.25" },reason: "Authenticated JSON edit",
    });
    expect(draft.status,JSON.stringify(draft.body)).toBe(201);
    const pending = await api(0,`/api/v2/projects/${PROJECT}/parameter-value-drafts`);
    expect(projectValueDraftListResponseSchema.parse(pending.body).items).toEqual([expect.objectContaining({
      id: draft.body.item.draftId, sourceFormat: "json",sourceTarget: { format: "json",sourceText: "91.25\n" },
    })]);
    expect((await api<{ item: { currentValueId: string } }>(0,`${bindingPath}/export`)).body.item.currentValueId).toBe(before.body.item.currentValueId);
    const submitted = await api<{ item: { id: string } }>(0,`/api/v2/projects/${PROJECT}/parameter-value-drafts/${draft.body.item.draftId}/submit`, { assignedToUserId: "t11-http-json-1" });
    expect(submitted.status,JSON.stringify(submitted.body)).toBe(201);
    expect(catalogValueChangeRequestResponseSchema.parse(submitted.body).item).toMatchObject({ sourceFormat: "json",sourceTarget: { format: "json",sourceText: "91.25\n" } });
    const diffPath = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${submitted.body.item.id}/source-diff`;
    const diff = await api<{ item: { before: string; after: string; bindings: unknown[] } }>(1,diffPath);
    expect(diff.status,JSON.stringify(diff.body)).toBe(200);
    expect(catalogValueChangeSourceDiffResponseSchema.parse(diff.body).item.requestId).toBe(submitted.body.item.id);
    expect(diff.body.item).toMatchObject({ requestId: submitted.body.item.id,bindingId: target.id,format: "json",sourceName: "settings.json",
      before: SOURCE.replace("36.5","86"),after: SOURCE.replace("36.5","91.25") });
    expect(diff.body.item.bindings.length).toBeGreaterThan(1);
    expect((await requestJson(server,diffPath)).status).toBe(401);
    const reviewPath = `/api/v2/projects/${PROJECT}/parameter-value-change-requests/${submitted.body.item.id}/review`;
    expect((await api(0,reviewPath,{ decision: "approve" })).status).toBe(403);
    const approved = await api<{ item: { status: string } }>(1,reviewPath,{ decision: "approve" });
    expect(approved.status,JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.item.status).toBe("approved");
    expect((await api(1,reviewPath,{ decision: "approve" })).body).toEqual(approved.body);
    const exported = await api(0,`${bindingPath}/export`);
    expect(exported.status).toBe(200);
    const result = catalogBindingExportResponseSchema.parse(exported.body).item;
    expect(result.files[0]?.content).toBe(SOURCE.replace("36.5","91.25"));
    expect(result.manifest.members[0]?.sourceName).toBe("settings.json");
    expect(result.currentValueId).not.toBe(before.body.item.currentValueId);
    const historical = await api(0,`${bindingPath}/export?projectValueId=${before.body.item.currentValueId}`);
    expect(historical.status).toBe(200);
    expect(catalogBindingExportResponseSchema.parse(historical.body).item).toEqual(before.body.item);
    expect((await api(0,`${bindingPath}/export?projectValueId=foreign-value`)).status).toBe(404);
    const historyPackage = catalogBindingExportResponseSchema.parse(historical.body).item;
    const reimported = await api(0,`${bindingPath}/reimport-preview`,historyPackage);
    expect(reimported.status,JSON.stringify(reimported.body)).toBe(200);
    expect(reimported.body).toEqual(historical.body);
    expect((await api(0,`${bindingPath}/reimport-preview`,{ ...historyPackage,manifest: { ...historyPackage.manifest,rootPointer: "/untouched" } })).status).toBe(409);
    expect((await api(0,`${bindingPath}/reimport-preview`,{ ...historyPackage,files: historyPackage.files.map((file) => ({ ...file,content: file.content.replace("[1,2]","[2,1]") })) })).status).toBe(409);
    expect((await api(1,diffPath)).body).toEqual(diff.body);
    const damaged = createWiseEffServer({ db,objectStore: { ...storage,getBounded: async () => Buffer.from("corrupt") },auth: { mode: "production" },localAuthService: createLocalAuthService(db) });
    expect((await requestJson(damaged,diffPath,{ headers: { Authorization: `Bearer ${tokens[1]}` } })).status).toBe(409);
    await db.query(`delete from user_role_bindings where user_id='t11-http-json-1'`);
    expect((await api(1,reviewPath,{ decision: "approve" })).status).not.toBe(200);
    expect((await api(1,diffPath)).status).not.toBe(200);
  });

  it("retains the pinned member aliases when a display rename precedes explicit new-instance mapping", async () => {
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published fixture is unavailable");
    const current = (await db.query<{ current_version_id: string }>(`select current_version_id from project_parameter_files where id=$1`, [fileId])).rows[0]!;
    await db.query(`update project_parameter_files set file_name='renamed-display.json' where id=$1`, [fileId]);
    const registered = await db.transaction((tx) => registerCanonicalJsonSource(tx,storage,auth,snapshot,{
      projectId: PROJECT,configSetId: SET,fileId,fileVersionId: current.current_version_id,
      configurationSchemaId: MODEL,rootPointer: "/a~1b",mappings: [{ definitionId: DEFINITION,pointer: "/a~1b//limit" }],
      invocation: createUserInvocation(auth),requestId: "t11-json-renamed-new-instance",refusalSink,
    }));
    const binding = registered.bindings[0]!;
    const source = await loadCanonicalSourceSnapshot(db,storage,{ organizationId: ORG,projectId: PROJECT,bindingId: binding.id,projectValueId: binding.currentValueId });
    expect(source.manifest.members[0]?.sourceName).toBe("settings.json");
    expect(source.files[0]?.name).toBe("settings.json");
  });

  it("initializes an explicitly mapped JSON instance through authenticated candidate and registration APIs", async () => {
    const server = createWiseEffServer({ db,objectStore: storage,auth: { mode: "production" },localAuthService: createLocalAuthService(db) });
    const password = randomUUID();
    await db.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('t11-json-admin',$1,$2,null,'admin')`, [USER,ORG]);
    await db.query(`insert into user_password_credentials(user_id,username,password_hash) values ($1,$1,$2)`, [USER,await hashLocalAccountPassword(password)]);
    const login = await requestJson<{ token: string }>(server,"/api/v1/auth/login",{ method: "POST",body: JSON.stringify({ username: USER,password }) });
    expect(login.status).toBe(200);
    const api = <T,>(path: string,body?: unknown) => requestJson<T>(server,path,{
      headers: { Authorization: `Bearer ${login.body.token}` },...(body === undefined ? {} : { method: "POST",body: JSON.stringify(body) }),
    });
    const set = await api<{ item: { id: string } }>(`/api/v1/projects/${PROJECT}/config-sets`,{ name: "Authenticated JSON registration" });
    expect(set.status,JSON.stringify(set.body)).toBe(201);
    const candidates = `/api/v1/projects/${PROJECT}/parameter-file-candidates`;
    const candidate = await api<{ item: { id: string } }>(candidates,{ fileName: "fresh.json",contentBase64: Buffer.from(SOURCE).toString("base64") });
    expect(candidate.status,JSON.stringify(candidate.body)).toBe(201);
    const active = await api<{ file: { id: string }; version: { id: string } }>(`${candidates}/${candidate.body.item.id}/activate`,{ configSetId: set.body.item.id,role: "base",expectedCurrentVersionId: null });
    expect(active.status,JSON.stringify(active.body)).toBe(200);
    const sideCandidate = await api<{ item: { id: string } }>(candidates,{ fileName: "side.json",contentBase64: Buffer.from('{"unmapped":1}').toString("base64") });
    expect(sideCandidate.status).toBe(201);
    const sideActive = await api<{ version: { id: string } }>(`${candidates}/${sideCandidate.body.item.id}/activate`,{ configSetId: set.body.item.id,role: "misc",sortOrder: 1,expectedCurrentVersionId: null });
    expect(sideActive.status,JSON.stringify(sideActive.body)).toBe(200);
    const path = `/api/v2/projects/${PROJECT}/parameter-files/${active.body.file.id}/configuration-instances`;
    const body = { configSetId: set.body.item.id,fileVersionId: active.body.version.id,configurationSchemaId: MODEL,
      rootPointer: "/a~1b/",mappings: [{ definitionId: DEFINITION,pointer: "/a~1b//limit" }] };
    const sideKey = (await db.query<{ storage_key: string }>(`select storage_key from project_parameter_file_versions where id=$1`, [sideActive.body.version.id])).rows[0]!.storage_key;
    const brokenMemberServer = createWiseEffServer({ db,objectStore: { ...storage,getBounded: async (key,limit) => key === sideKey ? Buffer.from("corrupt") : storage.getBounded!(key,limit) },auth: { mode: "production" },localAuthService: createLocalAuthService(db) });
    expect((await requestJson(brokenMemberServer,path,{ method: "POST",body: JSON.stringify(body),headers: { Authorization: `Bearer ${login.body.token}` } })).status).toBe(409);
    const initialized = await api<{ items: Array<{ id: string; currentValueId: string; logicalNodeId: string | null }> }>(path,body);
    expect(initialized.status,JSON.stringify(initialized.body)).toBe(201);
    expect(initialized.body.items).toHaveLength(1);
    expect(initialized.body.items[0]?.logicalNodeId).toBeNull();
    expect((await api(path,body)).body).toEqual(initialized.body);
    const invalid = await api(path,{ ...body,rootPointer: "/missing" });
    expect(invalid.status).toBe(409);
    const exportPath = `/api/v2/projects/${PROJECT}/parameter-bindings/${initialized.body.items[0]!.id}/export`;
    const exported = catalogBindingExportResponseSchema.parse((await api(exportPath)).body).item;
    expect(exported.files.find((file) => file.name === "fresh.json")?.content).toBe(SOURCE);
    expect(exported.files).toHaveLength(2);
    expect(exported.manifest).toMatchObject({ rootPointer: "/a~1b/",fileId: active.body.file.id,configSetId: set.body.item.id });
    const unchanged = await api("/api/v1/parameter-import-batches",{
      projectId: PROJECT,sourceName: "same JSON value",items: [{ id: initialized.body.items[0]!.id,name: "iin_max",module: "Configuration",risk: "Low",unit: "A",range: ">=0",configFormat: "JSON",currentValue: "3.650e1" }],
    });
    expect(unchanged.body).toMatchObject({ item: { summary: { unchanged: 1,updated: 0 },items: [{ classification: "unchanged" }] } });
    const preview = await api<{ item: { id: string; items: Array<{ id: string; definitionId: string; projectParameterValueId: string }> } }>("/api/v1/parameter-import-batches",{
      projectId: PROJECT,sourceName: "reviewed JSON import",items: [{ id: initialized.body.items[0]!.id,name: "iin_max",module: "Configuration",risk: "Low",unit: "A",range: ">=0",configFormat: "JSON",currentValue: "37.25" }],
    });
    expect(preview.status,JSON.stringify(preview.body)).toBe(201);
    expect(preview.body.item.items[0]).toMatchObject({ definitionId: DEFINITION,projectParameterValueId: initialized.body.items[0]!.id });
    const stagePath = `/api/v1/parameter-import-batches/${preview.body.item.id}/apply`;
    const selection = { selectedItemIds: preview.body.item.items.map((item) => item.id) };
    const staged = await api<{ item: { status: string; appliedAt?: string; summary: { staged: number }; items: Array<{ stagedDraft?: { draftId: string; candidateId: string } }> } }>(stagePath,selection);
    expect(staged.status,JSON.stringify(staged.body)).toBe(200);
    expect(staged.body.item.status).toBe("staged");
    expect(staged.body.item.appliedAt).toBeUndefined();
    expect(staged.body.item.summary.staged).toBe(1);
    expect(staged.body.item.items[0]?.stagedDraft?.candidateId).toBeTruthy();
    const counts = async () => (await db.query(`select (select count(*) from project_parameter_file_candidates) as candidates,
      (select count(*) from project_parameter_value_drafts) as drafts,(select count(*) from audit_events) as audits`)).rows[0];
    const once = await counts();
    expect((await api(stagePath,selection)).body).toEqual(staged.body);
    expect(await counts()).toEqual(once);
    const candidateKey = (await db.query<{ storage_key: string }>(`select storage_key from project_parameter_file_candidates where id=$1`, [staged.body.item.items[0]!.stagedDraft!.candidateId])).rows[0]!.storage_key;
    const damagedStageServer = createWiseEffServer({ db,objectStore: { ...storage,getBounded: async (key,limit) => key === candidateKey ? Buffer.from("corrupt") : storage.getBounded!(key,limit) },auth: { mode: "production" },localAuthService: createLocalAuthService(db) });
    expect((await requestJson(damagedStageServer,stagePath,{ method: "POST",body: JSON.stringify(selection),headers: { Authorization: `Bearer ${login.body.token}` } })).status).toBe(409);
    expect(await counts()).toEqual(once);
    expect(catalogBindingExportResponseSchema.parse((await api(exportPath)).body).item).toEqual(exported);
    expect((await api(stagePath,{ selectedItemIds: ["unknown-import-row"] })).status).toBe(400);
    const stagedDraftId = staged.body.item.items[0]!.stagedDraft!.draftId;
    expect((await requestJson(server,`/api/v2/projects/${PROJECT}/parameter-value-drafts/${stagedDraftId}`,{
      method: "DELETE",headers: { Authorization: `Bearer ${login.body.token}` }
    })).status).toBe(200);
    const removed = await counts();
    expect((await api(stagePath,selection)).status).toBe(409);
    expect(await counts()).toEqual(removed);
    const second = await api<{ items: Array<{ id: string }> }>(path,{ ...body,rootPointer: "",mappings: [{ definitionId: DEFINITION,pointer: "/untouched/0" }] });
    expect(second.status).toBe(201);
    const brokenPreview = await api<{ item: { id: string; items: Array<{ id: string }> } }>("/api/v1/parameter-import-batches",{
      projectId: PROJECT,sourceName: "atomic invalid JSON batch",items: [initialized.body.items[0]!.id,second.body.items[0]!.id].map((id,index) => ({
        id,name: "iin_max",module: "Configuration",risk: "Low",unit: "A",range: ">=0",configFormat: "JSON",currentValue: index ? "not-json" : "38.25"
      }))
    });
    expect(brokenPreview.status).toBe(201);
    const beforeFailure = await counts();
    const brokenStage = await api(`/api/v1/parameter-import-batches/${brokenPreview.body.item.id}/apply`,{ selectedItemIds: brokenPreview.body.item.items.map((row) => row.id) });
    expect(brokenStage.status,JSON.stringify(brokenStage.body)).toBe(400);
    expect(await counts()).toEqual(beforeFailure);
    expect((await db.query(`select status,applied_at from parameter_import_batches where id=$1`, [brokenPreview.body.item.id])).rows[0]).toEqual({ status: "previewed",applied_at: null });
    // An old/abnormal batch without canonical marker fields cannot bypass the
    // source owner simply by hiding its Binding IDs from the legacy service.
    await db.query(`update parameter_import_batches set items='[]'::jsonb where id=$1`, [brokenPreview.body.item.id]);
    await expect(applyLegacyImportBatch(db,auth,{ batchId: brokenPreview.body.item.id })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await counts()).toEqual(beforeFailure);
    await db.query(
      `update user_role_bindings set role_id='software-user',project_id=$1 where id in ('t11-json-admin','t11-json-admin-role')`,
      [PROJECT]
    );
    try {
      expect((await api(stagePath,selection)).status).toBe(403);
      expect((await db.query(`select count(*)::int as count from audit_events where target_id=$1 and action='deny'`, [preview.body.item.id])).rows[0]?.count).toBe(1);
    } finally {
      await db.query(
        `update user_role_bindings set role_id='admin',project_id=null where id in ('t11-json-admin','t11-json-admin-role')`
      );
    }
  });

  it("rolls back object/audit failures and returns one immutable result for concurrent approval retries", async () => {
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published fixture is unavailable");
    const security = { invocation: createUserInvocation(auth),requestId: "t11-failure-draft",refusalSink };
    const failureSet = (await createConfigSet(db,auth,{ projectId: PROJECT,name: "Failure boundary" })).id;
    const source = await uploadProjectParameterFile(db,storage,auth,{ projectId: PROJECT,fileName: "failure.json",bytes: Buffer.from(SOURCE) });
    await addConfigSetFile(db,auth,{ configSetId: failureSet,fileId: source.file.id,role: "base",sortOrder: 0 });
    const registered = await db.transaction((tx) => registerCanonicalJsonSource(tx,storage,auth,snapshot,{
      projectId: PROJECT,configSetId: failureSet,fileId: source.file.id,fileVersionId: source.version.id,
      configurationSchemaId: MODEL,rootPointer: "/a~1b/",mappings: [{ definitionId: DEFINITION,pointer: "/a~1b//limit" }],...security,
    }));
    const binding = registered.bindings[0]!;
    const pin = await loadCanonicalSourceSnapshot(db,storage,{ organizationId: ORG,projectId: PROJECT,bindingId: binding.id,projectValueId: binding.currentValueId });
    const input = { projectId: PROJECT,bindingId: binding.id,sourceTarget: { format: "json" as const,sourceText: "92.625" },
      reason: "Atomic failure and retry",baseRevisionId: pin.manifest.configRevisionId };
    const state = () => captureConfigurationSourceState(db,{ organizationId: ORG,projectId: PROJECT });
    const beforePut = await state();
    await expect(createCanonicalValueDraft(db,auth,input,{ ...security,objectStore: { ...storage,put: async () => { throw new Error("t11-object-put-failure"); } } }))
      .rejects.toThrow("t11-object-put-failure");
    expect(await state()).toEqual(beforePut);
    const draft = await createCanonicalValueDraft(db,auth,input,{ ...security,objectStore: storage });
    const request = await submitCanonicalValueChange(db,auth,{ projectId: PROJECT,draftId: draft.id,...security });
    const reviewer = makeTestAuthContext({ userId: "reviewer-t11-json",organizationId: ORG,permissions: ["parameter:view","parameter:edit","parameter:review"] });
    const approve = (objectStore = storage,traceId = "t11-retry-approve") => reviewCanonicalValueChange(db,reviewer,
      { projectId: PROJECT,requestId: request.id,decision: "approve" },
      { objectStore,snapshot,invocation: createUserInvocation(reviewer),traceId,refusalSink });
    const candidateKey = (await db.query<{ storage_key: string }>(`select storage_key from project_parameter_file_candidates where id=$1`, [draft.candidateId])).rows[0]!.storage_key;
    const beforeApply = await state();
    await expect(approve({ ...storage,getBounded: async (key,limit) => {
      if (key === candidateKey) throw new Error("t11-candidate-object-missing");
      return storage.getBounded!(key,limit);
    } })).rejects.toThrow("t11-candidate-object-missing");
    expect(await state()).toEqual(beforeApply);
    // Owned disposable database only: fail the real audit INSERT after value/file
    // pointer writes, proving PostgreSQL rolls back the entire apply transaction.
    await db.query(`create function public.t11_fail_apply_audit() returns trigger language plpgsql as $$ begin
      if new.trace_id='t11-fail-audit' and new.action='value-change-applied' then raise exception 't11-injected-audit-failure'; end if;
      return new; end $$`);
    await db.query(`create trigger t11_fail_apply_audit before insert on audit_events for each row execute function public.t11_fail_apply_audit()`);
    try {
      await expect(approve(storage,"t11-fail-audit")).rejects.toThrow("t11-injected-audit-failure");
      expect(await state()).toEqual(beforeApply);
      expect((await db.query(`select status from project_parameter_value_change_requests where id=$1`, [request.id])).rows[0]?.status).toBe("pending");
      expect((await db.query(`select status from project_parameter_file_candidates where id=$1`, [draft.candidateId])).rows[0]?.status).toBe("ready");
    } finally {
      await db.query(`drop trigger t11_fail_apply_audit on audit_events`);
      await db.query(`drop function public.t11_fail_apply_audit()`);
    }
    const attempts = await Promise.allSettled([approve(),approve()]);
    expect(attempts.some((attempt) => attempt.status === "fulfilled")).toBe(true);
    const results = [];
    for (const attempt of attempts) {
      if (attempt.status === "fulfilled") results.push(attempt.value);
      else {
        expect(attempt.reason).toMatchObject({ code: "CONFLICT",details: { reason: "source-proof-busy" } });
        // NOWAIT conflicts roll back the whole transaction; replay only after
        // the winning transaction has committed, never inside the aborted tx.
        results.push(await approve());
      }
    }
    expect(results[0]!.status).toBe("approved");
    expect(results[1]).toEqual(results[0]);
    expect((await db.query(`select count(*)::int as count from audit_events where target_id=$1 and action='value-change-applied'`, [request.id])).rows[0]?.count).toBe(1);
    const committed = await state();
    expect(await approve()).toEqual(results[0]);
    expect(await state()).toEqual(committed);
  });

  it("allows only one approved source request from two independently submitted changes on the same base", async () => {
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published fixture is unavailable");
    const setId = (await createConfigSet(db,auth,{ projectId: PROJECT,name: "Independent source CAS" })).id;
    const source = await uploadProjectParameterFile(db,storage,auth,{ projectId: PROJECT,fileName: "source-cas.json",bytes: Buffer.from(SOURCE) });
    await addConfigSetFile(db,auth,{ configSetId: setId,fileId: source.file.id,role: "base",sortOrder: 0 });
    const registered = await db.transaction((tx) => registerCanonicalJsonSource(tx,storage,auth,snapshot,{
      projectId: PROJECT,configSetId: setId,fileId: source.file.id,fileVersionId: source.version.id,
      configurationSchemaId: MODEL,rootPointer: "/a~1b/",mappings: [{ definitionId: DEFINITION,pointer: "/a~1b//limit" }],
      invocation: createUserInvocation(auth),requestId: "t11-source-cas-register",refusalSink,
    }));
    const binding = registered.bindings[0]!;
    const identity = { organizationId: ORG,projectId: PROJECT,bindingId: binding.id };
    const original = await loadCanonicalSourceSnapshot(db,storage,{ ...identity,projectValueId: binding.currentValueId });
    const secondAuthor = makeTestAuthContext({ userId: "author-two-t11-json",organizationId: ORG,permissions: ["parameter:view","parameter:edit"] });
    await db.query(`insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Second author','User',true)`, [secondAuthor.user.id,ORG]);
    const requests = [];
    for (const [index,author] of [auth,secondAuthor].entries()) {
      const security = { invocation: createUserInvocation(author),requestId: `t11-source-cas-${index}`,refusalSink };
      const draft = await createCanonicalValueDraft(db,author,{ projectId: PROJECT,bindingId: binding.id,
        sourceTarget: { format: "json",sourceText: index === 0 ? "51.25" : "52.5" },
        reason: "Independent source compare-and-swap",baseRevisionId: original.manifest.configRevisionId,
      },{ ...security,objectStore: storage });
      requests.push(await submitCanonicalValueChange(db,author,{ projectId: PROJECT,draftId: draft.id,...security }));
    }
    expect(requests[0]!.id).not.toBe(requests[1]!.id);
    const reviewer = makeTestAuthContext({ userId: "reviewer-t11-json",organizationId: ORG,permissions: ["parameter:view","parameter:edit","parameter:review"] });
    const approve = (requestId: string) => reviewCanonicalValueChange(db,reviewer,{ projectId: PROJECT,requestId,decision: "approve" },
      { objectStore: storage,snapshot,invocation: createUserInvocation(reviewer),traceId: `review-${requestId}`,refusalSink });
    const historyBefore = await readCanonicalBindingChangeHistory(getRootPostgresPool(db)!,identity);
    const outcomes = await Promise.allSettled(requests.map((request) => approve(request.id)));
    const winner = outcomes.findIndex((outcome) => outcome.status === "fulfilled");
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const loser = winner === 0 ? 1 : 0;
    expect(outcomes[loser]).toMatchObject({ status: "rejected",reason: { code: "CONFLICT" } });
    await expect(approve(requests[loser]!.id)).rejects.toMatchObject({ code: "CONFLICT",details: { reason: "stale-base-value" } });
    const winning = outcomes[winner]!;
    if (winning.status !== "fulfilled") throw new Error("Source CAS produced no winner");
    expect(await approve(requests[winner]!.id)).toEqual(winning.value);
    expect((await readCanonicalBindingChangeHistory(getRootPostgresPool(db)!,identity))!.length).toBe(historyBefore!.length+1);
    expect((await db.query(`select count(*)::int as count from audit_events where target_id=any($1::text[]) and action='value-change-applied'`,
      [requests.map((request) => request.id)])).rows[0]?.count).toBe(1);
    expect((await db.query(`select status from project_parameter_value_change_requests where id=$1`, [requests[loser]!.id])).rows[0]?.status).toBe("pending");
    expect(await loadCanonicalSourceSnapshot(db,storage,{ ...identity,projectValueId: binding.currentValueId })).toEqual(original);
  });

  it("registers and approves JSON in a mixed set only after exact DTS member resolution", async () => {
    const mixedSet = (await createConfigSet(db,auth,{ projectId: PROJECT,name: "Mixed source" })).id;
    const dtsText = '/dts-v1/;\n/ { board { compatible = "t11,unmapped-board"; keep = <9>; }; };\n';
    const dts = await uploadProjectParameterFile(db,storage,auth,{ projectId: PROJECT,fileName: "mixed-board.dts",bytes: Buffer.from(dtsText) });
    const json = await uploadProjectParameterFile(db,storage,auth,{ projectId: PROJECT,fileName: "mixed-settings.json",bytes: Buffer.from(SOURCE) });
    await addConfigSetFile(db,auth,{ configSetId: mixedSet,fileId: dts.file.id,role: "base",sortOrder: 0 });
    await addConfigSetFile(db,auth,{ configSetId: mixedSet,fileId: json.file.id,role: "misc",sortOrder: 1 });
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published fixture is unavailable");
    const register = () => db.transaction((tx) => registerCanonicalJsonSource(tx,storage,auth,snapshot,{
      projectId: PROJECT,configSetId: mixedSet,fileId: json.file.id,fileVersionId: json.version.id,
      configurationSchemaId: MODEL,rootPointer: "/a~1b/",mappings: [{ definitionId: DEFINITION,pointer: "/a~1b//limit" }],
      invocation: createUserInvocation(auth),requestId: "t11-mixed-register",refusalSink,
    }));
    await expect(register()).rejects.toMatchObject({ code: "CONFLICT" });
    await uploadProjectParameterFile(db,storage,auth,{ projectId: PROJECT,fileName: "mixed-board.dts",bytes: Buffer.from(dtsText) });
    const revision = (await db.query<{ id: string; status: string }>(`select id,status from dts_config_revisions where config_set_id=$1 order by revision_number desc limit 1`, [mixedSet])).rows[0]!;
    expect(revision.status).toBe("resolved");
    await db.query(`update dts_config_revisions set status='invalid' where id=$1`, [revision.id]);
    await expect(register()).rejects.toMatchObject({ code: "CONFLICT" });
    await db.query(`update dts_config_revisions set status='resolved' where id=$1`, [revision.id]);
    const binding = (await register()).bindings[0]!;
    await expect(db.query(`update dts_config_revisions set status='invalid' where id=$1`, [revision.id])).rejects.toMatchObject({ code: "55000" });
    const draft = await createCanonicalValueDraft(db,auth,{
      projectId: PROJECT,bindingId: binding.id,sourceTarget: { format: "json",sourceText: "42.5" },reason: "Mixed source JSON edit",baseRevisionId: revision.id,
    },{ objectStore: storage,invocation: createUserInvocation(auth),requestId: "t11-mixed-draft",refusalSink });
    const submitted = await submitCanonicalValueChange(db,auth,{ projectId: PROJECT,draftId: draft.id,invocation: createUserInvocation(auth),requestId: "t11-mixed-submit",refusalSink });
    const reviewer = makeTestAuthContext({ userId: "reviewer-t11-json",organizationId: ORG,permissions: ["parameter:view","parameter:edit","parameter:review"] });
    const applied = await reviewCanonicalValueChange(db,reviewer,{ projectId: PROJECT,requestId: submitted.id,decision: "approve" },{
      objectStore: storage,snapshot,invocation: createUserInvocation(reviewer),traceId: "t11-mixed-approve",refusalSink,
    });
    expect(applied.status).toBe("approved");
    const source = await loadCanonicalSourceSnapshot(db,storage,{ organizationId: ORG,projectId: PROJECT,bindingId: binding.id,projectValueId: applied.appliedValueId! });
    expect(source.manifest.entryFile).toBe("mixed-board.dts");
    expect(source.files.find((file) => file.format === "dts")?.content).toBe(dtsText);
    expect(source.files.find((file) => file.format === "json")?.content).toBe(SOURCE.replace("36.5","42.5"));
  });

  it("isolates equal JSON Definitions across config sets while advancing same-set siblings", async () => {
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published fixture is unavailable");
    const setA = (await createConfigSet(db,auth,{ projectId: PROJECT,name: "Occurrence isolation A" })).id;
    const setB = (await createConfigSet(db,auth,{ projectId: PROJECT,name: "Occurrence isolation B" })).id;
    const sources = await Promise.all([
      uploadProjectParameterFile(db,storage,auth,{ projectId: PROJECT,fileName: "isolation-a-one.json",bytes: Buffer.from(SOURCE.replace("36.5","10.5")) }),
      uploadProjectParameterFile(db,storage,auth,{ projectId: PROJECT,fileName: "isolation-a-two.json",bytes: Buffer.from(SOURCE.replace("36.5","11.5")) }),
      uploadProjectParameterFile(db,storage,auth,{ projectId: PROJECT,fileName: "isolation-b-one.json",bytes: Buffer.from(SOURCE.replace("36.5","20.5")) }),
    ]);
    await addConfigSetFile(db,auth,{ configSetId: setA,fileId: sources[0]!.file.id,role: "base",sortOrder: 0 });
    await addConfigSetFile(db,auth,{ configSetId: setA,fileId: sources[1]!.file.id,role: "misc",sortOrder: 1 });
    await addConfigSetFile(db,auth,{ configSetId: setB,fileId: sources[2]!.file.id,role: "base",sortOrder: 0 });
    const register = (configSetId: string,index: number) => db.transaction((tx) => registerCanonicalJsonSource(tx,storage,auth,snapshot,{
      projectId: PROJECT,configSetId,fileId: sources[index]!.file.id,fileVersionId: sources[index]!.version.id,
      configurationSchemaId: MODEL,rootPointer: "/a~1b/",mappings: [{ definitionId: DEFINITION,pointer: "/a~1b//limit" }],
      invocation: createUserInvocation(auth),requestId: `t11-json-isolation-register-${index}`,refusalSink,
    }));
    await register(setA,0);
    await register(setA,1);
    await register(setB,2);

    const readScoped = async (configSetId: string) => {
      const rows = await listCatalogBindingRowsForProject(db,auth,{ projectId: PROJECT });
      return (await Promise.all(rows.map(async (row) => {
        const pin = await loadOwnedProjectValueSourcePin(db,{ organizationId: ORG,projectId: PROJECT,bindingId: row.id,projectValueId: row.currentValueId });
        if (!pin || pin.configSetId !== configSetId) return null;
        const value = await loadProjectValueById(asValueClient(db),row.currentValueId);
        return { bindingId: row.id,currentValueId: row.currentValueId,definitionId: row.definitionId,sourcePinId: pin.sourcePinId,
          sourceOccurrenceId: pin.sourceOccurrenceId,configRevisionId: pin.configRevisionId,fileId: pin.fileId,fileVersionId: pin.fileVersionId,value: value?.value };
      }))).filter((row): row is NonNullable<typeof row> => row !== null).sort((left,right) => left.fileId.localeCompare(right.fileId));
    };
    const beforeA = await readScoped(setA);
    const beforeB = await readScoped(setB);
    expect(beforeA).toHaveLength(2);
    expect(beforeB).toHaveLength(1);
    expect([...beforeA,...beforeB].every((row) => row.definitionId === DEFINITION)).toBe(true);
    expect(new Set([...beforeA,...beforeB].map((row) => row.bindingId)).size).toBe(3);
    expect(new Set([...beforeA,...beforeB].map((row) => row.sourceOccurrenceId)).size).toBe(3);
    const targetBefore = beforeA.find((row) => row.fileId === sources[0]!.file.id)!;
    const siblingBefore = beforeA.find((row) => row.fileId === sources[1]!.file.id)!;
    const otherBefore = beforeB[0]!;
    const otherFileBefore = await getProjectParameterFileById(db,{ organizationId: ORG,fileId: otherBefore.fileId });
    expect(otherFileBefore?.currentVersionId).toBe(otherBefore.fileVersionId);
    const otherSourceBefore = await loadCanonicalSourceSnapshot(db,storage,{ organizationId: ORG,projectId: PROJECT,bindingId: otherBefore.bindingId,projectValueId: otherBefore.currentValueId });

    const draft = await createCanonicalValueDraft(db,auth,{ projectId: PROJECT,bindingId: targetBefore.bindingId,baseRevisionId: targetBefore.configRevisionId,
      sourceTarget: { format: "json",sourceText: "12.5" },reason: "Isolated JSON occurrence apply" },
      { objectStore: storage,invocation: createUserInvocation(auth),requestId: "t11-json-isolation-draft",refusalSink });
    const request = await submitCanonicalValueChange(db,auth,{ projectId: PROJECT,draftId: draft.id,invocation: createUserInvocation(auth),requestId: "t11-json-isolation-submit",refusalSink });
    const reviewer = makeTestAuthContext({ userId: "reviewer-t11-json-isolation",organizationId: ORG,permissions: ["parameter:view","parameter:edit","parameter:review"] });
    await db.query(`insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Isolation reviewer','Admin',true)`,[reviewer.user.id,ORG]);
    await db.query(
      `insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
       values ('t11-json-isolation-reviewer-role',$1,$2,$3,'software-committer')`,
      [reviewer.user.id, ORG, PROJECT]
    );
    const applied = await reviewCanonicalValueChange(db,reviewer,{ projectId: PROJECT,requestId: request.id,decision: "approve" },{
      objectStore: storage,snapshot,invocation: createUserInvocation(reviewer),traceId: "t11-json-isolation-apply",refusalSink,
    });
    expect(applied.status).toBe("approved");

    const afterA = await readScoped(setA);
    const afterB = await readScoped(setB);
    const targetAfter = afterA.find((row) => row.fileId === targetBefore.fileId)!;
    const siblingAfter = afterA.find((row) => row.fileId === siblingBefore.fileId)!;
    const otherAfter = afterB[0]!;
    expect(targetAfter).toMatchObject({ bindingId: targetBefore.bindingId,sourceOccurrenceId: targetBefore.sourceOccurrenceId,fileId: targetBefore.fileId,value: 12.5 });
    expect(targetAfter.currentValueId).not.toBe(targetBefore.currentValueId);
    expect(targetAfter.sourcePinId).not.toBe(targetBefore.sourcePinId);
    expect(targetAfter.fileVersionId).not.toBe(targetBefore.fileVersionId);
    expect(siblingAfter).toMatchObject({ bindingId: siblingBefore.bindingId,sourceOccurrenceId: siblingBefore.sourceOccurrenceId,fileId: siblingBefore.fileId,fileVersionId: siblingBefore.fileVersionId,value: 11.5 });
    expect(siblingAfter.currentValueId).not.toBe(siblingBefore.currentValueId);
    expect(siblingAfter.sourcePinId).not.toBe(siblingBefore.sourcePinId);
    expect(siblingAfter.configRevisionId).toBe(targetAfter.configRevisionId);
    expect(otherAfter).toEqual(otherBefore);
    expect(await getProjectParameterFileById(db,{ organizationId: ORG,fileId: otherBefore.fileId })).toEqual(otherFileBefore);
    expect(await loadCanonicalSourceSnapshot(db,storage,{ organizationId: ORG,projectId: PROJECT,bindingId: otherAfter.bindingId,projectValueId: otherAfter.currentValueId })).toEqual(otherSourceBefore);
  });

  it("deletes an escaped empty JSON member, preserves null semantics, and keeps the tombstone terminal", async () => {
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published fixture is unavailable");
    const deleteSet = (await createConfigSet(db,auth,{ projectId: PROJECT,name: "JSON deletion" })).id;
    const deleteSource = '{ "a/b": { "": null, "keep": true }, "untouched": [1,2] }\n';
    const expectedAfterDelete = '{ "a/b": {  "keep": true }, "untouched": [1,2] }\n';
    const uploaded = await uploadProjectParameterFile(db,storage,auth,{ projectId: PROJECT,fileName: "delete.json",bytes: Buffer.from(deleteSource) });
    await addConfigSetFile(db,auth,{ configSetId: deleteSet,fileId: uploaded.file.id,role: "base",sortOrder: 0 });
    const registered = await db.transaction((tx) => registerCanonicalJsonSource(tx,storage,auth,snapshot,{
      projectId: PROJECT,configSetId: deleteSet,fileId: uploaded.file.id,fileVersionId: uploaded.version.id,
      configurationSchemaId: MODEL,rootPointer: "/a~1b",mappings: [{ definitionId: DEFINITION,pointer: "/a~1b/" }],
      invocation: createUserInvocation(auth),requestId: "t11-json-delete-register",refusalSink,
    }));
    const target = registered.bindings[0]!;
    const targetBefore = await loadCanonicalSourceSnapshot(db,storage,{ organizationId: ORG,projectId: PROJECT,bindingId: target.id,projectValueId: target.currentValueId });
    expect(targetBefore.files[0]?.content).toBe(deleteSource);
    expect(targetBefore.manifest.locator).toEqual({ kind: "json-pointer",pointer: "/a~1b/" });
    expect((await loadProjectValueById(asValueClient(db),target.currentValueId))?.value).toBeNull();
    const historyBeforeDelete = await readCanonicalBindingChangeHistory(getRootPostgresPool(db)!,{ organizationId: ORG,projectId: PROJECT,bindingId: target.id });

    const siblingRegistered = await db.transaction((tx) => registerCanonicalJsonSource(tx,storage,auth,snapshot,{
      projectId: PROJECT,configSetId: deleteSet,fileId: uploaded.file.id,fileVersionId: uploaded.version.id,
      configurationSchemaId: MODEL,rootPointer: "",mappings: [{ definitionId: DEFINITION,pointer: "/untouched/0" }],
      invocation: createUserInvocation(auth),requestId: "t11-json-delete-sibling-register",refusalSink,
    }));
    const sibling = siblingRegistered.bindings[0]!;
    const reviewer = makeTestAuthContext({ userId: "reviewer-t11-json-delete",organizationId: ORG,permissions: ["parameter:view","parameter:edit","parameter:review"] });
    await db.query(`insert into users(id,organization_id,name,title,is_active) values ($1,$2,'JSON delete reviewer','Admin',true)`, [reviewer.user.id,ORG]);
    await db.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ($1,$2,$3,$4,'software-committer')`,
      ["t11-json-delete-reviewer-role",reviewer.user.id,ORG,PROJECT]);

    const draft = await createCanonicalValueDraft(db,auth,{
      projectId: PROJECT,bindingId: target.id,baseRevisionId: targetBefore.manifest.configRevisionId,
      action: "delete",reason: "Remove obsolete empty JSON member",
    },{ objectStore: storage,invocation: createUserInvocation(auth),requestId: "t11-json-delete-draft",refusalSink });
    expect(draft).toMatchObject({ action: "delete",sourceFormat: "json",targetValue: "",currentValueId: target.currentValueId });
    const submitted = await submitCanonicalValueChange(db,auth,{ projectId: PROJECT,draftId: draft.id,assignedToUserId: reviewer.user.id,
      invocation: createUserInvocation(auth),requestId: "t11-json-delete-submit",refusalSink });
    expect(submitted).toMatchObject({ action: "delete",sourceFormat: "json",status: "pending",targetValue: "" });
    const candidateKey = (await db.query<{ storage_key: string }>(`select storage_key from project_parameter_file_candidates where id=$1`, [draft.candidateId])).rows[0]!.storage_key;
    const beforeTamperedApply = await captureConfigurationSourceState(db,{ organizationId: ORG,projectId: PROJECT });
    const tamperedStorage = { ...storage,getBounded: async (key: string,limit: number) => key === candidateKey
      ? Buffer.from('{"a/b":{"keep":false},"untouched":[1,2]}\n')
      : storage.getBounded!(key,limit) };
    await expect(reviewCanonicalValueChange(db,reviewer,{ projectId: PROJECT,requestId: submitted.id,decision: "approve" },{
      objectStore: tamperedStorage,snapshot,invocation: createUserInvocation(reviewer),traceId: "t11-json-delete-tampered",refusalSink,
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await captureConfigurationSourceState(db,{ organizationId: ORG,projectId: PROJECT })).toEqual(beforeTamperedApply);

    const beforeAuditFailure = await captureConfigurationSourceState(db,{ organizationId: ORG,projectId: PROJECT });
    await db.query(`create function public.t11_fail_json_delete_audit() returns trigger language plpgsql as $$ begin
      if new.trace_id='t11-json-delete-audit-failure' and new.action='value-change-applied' then raise exception 't11-injected-json-delete-audit-failure'; end if;
      return new; end $$`);
    await db.query(`create trigger t11_fail_json_delete_audit before insert on audit_events for each row execute function public.t11_fail_json_delete_audit()`);
    try {
      await expect(reviewCanonicalValueChange(db,reviewer,{ projectId: PROJECT,requestId: submitted.id,decision: "approve" },{
        objectStore: storage,snapshot,invocation: createUserInvocation(reviewer),traceId: "t11-json-delete-audit-failure",refusalSink,
      })).rejects.toThrow("t11-injected-json-delete-audit-failure");
      expect(await captureConfigurationSourceState(db,{ organizationId: ORG,projectId: PROJECT })).toEqual(beforeAuditFailure);
    } finally {
      await db.query(`drop trigger t11_fail_json_delete_audit on audit_events`);
      await db.query(`drop function public.t11_fail_json_delete_audit()`);
    }

    const beforeLocatorDigestFailure = await captureConfigurationSourceState(db,{ organizationId: ORG,projectId: PROJECT });
    await db.query(`create function public.t11_corrupt_json_delete_locator_digest() returns trigger language plpgsql as $$ begin
      if new.format='json' and new.value_state='deleted' then
        new.locator_digest='sha256:0000000000000000000000000000000000000000000000000000000000000000';
      end if;
      return new; end $$`);
    await db.query(`create trigger t11_corrupt_json_delete_locator_digest before insert on parameter_catalog.project_value_source_pins
      for each row execute function public.t11_corrupt_json_delete_locator_digest()`);
    try {
      await expect(reviewCanonicalValueChange(db,reviewer,{ projectId: PROJECT,requestId: submitted.id,decision: "approve" },{
        objectStore: storage,snapshot,invocation: createUserInvocation(reviewer),traceId: "t11-json-delete-locator-digest",refusalSink,
      })).rejects.toMatchObject({ code: "23503" });
      expect(await captureConfigurationSourceState(db,{ organizationId: ORG,projectId: PROJECT })).toEqual(beforeLocatorDigestFailure);
    } finally {
      await db.query(`drop trigger t11_corrupt_json_delete_locator_digest on parameter_catalog.project_value_source_pins`);
      await db.query(`drop function public.t11_corrupt_json_delete_locator_digest()`);
    }

    const applied = await reviewCanonicalValueChange(db,reviewer,{ projectId: PROJECT,requestId: submitted.id,decision: "approve" },{
      objectStore: storage,snapshot,invocation: createUserInvocation(reviewer),traceId: "t11-json-delete-approve",refusalSink,
    });
    expect(applied).toMatchObject({ action: "delete",sourceFormat: "json",status: "approved",appliedValueId: expect.any(String) });
    const deletedValueId = applied.appliedValueId!;
    const deletedState = (await db.query<{
      current_value_id: string; value_state: string; value: unknown; value_digest: string; source_pin_id: string;
      base_source_pin_id: string; delete_request_id: string; locator: Record<string, unknown>; delete_proof: Record<string, unknown>;
    }>(`select binding.current_value_id,value.value_state,value.value,value.value_digest,pin.id as source_pin_id,
        pin.base_source_pin_id,pin.delete_request_id,pin.locator,pin.delete_proof
      from parameter_catalog.project_parameter_bindings binding
      join parameter_catalog.project_parameter_values value on value.id=binding.current_value_id
      join parameter_catalog.project_value_source_pins pin on pin.project_value_id=value.id and pin.binding_id=binding.id
      where binding.organization_id=$1 and binding.project_id=$2 and binding.id=$3`, [ORG,PROJECT,target.id])).rows[0]!;
    expect(deletedState).toMatchObject({ current_value_id: deletedValueId,value_state: "deleted",value: null,base_source_pin_id: targetBefore.manifest.sourcePinId,delete_request_id: submitted.id });
    expect(deletedState.locator).toEqual({ kind: "json-delete",rootPointer: "/a~1b",pointer: "/a~1b/",parentPointer: "/a~1b",memberKey: "",fileVersionId: expect.any(String) });
    expect(deletedState.delete_proof).toMatchObject({ kind: "json-delete-v1",scannerVersion: "json-span-v1",rootPointer: "/a~1b",pointer: "/a~1b/",parentPointer: "/a~1b",memberKey: "",beforeValueDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),beforeSourceDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),afterSourceDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) });

    const deletedSnapshot = await loadCanonicalSourceSnapshot(db,storage,{ organizationId: ORG,projectId: PROJECT,bindingId: target.id,projectValueId: deletedValueId });
    expect(deletedSnapshot.manifest.valueState).toBe("deleted");
    expect(deletedSnapshot.manifest.baseSourcePinId).toBe(targetBefore.manifest.sourcePinId);
    expect(deletedSnapshot.manifest.deleteRequestId).toBe(submitted.id);
    expect(deletedSnapshot.files[0]?.content).toBe(expectedAfterDelete);
    let reintroducedError: unknown;
    let reintroducedResult: unknown;
    const reintroducedRollback = new Error("rollback deleted JSON re-registration probe");
    await expect(db.transaction(async (tx) => {
      const reintroducedBytes = Buffer.from(deleteSource);
      const reintroducedObject = await storage.put({
        organizationId: ORG,
        fileName: "delete.json",
        contentType: "application/json",
        bytes: reintroducedBytes,
      });
      const reintroducedVersion = await insertFileVersion(tx, {
        id: randomUUID(),
        fileId: deletedSnapshot.manifest.fileId,
        versionNumber: 0,
        storageKey: reintroducedObject.storageKey,
        checksum: reintroducedObject.checksumSha256,
        sizeBytes: reintroducedObject.fileSizeBytes,
        parsedIndex: {},
        origin: "upload",
        createdByUserId: USER,
      });
      await tx.query("update project_parameter_files set current_version_id=$2 where id=$1", [deletedSnapshot.manifest.fileId, reintroducedVersion.id]);
      try {
        reintroducedResult = await registerCanonicalJsonSource(tx,storage,auth,snapshot,{
          projectId: PROJECT,configSetId: deletedSnapshot.manifest.configSetId,fileId: deletedSnapshot.manifest.fileId,fileVersionId: reintroducedVersion.id,
          configurationSchemaId: MODEL,rootPointer: "/a~1b",mappings: [{ definitionId: DEFINITION,pointer: "/a~1b/" }],
          invocation: createUserInvocation(auth),requestId: "t11-json-delete-reintroduced",refusalSink,
        });
      } catch (error) {
        reintroducedError = error;
      }
      throw reintroducedRollback;
    })).rejects.toBe(reintroducedRollback);
    expect(reintroducedResult).toBeUndefined();
    expect(reintroducedError).toMatchObject({ code: "CONFLICT" });

    const beforeForgedPin = await captureConfigurationSourceState(db,{ organizationId: ORG,projectId: PROJECT });
    await expect(db.transaction(async (tx) => {
      await tx.query("set local role catalog_migration_owner");
      const forgedValueId = randomUUID();
      await tx.query(`insert into parameter_catalog.project_parameter_values
        (id,binding_id,definition_id,definition_revision_id,source_ref,config_revision_id,value_digest,value_kind,value,value_state)
        select $1,binding_id,definition_id,definition_revision_id,source_ref,config_revision_id,value_digest,value_kind,value,value_state
        from parameter_catalog.project_parameter_values where id=$2`, [forgedValueId,deletedValueId]);
      await tx.query(`insert into parameter_catalog.project_value_source_pins
        (id,project_value_id,binding_id,definition_id,organization_id,project_id,source_occurrence_id,config_revision_id,file_id,file_version_id,
          format,locator,locator_digest,property_occurrence_id,value_state,base_source_pin_id,delete_request_id,delete_proof)
        select $1,$2,binding_id,definition_id,organization_id,project_id,source_occurrence_id,config_revision_id,file_id,file_version_id,
          format,locator,locator_digest,property_occurrence_id,value_state,base_source_pin_id,delete_request_id,delete_proof
        from parameter_catalog.project_value_source_pins where id=$3`, [randomUUID(),forgedValueId,deletedState.source_pin_id]);
      await tx.query("set constraints parameter_catalog.project_value_source_pin_owner_fk immediate");
      throw new Error("A delete request's proof was accepted for a different applied value");
    })).rejects.toMatchObject({ code: "23503" });
    expect(await captureConfigurationSourceState(db,{ organizationId: ORG,projectId: PROJECT })).toEqual(beforeForgedPin);
    const router = createRouter();
    registerCatalogProjectValueConsumerRoutes(router,{ db,objectStore: storage,getCurrentAuthContext: () => auth });
    const exported = catalogBindingExportResponseSchema.parse((await requestJson(createHttpServer(router),
      `/api/v2/projects/${PROJECT}/parameter-bindings/${target.id}/export?projectValueId=${deletedValueId}`)).body).item;
    expect(exported.valueState).toBe("deleted");
    expect(exported.currentValueId).toBe(deletedValueId);
    expect(exported.manifest).toMatchObject({ valueState: "deleted",baseSourcePinId: targetBefore.manifest.sourcePinId,deleteRequestId: submitted.id,locator: deletedState.locator,deleteProof: deletedState.delete_proof });
    expect(exported.files[0]?.content).toBe(expectedAfterDelete);
    expect((await readSourceBindings()).filter((row) => row.id === target.id)).toEqual([]);
    expect((await readSourceBindings()).find((row) => row.id === sibling.id)?.value).toBe(1);
    const historyAfterDelete = await readCanonicalBindingChangeHistory(getRootPostgresPool(db)!,{ organizationId: ORG,projectId: PROJECT,bindingId: target.id });
    expect(historyAfterDelete).toHaveLength((historyBeforeDelete?.length ?? 0) + 1);
    expect(historyAfterDelete?.[0]).toEqual(expect.objectContaining({ oldCurrentValueId: target.currentValueId,newCurrentValueId: deletedValueId,valueState: "deleted" }));

    const deletedMutationState = await captureConfigurationSourceState(db,{ organizationId: ORG,projectId: PROJECT });
    await expect(createCanonicalValueDraft(db,auth,{ projectId: PROJECT,bindingId: target.id,baseRevisionId: deletedSnapshot.manifest.configRevisionId,
      sourceTarget: { format: "json",sourceText: "3" },reason: "Attempt to edit deleted JSON binding" },
      { objectStore: storage,invocation: createUserInvocation(auth),requestId: "t11-json-delete-after-set",refusalSink })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await captureConfigurationSourceState(db,{ organizationId: ORG,projectId: PROJECT })).toEqual(deletedMutationState);
    await expect(createCanonicalValueDraft(db,auth,{ projectId: PROJECT,bindingId: target.id,baseRevisionId: deletedSnapshot.manifest.configRevisionId,
      action: "delete",reason: "Attempt to delete deleted JSON binding again" },
      { objectStore: storage,invocation: createUserInvocation(auth),requestId: "t11-json-delete-after-delete",refusalSink })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await captureConfigurationSourceState(db,{ organizationId: ORG,projectId: PROJECT })).toEqual(deletedMutationState);

    const replayBefore = await captureConfigurationSourceState(db,{ organizationId: ORG,projectId: PROJECT });
    const deletedMember = deletedSnapshot.manifest.members.find((member) => member.fileId === deletedSnapshot.manifest.fileId);
    expect(deletedMember).toBeDefined();
    const appliedStorageKey = (await db.query<{ storage_key: string }>(`select storage_key from project_parameter_file_versions where id=$1`, [deletedMember!.fileVersionId])).rows[0]?.storage_key;
    expect(appliedStorageKey).toBeTruthy();
    const tamperedAppliedStorage = { ...storage,getBounded: async (key: string,limit: number) => key === appliedStorageKey
      ? Buffer.from(expectedAfterDelete.replace('"keep": true','"keep": false'))
      : storage.getBounded!(key,limit) };
    await expect(reviewCanonicalValueChange(db,reviewer,{ projectId: PROJECT,requestId: submitted.id,decision: "approve" },{
      objectStore: tamperedAppliedStorage,snapshot,invocation: createUserInvocation(reviewer),traceId: "t11-json-delete-replay-tampered",refusalSink,
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await captureConfigurationSourceState(db,{ organizationId: ORG,projectId: PROJECT })).toEqual(replayBefore);
    expect(await reviewCanonicalValueChange(db,reviewer,{ projectId: PROJECT,requestId: submitted.id,decision: "approve" },{
      objectStore: storage,snapshot,invocation: createUserInvocation(reviewer),traceId: "t11-json-delete-replay",refusalSink,
    })).toMatchObject({ status: "approved",appliedValueId: deletedValueId });
    expect(await captureConfigurationSourceState(db,{ organizationId: ORG,projectId: PROJECT })).toEqual(replayBefore);

    const siblingCurrent = (await readSourceBindings()).find((row) => row.id === sibling.id);
    expect(siblingCurrent).toBeDefined();
    const siblingBefore = await loadCanonicalSourceSnapshot(db,storage,{ organizationId: ORG,projectId: PROJECT,bindingId: sibling.id,projectValueId: siblingCurrent!.current_value_id });
    const siblingDraft = await createCanonicalValueDraft(db,auth,{ projectId: PROJECT,bindingId: sibling.id,baseRevisionId: siblingBefore.manifest.configRevisionId,
      sourceTarget: { format: "json",sourceText: "2" },reason: "Advance present sibling after deletion" },
      { objectStore: storage,invocation: createUserInvocation(auth),requestId: "t11-json-delete-sibling-draft",refusalSink });
    const siblingRequest = await submitCanonicalValueChange(db,auth,{ projectId: PROJECT,draftId: siblingDraft.id,assignedToUserId: reviewer.user.id,
      invocation: createUserInvocation(auth),requestId: "t11-json-delete-sibling-submit",refusalSink });
    await expect(reviewCanonicalValueChange(db,reviewer,{ projectId: PROJECT,requestId: siblingRequest.id,decision: "approve" },{
      objectStore: storage,snapshot,invocation: createUserInvocation(reviewer),traceId: "t11-json-delete-sibling-approve",refusalSink,
    })).resolves.toMatchObject({ status: "approved" });
    const targetAfterSibling = (await db.query<{ current_value_id: string; deleted_pins: string; deleted_history: string }>(`select binding.current_value_id,
        (select count(*)::text from parameter_catalog.project_value_source_pins where binding_id=binding.id and value_state='deleted') as deleted_pins,
        (select count(*)::text from parameter_catalog.binding_history_events where binding_id=binding.id and new_current_value_id=$4) as deleted_history
      from parameter_catalog.project_parameter_bindings binding where binding.organization_id=$1 and binding.project_id=$2 and binding.id=$3`,
      [ORG,PROJECT,target.id,deletedValueId])).rows[0]!;
    expect(targetAfterSibling).toEqual({ current_value_id: deletedValueId,deleted_pins: "1",deleted_history: "1" });
    expect((await readSourceBindings()).find((row) => row.id === sibling.id)?.value).toBe(2);
    expect((await readSourceBindings()).find((row) => row.id === target.id)).toBeUndefined();
    const terminalHistory = await readCanonicalBindingChangeHistory(getRootPostgresPool(db)!,{ organizationId: ORG,projectId: PROJECT,bindingId: target.id });
    expect(terminalHistory).toEqual(historyAfterDelete);
    const terminalExport = catalogBindingExportResponseSchema.parse((await requestJson(createHttpServer(router),
      `/api/v2/projects/${PROJECT}/parameter-bindings/${target.id}/export?projectValueId=${deletedValueId}`)).body).item;
    expect(terminalExport.files[0]?.content).toBe(expectedAfterDelete);
  });
});
