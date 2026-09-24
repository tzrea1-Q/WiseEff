import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import { installConfigurationSourceFixture } from "../../testing/parameterCatalog/configurationSource";
import { asAuditTx, writeAuditEventInTx } from "../audit/auditedWrite";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { createUserInvocation } from "../auth/trustedInvocation";
import { loadPublishedCatalog } from "../parameter-bindings/catalogProjectValueSync";
import { createLocalObjectStore } from "../logs/objectStore";
import { createConfigSet, addConfigSetFile } from "./configSetService";
import { uploadProjectParameterFile } from "./service";
import { registerCanonicalJsonSource } from "./canonicalJsonSource";
import { applyReviewedCanonicalMemberRemoval, prepareCanonicalMemberRemoval,
  type ReviewedCanonicalMemberRemoval } from "./canonicalMemberRemoval";
import { insertFileVersion } from "./repository";

const organizationId = "org-906-member-cohort";
const projectId = "project-906-member-cohort";
const adminId = "user-906-member-admin";
const reviewerId = "user-906-member-reviewer";
const schemaId = "wiseeff.906.member.cohort";
const definitionId = "pdef_acme_power_iin_max";

const admin = makeTestAuthContext({
  userId: adminId, organizationId,
  permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  roles: [{ roleId: "admin", projectId: null }]
});
const reviewer = makeTestAuthContext({
  userId: reviewerId, organizationId,
  permissions: ["parameter:view", "parameter:edit", "parameter:review"],
  roles: [{ roleId: "software-committer", projectId }]
});
const foreignAdmin = makeTestAuthContext({
  userId: "user-906-member-foreign", organizationId: "org-906-member-foreign",
  permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  roles: [{ roleId: "admin", projectId: null }]
});

describe("#906 reviewed canonical member removal cohort", () => {
  let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let storageDirectory: string;
  let storage: ReturnType<typeof createLocalObjectStore>;
  let configSetId: string;
  let removedFileId: string;
  let siblingFileId: string;

  async function submitReview(review: ReviewedCanonicalMemberRemoval): Promise<void> {
    await db.query(`insert into public.project_parameter_value_change_requests
      (id,organization_id,project_id,request_kind,reason,status,submitter_user_id,
       assigned_to_user_id,member_file_id,member_config_set_id,member_file_version_id,
       member_proof_digest,member_frozen_proof)
      values ($1,$2,$3,'member-removal','Remove source member','pending',$4,$5,$6,$7,$8,$9,$10::jsonb)`,
    [review.requestId, organizationId, projectId, review.submitterUserId,
      review.reviewerUserId, review.frozen.fileId, review.frozen.configSetId,
      review.frozen.fileVersionId, review.frozen.proofDigest, JSON.stringify(review.frozen)]);
  }

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("issue906-member-cohort");
    db = createPostgresDatabase(database.url);
    storageDirectory = await mkdtemp(join(tmpdir(), "wiseeff-906-member-cohort-"));
    storage = createLocalObjectStore(storageDirectory);
    await db.query("insert into organizations(id,name) values ($1,'#906 cohort')", [organizationId]);
    await db.query("insert into organizations(id,name) values ($1,'#906 foreign')", [foreignAdmin.organization.id]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'admin','Admin',true),($3,$2,'reviewer','Reviewer',true)", [adminId, organizationId, reviewerId]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'foreign','Admin',true)", [foreignAdmin.user.id, foreignAdmin.organization.id]);
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'Member cohort','M906','initialized')", [projectId, organizationId]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('role-906-member-admin',$1,$2,null,'admin'),('role-906-member-reviewer',$3,$2,$4,'software-committer')", [adminId, organizationId, reviewerId, projectId]);
    await installConfigurationSourceFixture(db, admin, { subjectId: "csub_906_member_cohort", schemaId });
    configSetId = (await createConfigSet(db, admin, { projectId, name: "two members" })).id;
    const removed = await uploadProjectParameterFile(db, storage, admin, {
      projectId, fileName: "removed.json", bytes: Buffer.from('{"limit":36}\n')
    });
    const sibling = await uploadProjectParameterFile(db, storage, admin, {
      projectId, fileName: "sibling.json", bytes: Buffer.from('{"limit":48,"other":{"limit":49}}\n')
    });
    removedFileId = removed.file.id;
    siblingFileId = sibling.file.id;
    await addConfigSetFile(db, admin, { configSetId, fileId: removedFileId, role: "base", sortOrder: 0 });
    await addConfigSetFile(db, admin, { configSetId, fileId: siblingFileId, role: "overlay", sortOrder: 1 });
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published Catalog fixture is unavailable");
    for (const [fileId, fileVersionId] of [[removedFileId, removed.version.id], [siblingFileId, sibling.version.id]]) {
      await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, snapshot, {
        projectId, configSetId, fileId, fileVersionId, configurationSchemaId: schemaId,
        rootPointer: "", mappings: [{ definitionId, pointer: "/limit" }],
        invocation: createUserInvocation(admin), requestId: `register:${fileId}`,
        refusalSink: createTrustedRefusalAuditSink(db)
      }));
    }
    await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, snapshot, {
      projectId, configSetId, fileId: siblingFileId, fileVersionId: sibling.version.id,
      configurationSchemaId: schemaId, rootPointer: "/other",
      mappings: [{ definitionId, pointer: "/other/limit" }],
      invocation: createUserInvocation(admin), requestId: "register:sibling-other",
      refusalSink: createTrustedRefusalAuditSink(db)
    }));
  }, 120_000);

  afterAll(async () => {
    await db?.close();
    await database?.drop();
    if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
  });

  it("records the current 0167 failure when a removed member has an active sibling", async () => {
    const before = (await db.query<{
      file_id: string; binding_id: string; value_id: string; pin_id: string;
      config_revision_id: string; file_version_id: string;
    }>(`select occurrence.file_id,binding.id as binding_id,binding.current_value_id as value_id,
        pin.id as pin_id,pin.config_revision_id,pin.file_version_id
      from parameter_catalog.current_project_parameter_bindings binding
      join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=binding.source_occurrence_id
      join parameter_catalog.project_value_source_pins pin on pin.binding_id=binding.id
        and pin.project_value_id=binding.current_value_id
      where binding.organization_id=$1 and binding.project_id=$2 and occurrence.config_set_id=$3
      order by occurrence.file_id,binding.id`, [organizationId, projectId, configSetId])).rows;
    expect(before.map((row) => row.file_id).sort())
      .toEqual([removedFileId, siblingFileId, siblingFileId].sort());
    const removed = before.find((row) => row.file_id === removedFileId)!;
    const auditId = randomUUID();
    const tombstoneId = randomUUID();
    const manifest = [{ bindingId: removed.binding_id, valueId: removed.value_id, sourcePinId: removed.pin_id }];
    await expect(db.transaction(async (tx) => {
      await writeAuditEventInTx(asAuditTx(tx), admin, { requestId: tombstoneId }, {
        id: auditId, app: "parameters", kind: "parameter-topology-governance",
        action: "source-member-removed", severity: "Medium", projectId,
        targetType: "project-parameter-file", targetId: removedFileId,
        metadata: { tombstoneId, configSetId, configRevisionId: removed.config_revision_id,
          fileVersionId: removed.file_version_id, bindings: manifest }
      });
      await tx.query(`insert into parameter_catalog.project_source_member_tombstones
        (id,organization_id,project_id,config_set_id,file_id,config_revision_id,
         file_version_id,binding_manifest,audit_event_id)
        values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
      [tombstoneId, organizationId, projectId, configSetId, removedFileId,
        removed.config_revision_id, removed.file_version_id, JSON.stringify(manifest), auditId]);
      await tx.query(`update project_parameter_files set config_set_id=null,
        config_set_role=null,config_set_sort_order=0 where id=$1`, [removedFileId]);
    })).rejects.toThrow(/exact source cohort/);
    expect((await db.query<{ count: number }>(`select count(*)::int as count
      from parameter_catalog.project_source_member_tombstones where file_id=$1`, [removedFileId])).rows[0]!.count).toBe(0);
    expect((await db.query<{ config_set_id: string }>(
      "select config_set_id from project_parameter_files where id=$1", [removedFileId]
    )).rows[0]!.config_set_id).toBe(configSetId);
    expect((await db.query<{ id: string; current_value_id: string }>(`
      select id,current_value_id from parameter_catalog.project_parameter_bindings
      where id=any($1::text[]) order by id`, [before.map((row) => row.binding_id)])).rows)
      .toEqual(before.map((row) => ({ id: row.binding_id, current_value_id: row.value_id })).sort((a,b) => a.id.localeCompare(b.id)));
    expect((await db.query<{ id: string }>("select id from audit_events where id=$1", [auditId])).rows).toEqual([]);
  }, 120_000);

  it("keeps runtime roles away from direct tombstone writes and refuses a forged audited insert", async () => {
    const privileges = (await db.query<{ direct_insert: boolean; narrow_execute: boolean }>(`
      select has_table_privilege('parameter_governance_writer_role',
        'parameter_catalog.project_source_member_tombstones','INSERT') as direct_insert,
        has_function_privilege('parameter_governance_writer_role',
        'parameter_catalog.insert_reviewed_member_tombstone(text,text,text,text,text,text,text,jsonb,text,jsonb,text)',
        'EXECUTE') as narrow_execute`)).rows[0]!;
    expect(privileges).toEqual({ direct_insert: false, narrow_execute: true });
    await expect(db.transaction(async (tx) => {
      await tx.query("set local role parameter_governance_writer_role");
      await tx.query("insert into parameter_catalog.project_source_member_tombstones(id) values ('forged')");
    })).rejects.toMatchObject({ code: "42501" });
    await expect(db.transaction(async (tx) => {
      await tx.query("set local role parameter_governance_writer_role");
      await tx.query(`select parameter_catalog.insert_reviewed_member_tombstone(
        $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11)`,
      [randomUUID(), organizationId, projectId, configSetId, removedFileId,
        randomUUID(), randomUUID(), "[]", randomUUID(), "[]", randomUUID()]);
    })).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects incomplete frozen review identities at the PostgreSQL boundary", async () => {
    const frozen = await db.transaction((tx) => prepareCanonicalMemberRemoval(tx, storage, admin, {
      projectId, configSetId, fileId: removedFileId,
      invocation: createUserInvocation(admin), traceId: "prepare-incomplete-review",
      refusalSink: createTrustedRefusalAuditSink(db)
    }));
    for (const [digest, proof] of [
      [null, frozen],
      [frozen.proofDigest, { ...frozen, members: undefined, cohort: undefined }],
      [frozen.proofDigest, { ...frozen, organizationId: undefined }]
    ] as const) {
      await expect(db.query(`insert into public.project_parameter_value_change_requests
        (id,organization_id,project_id,request_kind,reason,status,submitter_user_id,
         assigned_to_user_id,member_file_id,member_config_set_id,member_file_version_id,
         member_proof_digest,member_frozen_proof)
        values ($1,$2,$3,'member-removal','Incomplete proof','pending',$4,$5,$6,$7,$8,$9,$10::jsonb)`,
      [randomUUID(), organizationId, projectId, adminId, reviewerId,
        frozen.fileId, frozen.configSetId, frozen.fileVersionId, digest,
        JSON.stringify(proof)])).rejects.toMatchObject({ code: "23514" });
    }
  }, 120_000);

  it("rejects stale source, self review and other tenants before any cohort write", async () => {
    const frozen = await db.transaction((tx) => prepareCanonicalMemberRemoval(tx, storage, admin, {
      projectId, configSetId, fileId: removedFileId,
      invocation: createUserInvocation(admin), traceId: "prepare-member-stale",
      refusalSink: createTrustedRefusalAuditSink(db)
    }));
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published Catalog fixture is unavailable");
    const review = { requestId: "reviewed-member-stale", submitterUserId: adminId,
      reviewerUserId: reviewerId, decision: "approve" as const, frozen };
    await submitReview(review);
    const apply = (auth: typeof reviewer, currentReview = review) => db.transaction((tx) =>
      applyReviewedCanonicalMemberRemoval(tx, storage, auth, snapshot, currentReview, {
        invocation: createUserInvocation(auth), traceId: currentReview.requestId,
        refusalSink: createTrustedRefusalAuditSink(db)
      }));
    await expect(apply(reviewer, { ...review, frozen: { ...frozen, proofDigest: '0'.repeat(64) } }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    await expect(apply(admin))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(apply(foreignAdmin)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(db.transaction((tx) => prepareCanonicalMemberRemoval(tx, storage, foreignAdmin, {
      projectId, configSetId, fileId: removedFileId,
      invocation: createUserInvocation(foreignAdmin), traceId: "foreign-member-prepare",
      refusalSink: createTrustedRefusalAuditSink(db)
    }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    const oldVersion = (await db.query<{ storage_key: string; checksum: string; size_bytes: number; parsed_index: unknown }>(`
      select storage_key,checksum,size_bytes::float8 as size_bytes,parsed_index
      from project_parameter_file_versions where id=$1`, [frozen.fileVersionId])).rows[0]!;
    const drift = await insertFileVersion(db, {
      id: randomUUID(), fileId: removedFileId, storageKey: oldVersion.storage_key,
      checksum: oldVersion.checksum, sizeBytes: oldVersion.size_bytes,
      parsedIndex: oldVersion.parsed_index as Record<string, unknown>, origin: "upload", createdByUserId: adminId
    });
    await db.query("update project_parameter_files set current_version_id=$2 where id=$1", [removedFileId, drift.id]);
    try {
      await expect(apply(reviewer)).rejects.toMatchObject({ code: "CONFLICT" });
    } finally {
      await db.query("update project_parameter_files set current_version_id=$2 where id=$1", [removedFileId, frozen.fileVersionId]);
    }
    expect((await db.query<{ count: number }>(`
      select count(*)::int as count from parameter_catalog.project_source_member_tombstones
      where file_id=$1`, [removedFileId])).rows[0]!.count).toBe(0);
    expect((await db.query<{ status: string; applied_at: Date | null }>(`
      select status,applied_at from project_parameter_value_change_requests where id=$1`,
    [review.requestId])).rows).toEqual([{ status: "pending", applied_at: null }]);
  }, 120_000);

  it("rolls back every sibling Value, pin, history, revision, tombstone and audit on a later fault", async () => {
    const frozen = await db.transaction((tx) => prepareCanonicalMemberRemoval(tx, storage, admin, {
      projectId, configSetId, fileId: removedFileId,
      invocation: createUserInvocation(admin), traceId: "prepare-member-fault",
      refusalSink: createTrustedRefusalAuditSink(db)
    }));
    const review = { requestId: "reviewed-member-fault", submitterUserId: adminId,
      reviewerUserId: reviewerId, decision: "approve" as const, frozen };
    await submitReview(review);
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published Catalog fixture is unavailable");
    const before = (await db.query<{ values: number; pins: number; history: number; revisions: number }>(`
      select (select count(*)::int from parameter_catalog.project_parameter_values) as values,
        (select count(*)::int from parameter_catalog.project_value_source_pins) as pins,
        (select count(*)::int from parameter_catalog.binding_history_events) as history,
        (select count(*)::int from dts_config_revisions where config_set_id=$1) as revisions`,
    [configSetId])).rows[0]!;
    await expect(db.transaction(async (tx) => {
      await applyReviewedCanonicalMemberRemoval(tx, storage, reviewer, snapshot, review, {
        invocation: createUserInvocation(reviewer), traceId: review.requestId,
        refusalSink: createTrustedRefusalAuditSink(db)
      });
      throw new Error("injected-member-fault");
    })).rejects.toThrow("injected-member-fault");
    expect((await db.query<typeof before>(`
      select (select count(*)::int from parameter_catalog.project_parameter_values) as values,
        (select count(*)::int from parameter_catalog.project_value_source_pins) as pins,
        (select count(*)::int from parameter_catalog.binding_history_events) as history,
        (select count(*)::int from dts_config_revisions where config_set_id=$1) as revisions`,
    [configSetId])).rows[0]).toEqual(before);
    expect((await db.query<{ count: number }>(`
      select count(*)::int as count from parameter_catalog.project_source_member_tombstones
      where file_id=$1`, [removedFileId])).rows[0]!.count).toBe(0);
    expect((await db.query<{ count: number }>(`
      select count(*)::int as count from audit_events where metadata->>'reviewRequestId'=$1`,
    [review.requestId])).rows[0]!.count).toBe(0);
    expect((await db.query<{ config_set_id: string }>(`
      select config_set_id from project_parameter_files where id=$1`, [removedFileId])).rows[0]!.config_set_id)
      .toBe(configSetId);
    const sibling = frozen.cohort.find((row) => row.fileId === siblingFileId)!;
    expect((await db.query<{ current_value_id: string }>(`
      select current_value_id from parameter_catalog.project_parameter_bindings where id=$1`,
    [sibling.bindingId])).rows[0]!.current_value_id).toBe(sibling.oldValueId);
  }, 120_000);

  it("rolls back the complete cohort when PostgreSQL rejects the tombstone insert", async () => {
    const frozen = await db.transaction((tx) => prepareCanonicalMemberRemoval(tx, storage, admin, {
      projectId, configSetId, fileId: removedFileId,
      invocation: createUserInvocation(admin), traceId: "prepare-member-pg-fault",
      refusalSink: createTrustedRefusalAuditSink(db)
    }));
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published Catalog fixture is unavailable");
    const requestId = "reviewed-member-pg-fault";
    await submitReview({ requestId, submitterUserId: adminId, reviewerUserId: reviewerId,
      decision: "approve", frozen });
    const before = (await db.query<{ values: number; pins: number; history: number; revisions: number }>(`
      select (select count(*)::int from parameter_catalog.project_parameter_values) as values,
        (select count(*)::int from parameter_catalog.project_value_source_pins) as pins,
        (select count(*)::int from parameter_catalog.binding_history_events) as history,
        (select count(*)::int from dts_config_revisions where config_set_id=$1) as revisions`,
    [configSetId])).rows[0]!;
    await db.query(`create function public.t906_member_tombstone_fail() returns trigger
      language plpgsql as $$ begin raise exception 'injected-member-tombstone-failure'; end $$`);
    await db.query(`create trigger t906_member_tombstone_fail before insert
      on parameter_catalog.project_source_member_tombstones for each row
      execute function public.t906_member_tombstone_fail()`);
    try {
      await expect(db.transaction((tx) => applyReviewedCanonicalMemberRemoval(
        tx, storage, reviewer, snapshot,
        { requestId, submitterUserId: adminId, reviewerUserId: reviewerId,
          decision: "approve", frozen },
        { invocation: createUserInvocation(reviewer), traceId: requestId,
          refusalSink: createTrustedRefusalAuditSink(db) }
      ))).rejects.toThrow("injected-member-tombstone-failure");
    } finally {
      await db.query("drop trigger t906_member_tombstone_fail on parameter_catalog.project_source_member_tombstones");
      await db.query("drop function public.t906_member_tombstone_fail()");
    }
    expect((await db.query<typeof before>(`
      select (select count(*)::int from parameter_catalog.project_parameter_values) as values,
        (select count(*)::int from parameter_catalog.project_value_source_pins) as pins,
        (select count(*)::int from parameter_catalog.binding_history_events) as history,
        (select count(*)::int from dts_config_revisions where config_set_id=$1) as revisions`,
    [configSetId])).rows[0]).toEqual(before);
    expect((await db.query<{ count: number }>(`
      select count(*)::int as count from audit_events where metadata->>'reviewRequestId'=$1`,
    [requestId])).rows[0]!.count).toBe(0);
    expect((await db.query<{ count: number }>(`
      select count(*)::int as count from parameter_catalog.project_source_member_tombstones
      where file_id=$1`, [removedFileId])).rows[0]!.count).toBe(0);
    expect((await db.query<{ config_set_id: string }>(`
      select config_set_id from project_parameter_files where id=$1`, [removedFileId])).rows[0]!.config_set_id)
      .toBe(configSetId);
  }, 120_000);

  it("leaves the reviewed request and source cohort untouched when object storage fails", async () => {
    const frozen = await db.transaction((tx) => prepareCanonicalMemberRemoval(tx, storage, admin, {
      projectId, configSetId, fileId: removedFileId,
      invocation: createUserInvocation(admin), traceId: "prepare-member-storage-fault",
      refusalSink: createTrustedRefusalAuditSink(db)
    }));
    const review = { requestId: "reviewed-member-storage-fault", submitterUserId: adminId,
      reviewerUserId: reviewerId, decision: "approve" as const, frozen };
    await submitReview(review);
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published Catalog fixture is unavailable");
    const before = (await db.query<{ values: number; pins: number; history: number; revisions: number }>(`
      select (select count(*)::int from parameter_catalog.project_parameter_values) as values,
        (select count(*)::int from parameter_catalog.project_value_source_pins) as pins,
        (select count(*)::int from parameter_catalog.binding_history_events) as history,
        (select count(*)::int from dts_config_revisions where config_set_id=$1) as revisions`,
    [configSetId])).rows[0]!;
    const cohortQuery = `select binding.id,binding.current_value_id,pin.id as pin_id,
        pin.config_revision_id,pin.file_version_id,file.config_set_id,file.current_version_id
      from parameter_catalog.current_project_parameter_bindings binding
      join parameter_catalog.project_parameter_source_occurrences occurrence
        on occurrence.id=binding.source_occurrence_id
      join parameter_catalog.project_value_source_pins pin
        on pin.binding_id=binding.id and pin.project_value_id=binding.current_value_id
      join public.project_parameter_files file on file.id=occurrence.file_id
      where binding.organization_id=$1 and binding.project_id=$2
        and occurrence.config_set_id=$3 order by binding.id`;
    const cohortBefore = (await db.query(cohortQuery,
      [organizationId, projectId, configSetId])).rows;
    expect(cohortBefore).toHaveLength(3);
    let reads = 0;
    const failingStorage = { ...storage, getBounded: async (key: string, maxBytes: number) => {
      if (++reads === 2) throw new Error("injected-object-store-read-failure");
      return storage.getBounded!(key, maxBytes);
    } };
    await expect(db.transaction((tx) => applyReviewedCanonicalMemberRemoval(
      tx, failingStorage, reviewer, snapshot, review, {
        invocation: createUserInvocation(reviewer), traceId: review.requestId,
        refusalSink: createTrustedRefusalAuditSink(db)
      }))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(reads).toBe(2);
    expect((await db.query<typeof before>(`
      select (select count(*)::int from parameter_catalog.project_parameter_values) as values,
        (select count(*)::int from parameter_catalog.project_value_source_pins) as pins,
        (select count(*)::int from parameter_catalog.binding_history_events) as history,
        (select count(*)::int from dts_config_revisions where config_set_id=$1) as revisions`,
    [configSetId])).rows[0]).toEqual(before);
    expect((await db.query(cohortQuery,
      [organizationId, projectId, configSetId])).rows).toEqual(cohortBefore);
    expect((await db.query<{ status: string; applied_at: Date | null }>(`
      select status,applied_at from project_parameter_value_change_requests where id=$1`,
    [review.requestId])).rows).toEqual([{ status: "pending", applied_at: null }]);
    expect((await db.query<{ count: number }>(`
      select count(*)::int as count from parameter_catalog.project_source_member_tombstones
      where file_id=$1`, [removedFileId])).rows[0]!.count).toBe(0);
  }, 120_000);

  it("commits one reviewed removal with every surviving Value, pin, history and tombstone", async () => {
    const frozen = await db.transaction((tx) => prepareCanonicalMemberRemoval(tx, storage, admin, {
      projectId, configSetId, fileId: removedFileId,
      invocation: createUserInvocation(admin), traceId: "prepare-member-removal",
      refusalSink: createTrustedRefusalAuditSink(db)
    }));
    expect(frozen.cohort).toHaveLength(3);
    const review = { requestId: "reviewed-member-removal-1", submitterUserId: adminId,
      reviewerUserId: reviewerId, decision: "approve" as const, frozen };
    await submitReview(review);
    const otherReview = { requestId: "reviewed-member-other-author", submitterUserId: reviewerId,
      reviewerUserId: adminId, decision: "approve" as const, frozen };
    await submitReview(otherReview);
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published Catalog fixture is unavailable");
    const apply = () => db.transaction((tx) => applyReviewedCanonicalMemberRemoval(
      tx, storage, reviewer, snapshot, review, {
        invocation: createUserInvocation(reviewer), traceId: review.requestId,
        refusalSink: createTrustedRefusalAuditSink(db)
      }
    ));
    const result = await apply();
    expect(result).toMatchObject({ requestId: review.requestId, replayed: false });
    expect(await apply()).toEqual({ ...result, replayed: true });
    await expect(db.query(`insert into public.project_parameter_value_change_requests
      (id,organization_id,project_id,request_kind,reason,status,submitter_user_id,
       assigned_to_user_id,reviewer_user_id,member_file_id,member_config_set_id,
       member_file_version_id,member_proof_digest,member_frozen_proof,applied_at,
       apply_outcome,applied_audit_ref,applied_file_version_ids,applied_source_result)
      values ($1,$2,$3,'member-removal','Missing version receipt','approved',$4,$5,$5,
        $6,$7,$8,$9,$10::jsonb,now(),'committed',$11,null,$12::jsonb)`,
    [randomUUID(), organizationId, projectId, adminId, reviewerId, frozen.fileId,
      frozen.configSetId, frozen.fileVersionId, frozen.proofDigest,
      JSON.stringify(frozen), randomUUID(), JSON.stringify(result)]))
      .rejects.toMatchObject({ code: "23514" });
    expect((await db.query<{ status: string; applied_audit_ref: string | null }>(`
      select status,applied_audit_ref from project_parameter_value_change_requests where id=$1`,
    [otherReview.requestId])).rows).toEqual([{ status: "pending", applied_audit_ref: null }]);
    await expect(db.transaction((tx) => applyReviewedCanonicalMemberRemoval(
      tx, storage, admin, snapshot, otherReview, {
        invocation: createUserInvocation(admin), traceId: otherReview.requestId,
        refusalSink: createTrustedRefusalAuditSink(db)
      }))).rejects.toMatchObject({ code: "CONFLICT" });
    const current = (await db.query<{ file_id: string; id: string; current_value_id: string;
      config_revision_id: string; file_version_id: string }>(`
      select occurrence.file_id,binding.id,binding.current_value_id,
        pin.config_revision_id,pin.file_version_id
      from parameter_catalog.current_project_parameter_bindings binding
      join parameter_catalog.project_parameter_source_occurrences occurrence
        on occurrence.id=binding.source_occurrence_id
      join parameter_catalog.project_value_source_pins pin
        on pin.binding_id=binding.id and pin.project_value_id=binding.current_value_id
      where binding.organization_id=$1 and binding.project_id=$2 and occurrence.config_set_id=$3`,
    [organizationId, projectId, configSetId])).rows;
    expect(current).toHaveLength(2);
    for (const binding of current) {
      const old = frozen.cohort.find((row) => row.bindingId === binding.id)!;
      expect(binding).toMatchObject({ file_id: siblingFileId,
        config_revision_id: result.successorConfigRevisionId,
        file_version_id: old.fileVersionId });
      expect(binding.current_value_id).not.toBe(old.oldValueId);
      expect((await db.query<{ count: number }>(`
        select count(*)::int as count from parameter_catalog.binding_history_events
        where binding_id=$1 and new_current_value_id=$2`,
      [binding.id, binding.current_value_id])).rows[0]!.count).toBe(1);
      expect((await db.query<{ count: number }>(`
        select count(*)::int as count from parameter_catalog.project_value_source_pins
        where binding_id=$1`, [binding.id])).rows[0]!.count).toBe(2);
    }
    expect((await db.query<{ id: string; config_set_id: string | null }>(`
      select id,config_set_id from project_parameter_files where id=$1`, [removedFileId])).rows)
      .toEqual([{ id: removedFileId, config_set_id: null }]);
    expect((await db.query<{ count: number }>(`
      select count(*)::int as count from parameter_catalog.project_parameter_bindings
      where id=$1`, [frozen.cohort.find((row) => row.fileId === removedFileId)!.bindingId])).rows[0]!.count).toBe(1);
  }, 120_000);
});
