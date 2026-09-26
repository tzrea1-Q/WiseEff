import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresDatabase, getRootPostgresPool } from "../../../shared/database/client";
import { createHttpServer } from "../../../shared/http/server";
import { createRouter } from "../../../shared/http/router";
import { requestJson } from "../../../test/testClient";
import { makeTestAuthContext } from "../../../testing/authContext";
import { installConfigurationSourceFixture } from "../../../testing/parameterCatalog/configurationSource";
import { createEphemeralTestDatabase } from "../../../testing/testDatabase";
import { createUserInvocation } from "../../auth/trustedInvocation";
import { createTrustedRefusalAuditSink } from "../../audit/trustedRefusalSink";
import { createLocalObjectStore } from "../../logs/objectStore";
import { loadPublishedCatalog } from "../catalogProjectValueSync";
import { registerCatalogProjectValueConsumerRoutes } from "../catalogProjectValueRoutes";
import { registerCanonicalJsonSource } from "../../parameter-files/canonicalJsonSource";
import { addConfigSetFile, createConfigSet } from "../../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../../parameter-files/service";
import { insertFileVersion } from "../../parameter-files/repository";

const organizationId = "org-906-c-member-entry";
const projectId = "project-906-c-member-entry";
const adminId = "user-906-c-member-admin";
const reviewerId = "user-906-c-member-reviewer";
const otherReviewerId = "user-906-c-member-other-reviewer";
const schemaId = "wiseeff.906.c.member.entry";
const definitionId = "pdef_acme_power_iin_max";
const admin = makeTestAuthContext({ userId: adminId, organizationId,
  permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  roles: [{ roleId: "admin", projectId: null }] });
const reviewer = makeTestAuthContext({ userId: reviewerId, organizationId,
  permissions: ["parameter:view", "parameter:edit", "parameter:review"],
  roles: [{ roleId: "software-committer", projectId }] });
const reviewerWithoutEdit = makeTestAuthContext({ userId: reviewerId, organizationId,
  permissions: ["parameter:view", "parameter:review"],
  roles: [{ roleId: "software-committer", projectId }] });
const otherReviewer = makeTestAuthContext({ userId: otherReviewerId, organizationId,
  permissions: ["parameter:view", "parameter:edit", "parameter:review"],
  roles: [{ roleId: "software-committer", projectId }] });
const foreign = makeTestAuthContext({ userId: "user-906-c-member-foreign", organizationId: "org-906-c-member-foreign",
  permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  roles: [{ roleId: "admin", projectId: null }] });
const wrongProject = makeTestAuthContext({ userId: "user-906-c-member-unscoped", organizationId,
  permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  roles: [{ roleId: "software-committer", projectId: "another-project" }] });

describe("#906 C reviewed JSON member removal HTTP entry", () => {
  let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let storageDirectory: string;
  let storage: ReturnType<typeof createLocalObjectStore>;
  let configSetId: string;
  let removedFileId: string;
  let pendingId: string;
  let pendingDigest: string;

  const route = (auth = admin, objectStore: typeof storage | null = storage) => {
    const router = createRouter();
    registerCatalogProjectValueConsumerRoutes(router, { db, objectStore: objectStore ?? undefined,
      getCurrentAuthContext: () => auth });
    return createHttpServer(router);
  };
  const submitPath = () => `/api/v2/projects/${projectId}/parameter-value-change-requests/member-removals`;
  const submit = (auth = admin) => requestJson<{ item: { id: string; status: string; proofDigest: string;
    fileVersionId: string; frozenProof: { fileId: string; cohort: unknown[] } } }>(
    route(auth), submitPath(), { method: "POST", body: JSON.stringify({
      configSetId, fileId: removedFileId, assignedToUserId: reviewerId, reason: "Retire reviewed JSON member"
    }) }
  );
  const review = (requestId: string, proofDigest: string, decision: "approve" | "reject" = "approve",
    auth = reviewer, objectStore: typeof storage | null = storage) => requestJson<{
      item: { id: string; status: string; proofDigest: string; appliedSourceResult: unknown }
    }>(route(auth, objectStore),
      `/api/v2/projects/${projectId}/parameter-value-change-requests/${requestId}/review`,
      { method: "POST", body: JSON.stringify({ decision, memberProofDigest: proofDigest }) });
  const reviewWithoutProof = (requestId: string, auth = reviewer) => requestJson(route(auth),
    `/api/v2/projects/${projectId}/parameter-value-change-requests/${requestId}/review`,
    { method: "POST", body: JSON.stringify({ decision: "reject" }) });
  const withdraw = (requestId: string, auth = admin) => requestJson<{ item: { status: string } }>(
    route(auth), `/api/v2/projects/${projectId}/parameter-value-change-requests/${requestId}/withdraw`,
    { method: "POST" });

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("issue906-c-member-entry");
    db = createPostgresDatabase(database.url);
    storageDirectory = await mkdtemp(join(tmpdir(), "wiseeff-906-c-member-entry-"));
    storage = createLocalObjectStore(storageDirectory);
    await db.query("insert into organizations(id,name) values ($1,'#906 C member'),($2,'#906 foreign')",
      [organizationId, foreign.organization.id]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'admin','Admin',true),($3,$2,'reviewer','Reviewer',true),($4,$5,'foreign','Admin',true),($6,$2,'other reviewer','Reviewer',true)",
      [adminId, organizationId, reviewerId, foreign.user.id, foreign.organization.id, otherReviewerId]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'unscoped','Reviewer',true)",
      [wrongProject.user.id, organizationId]);
    await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'Member entry','C906','initialized')",
      [projectId, organizationId]);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('role-906-c-admin',$1,$2,null,'admin'),('role-906-c-reviewer',$3,$2,$4,'software-committer'),('role-906-c-other-reviewer',$5,$2,$4,'software-committer')",
      [adminId, organizationId, reviewerId, projectId, otherReviewerId]);
    await installConfigurationSourceFixture(db, admin, { subjectId: "csub_906_c_member", schemaId });
    configSetId = (await createConfigSet(db, admin, { projectId, name: "reviewed members" })).id;
    const removed = await uploadProjectParameterFile(db, storage, admin, {
      projectId, fileName: "removed.json", bytes: Buffer.from('{"limit":36}\n')
    });
    const survivor = await uploadProjectParameterFile(db, storage, admin, {
      projectId, fileName: "survivor.json", bytes: Buffer.from('{"limit":48}\n')
    });
    removedFileId = removed.file.id;
    await addConfigSetFile(db, admin, { configSetId, fileId: removed.file.id, role: "base", sortOrder: 0 });
    await addConfigSetFile(db, admin, { configSetId, fileId: survivor.file.id, role: "overlay", sortOrder: 1 });
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published Catalog fixture is unavailable");
    for (const file of [removed, survivor]) {
      await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, snapshot, {
        projectId, configSetId, fileId: file.file.id, fileVersionId: file.version.id,
        configurationSchemaId: schemaId, rootPointer: "", mappings: [{ definitionId, pointer: "/limit" }],
        invocation: createUserInvocation(admin), requestId: `register:${file.file.id}`,
        refusalSink: createTrustedRefusalAuditSink(db)
      }));
    }
  }, 120_000);

  afterAll(async () => {
    await db?.close();
    await database?.drop();
    if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
  });

  it("submits one frozen member-removal request for a separate human reviewer", async () => {
    const response = await submit();
    expect(response.status).toBe(201);
    expect(response.body.item).toMatchObject({ status: "pending", frozenProof: {
      fileId: removedFileId, cohort: expect.any(Array)
    }});
    expect(response.body.item.proofDigest).toMatch(/^[0-9a-f]{64}$/);
    expect((await db.query<{ request_kind: string; assigned_to_user_id: string;
      member_proof_digest: string; member_frozen_proof: unknown }>(
      "select request_kind,assigned_to_user_id,member_proof_digest,member_frozen_proof from project_parameter_value_change_requests where id=$1",
      [response.body.item.id]
    )).rows[0]).toEqual({ request_kind: "member-removal", assigned_to_user_id: reviewerId,
      member_proof_digest: response.body.item.proofDigest,
      member_frozen_proof: response.body.item.frozenProof });
    pendingId = response.body.item.id;
    pendingDigest = response.body.item.proofDigest;
    const retry = await submit();
    expect(retry.status).toBe(201);
    expect(retry.body.item.id).toBe(pendingId);
    expect((await db.query<{ count: number }>(`select count(*)::int as count from audit_events
      where action='value-change-submitted' and target_id=$1`, [pendingId])).rows[0]!.count).toBe(1);
    const detail = await requestJson(route(reviewer),
      `/api/v2/projects/${projectId}/parameter-value-change-requests/${pendingId}/member-removal`);
    expect(detail.status).toBe(200);
    expect((await requestJson(route(reviewer),
      `/api/v2/projects/${projectId}/parameter-value-change-requests/member-removals?status=pending`)).status).toBe(200);
  }, 120_000);

  it("conceals foreign requests and lets the separate reviewer reject without touching the source", async () => {
    expect((await submit(foreign)).status).toBe(404);
    expect((await requestJson(route(foreign),
      `/api/v2/projects/${projectId}/parameter-value-change-requests/${pendingId}/member-removal`)).status).toBe(404);
    expect((await review("missing-member-removal", pendingDigest, "reject")).status).toBe(404);
    expect((await review(pendingId, pendingDigest, "reject", foreign)).status).toBe(404);
    const deniedBefore = (await db.query<{ count: number }>(`select count(*)::int as count from audit_events
      where target_id=$1 and kind='parameter-source-permission-denied' and action='deny'`, [pendingId])).rows[0]!.count;
    expect((await review(pendingId, pendingDigest, "reject", admin)).status).toBe(404);
    expect((await review(pendingId, pendingDigest, "reject", otherReviewer)).status).toBe(404);
    expect((await db.query<{ count: number }>(`select count(*)::int as count from audit_events
      where target_id=$1 and kind='parameter-source-permission-denied' and action='deny'`, [pendingId])).rows[0]!.count).toBe(deniedBefore + 2);
    expect((await reviewWithoutProof("missing-member-removal")).status).toBe(404);
    expect((await reviewWithoutProof(pendingId, foreign)).status).toBe(404);
    expect((await reviewWithoutProof(pendingId, admin)).status).toBe(404);
    expect((await reviewWithoutProof(pendingId, otherReviewer)).status).toBe(404);
    expect((await reviewWithoutProof(pendingId, reviewerWithoutEdit)).status).toBe(403);
    const missingProof = await reviewWithoutProof(pendingId);
    expect(missingProof.status).toBe(400);
    expect(missingProof.body).toMatchObject({ error: { details: {
      reason: "canonical-member-removal-proof-required"
    } } });
    await db.query("delete from user_role_bindings where id='role-906-c-reviewer'");
    try {
      expect((await review(pendingId, pendingDigest, "reject")).status).toBe(403);
      expect((await reviewWithoutProof(pendingId)).status).toBe(403);
    } finally {
      await db.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
        values ('role-906-c-reviewer',$1,$2,$3,'software-committer')`,
      [reviewerId, organizationId, projectId]);
    }
    const rejected = await review(pendingId, pendingDigest, "reject");
    expect(rejected.status).toBe(200);
    expect(rejected.body.item.status).toBe("rejected");
    expect((await review(pendingId, pendingDigest, "reject")).body).toEqual(rejected.body);
    expect((await review(pendingId, pendingDigest)).status).toBe(409);
    expect((await db.query<{ count: number }>(`select count(*)::int as count from audit_events
      where action='value-change-reviewed' and target_id=$1`, [pendingId])).rows[0]!.count).toBe(1);
    expect((await db.query<{ count: number }>(`select count(*)::int as count
      from parameter_catalog.project_source_member_tombstones where file_id=$1`,
    [removedFileId])).rows[0]!.count).toBe(0);
  }, 120_000);

  it("checks project scope before storage and keeps authorized storage failures explicit", async () => {
    expect((await requestJson(route(wrongProject, null), submitPath(), {
      method: "POST", body: JSON.stringify({ configSetId, fileId: removedFileId,
        assignedToUserId: reviewerId, reason: "retire member" })
    })).status).toBe(403);
    expect((await requestJson(route(admin, null), submitPath(), {
      method: "POST", body: JSON.stringify({ configSetId, fileId: removedFileId,
        assignedToUserId: reviewerId, reason: "retire member" })
    })).status).toBe(500);
    expect((await requestJson(route(wrongProject, null),
      `/api/v2/projects/${projectId}/parameter-value-change-requests/${pendingId}/member-removal`)).status).toBe(404);
    expect((await review(pendingId, pendingDigest, "approve", wrongProject, null)).status).toBe(404);
    expect((await review(pendingId, pendingDigest, "reject", reviewerWithoutEdit, null)).status).toBe(403);
    expect((await db.query<{ count: number }>(`select count(*)::int as count from audit_events
      where kind='parameter-source-permission-denied' and target_id=$1`,
    [pendingId])).rows[0]!.count).toBeGreaterThan(0);
  }, 120_000);

  it("allows only the submitter to withdraw an intact pending removal", async () => {
    const pending = await submit();
    expect(pending.status).toBe(201);
    expect((await withdraw(pending.body.item.id, reviewer)).status).toBe(403);
    const withdrawn = await withdraw(pending.body.item.id);
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.item.status).toBe("withdrawn");
    expect((await withdraw(pending.body.item.id)).body).toEqual(withdrawn.body);
    expect((await review(pending.body.item.id, pending.body.item.proofDigest)).status).toBe(409);
    expect((await db.query<{ count: number }>(`select count(*)::int as count from audit_events
      where action='value-change-withdrawn' and target_id=$1`,
    [pending.body.item.id])).rows[0]!.count).toBe(1);
  }, 120_000);

  it("rejects a stale frozen file version and leaves the pending request and cohort intact", async () => {
    const pending = await submit();
    expect(pending.status).toBe(201);
    const oldVersion = (await db.query<{
      storage_key: string; checksum: string; size_bytes: number; parsed_index: unknown
    }>(`select storage_key,checksum,size_bytes::float8 as size_bytes,parsed_index
      from project_parameter_file_versions where id=$1`, [pending.body.item.fileVersionId])).rows[0]!;
    const currentVersion = (await db.query<{ current_version_id: string }>(
      "select current_version_id from project_parameter_files where id=$1", [removedFileId]
    )).rows[0]!.current_version_id;
    const drift = await insertFileVersion(db, {
      id: randomUUID(), fileId: removedFileId, storageKey: oldVersion.storage_key,
      checksum: oldVersion.checksum, sizeBytes: oldVersion.size_bytes,
      parsedIndex: oldVersion.parsed_index as Record<string, unknown>, origin: "upload", createdByUserId: adminId
    });
    await db.query("update project_parameter_files set current_version_id=$2 where id=$1", [removedFileId, drift.id]);
    try {
      const stale = await review(pending.body.item.id, pending.body.item.proofDigest);
      expect(stale.status).toBe(409);
      expect(stale.body).toMatchObject({ error: { code: "CONFLICT",
        message: "Current source members differ from the exact pinned revision." } });
    } finally {
      await db.query("update project_parameter_files set current_version_id=$2 where id=$1", [removedFileId, currentVersion]);
    }
    expect((await db.query<{ status: string }>(
      "select status from project_parameter_value_change_requests where id=$1", [pending.body.item.id]
    )).rows[0]!.status).toBe("pending");
    expect((await db.query<{ count: number }>(`select count(*)::int as count
      from parameter_catalog.project_source_member_tombstones where file_id=$1`,
    [removedFileId])).rows[0]!.count).toBe(0);
    expect((await withdraw(pending.body.item.id)).status).toBe(200);
  }, 120_000);

  it("approves one exact proof atomically, rejects a mismatched digest and replays the same receipt", async () => {
    const pending = await submit();
    expect(pending.status).toBe(201);
    const id = pending.body.item.id;
    const digest = pending.body.item.proofDigest;
    expect((await review(id, "0".repeat(64))).status).toBe(409);
    let reads = 0;
    const brokenStore = { ...storage, getBounded: async (key: string, maxBytes: number) => {
      if (++reads === 2) throw new Error("injected-member-read-failure");
      return storage.getBounded!(key, maxBytes);
    } };
    expect((await review(id, digest, "approve", reviewer, brokenStore)).status).toBe(409);
    expect((await db.query<{ status: string }>(
      "select status from project_parameter_value_change_requests where id=$1", [id]
    )).rows[0]!.status).toBe("pending");
    expect((await db.query<{ count: number }>(`select count(*)::int as count
      from parameter_catalog.project_source_member_tombstones where file_id=$1`,
    [removedFileId])).rows[0]!.count).toBe(0);
    const approved = await review(id, digest);
    expect(approved.status).toBe(200);
    expect(approved.body.item).toMatchObject({ status: "approved", appliedSourceResult: {
      tombstoneId: expect.any(String), successorConfigRevisionId: expect.any(String)
    }});
    expect((await review(id, digest)).body).toEqual(approved.body);
    expect((await db.query<{ config_set_id: string | null }>(
      "select config_set_id from project_parameter_files where id=$1", [removedFileId]
    )).rows[0]!.config_set_id).toBeNull();
  }, 120_000);
});
