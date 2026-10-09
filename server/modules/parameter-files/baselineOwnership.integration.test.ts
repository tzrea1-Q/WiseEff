import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { adminConnectionString, applyMigrations, migrationsDir } from "../../testing/tempDatabase";
import { captureConfigurationSourceState, installConfigurationSourceFixture } from "../../testing/parameterCatalog/configurationSource";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { createUserInvocation } from "../auth/trustedInvocation";
import { loadPublishedCatalog } from "../parameter-bindings/catalogProjectValueSync";
import { addConfigSetFile, createConfigSet } from "./configSetService";
import { insertReleaseBaseline, insertReleaseBaselineMember } from "./baselineRepository";
import { registerCanonicalJsonSource } from "./canonicalJsonSource";
import { uploadProjectParameterFile } from "./service";
import * as sourceRepository from "./repository";
import { ApiError } from "../../shared/http/errors";
import type { RestorePreviewResult } from "./baselineService";

const organizationId = "org-baseline-ownership";
const projectId = "project-baseline-ownership";
const userId = "user-baseline-ownership";
const schemaId = "wiseeff.baseline.limits";
const databaseName = `${process.env.WISEEFF_TEST_DATABASE_PREFIX ?? "t1065"}_${randomUUID().replaceAll("-", "")}`;

describe("assembled baseline source ownership API", () => {
  let db: ReturnType<typeof createPostgresDatabase>;
  let server: ReturnType<typeof createWiseEffServer>;
  let canonical: { baselineId: string; fileId: string; configSetId: string; versionId: string };
  let legacy: typeof canonical;
  let cohortMember: typeof canonical;
  const storage = createMemoryObjectStore();
  const auth = makeTestAuthContext({
    organizationId, userId, roles: [{ roleId: "admin", projectId: null }],
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"]
  });

  async function request<Body = unknown>(path: string, method = "GET", requestId = randomUUID()) {
    return requestJson<Body>(server, `/api/v1/projects/${projectId}/baselines/${path}`, {
      method,
      headers: { "X-WiseEff-User": userId, "X-Request-Id": requestId }
    });
  }

  async function seedBaseline(name: string, configSetId?: string) {
    const configSet = configSetId ? { id: configSetId } : await createConfigSet(db, auth, { projectId, name });
    const original = await uploadProjectParameterFile(db, storage, auth, {
      projectId, fileName: `${name}.json`, bytes: Buffer.from('{"limit":1000}')
    });
    await addConfigSetFile(db, auth, {
      configSetId: configSet.id, fileId: original.file.id, role: configSetId ? "misc" : "base", sortOrder: configSetId ? 1 : 0
    });
    const baseline = await insertReleaseBaseline(db, {
      id: randomUUID(), organizationId, configSetId: configSet.id, name, createdByUserId: userId
    });
    await insertReleaseBaselineMember(db, {
      id: randomUUID(), baselineId: baseline.id, fileId: original.file.id,
      fileVersionId: original.version.id, versionNumber: 1
    });
    const current = await uploadProjectParameterFile(db, storage, auth, {
      projectId, fileName: `${name}.json`, bytes: Buffer.from('{"limit":2000}')
    });
    return { baselineId: baseline.id, fileId: original.file.id, configSetId: configSet.id, versionId: current.version.id };
  }

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: adminConnectionString() });
    await admin.connect();
    try {
      await admin.query(`create database ${databaseName}`);
    } finally {
      await admin.end();
    }
    db = createPostgresDatabase(adminConnectionString(databaseName));
    await applyMigrations(db, migrationsDir);
    await seedCoreGraph(db, {
      organization: { id: organizationId }, users: [{ id: userId }], projects: [{ id: projectId }]
    });
    await db.query(`insert into user_role_bindings(id,user_id,organization_id,role_id)
      values ($1,$2,$3,'admin')`, [randomUUID(), userId, organizationId]);
    await installConfigurationSourceFixture(db, auth, { subjectId: "csub_baseline_limits", schemaId });
    canonical = await seedBaseline("canonical");
    legacy = await seedBaseline("legacy");
    cohortMember = await seedBaseline("cohort-member", canonical.configSetId);
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!snapshot) throw new Error("Published fixture unavailable");
    await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, auth, snapshot, {
      projectId, configSetId: canonical.configSetId, fileId: canonical.fileId, fileVersionId: canonical.versionId,
      configurationSchemaId: schemaId, rootPointer: "", mappings: [{ definitionId: "pdef_acme_power_iin_max", pointer: "/limit" }],
      invocation: createUserInvocation(auth), requestId: "baseline-source-registration", refusalSink: createTrustedRefusalAuditSink(db)
    }));
    server = createWiseEffServer({ db, objectStore: storage, auth: { mode: "development" } });
  }, 120_000);

  afterAll(async () => {
    await db?.close();
    const admin = new pg.Client({ connectionString: adminConnectionString() });
    await admin.connect();
    try {
      await admin.query(`drop database if exists ${databaseName}`);
    } finally {
      await admin.end();
    }
  });

  it("exposes canonical ownership and drift, refusing rollback without changing source truth", async () => {
    const before = await captureConfigurationSourceState(db, { organizationId, projectId });
    const preview = await request<{ item: RestorePreviewResult }>(`${canonical.baselineId}/restore-preview`);
    expect(preview.status).toBe(200);
    expect(preview.body.item as RestorePreviewResult).toMatchObject({
      driftedCount: 1, releasedBaselineUnchanged: true,
      members: [{ fileId: canonical.fileId, canonicalOwned: true, action: "rollback-pointer", fromVersionNumber: 2, toVersionNumber: 1 }]
    });
    const requestId = randomUUID();
    const rollback = await request(`${canonical.baselineId}/rollback`, "POST", requestId);
    expect(rollback).toMatchObject({ status: 409, body: { error: {
      code: "CONFLICT", message: "Canonical source changes require a prepared and approved source transaction.",
      details: { reason: "canonical-source-transaction-required" }
    } } });
    const after = await captureConfigurationSourceState(db, { organizationId, projectId });
    expect(after.audits.filter((event) => event.trace === requestId)).toEqual([
      expect.objectContaining({ action: "deny", target: canonical.baselineId })
    ]);
    expect({ ...after, audits: after.audits.filter((event) => event.trace !== requestId) }).toEqual(before);
  });

  it("exposes legacy ownership and still restores legacy-owned sources", async () => {
    const preview = await request<{ item: RestorePreviewResult }>(`${legacy.baselineId}/restore-preview`);
    expect(preview.status).toBe(200);
    expect(preview.body.item).toMatchObject({ driftedCount: 1, members: [{ canonicalOwned: false }] });
    const rollback = await request(`${legacy.baselineId}/rollback`, "POST");
    expect(rollback).toMatchObject({ status: 200, body: { item: { baselineId: legacy.baselineId, restored: 1 } } });
    const restored = await request<{ item: RestorePreviewResult }>(`${legacy.baselineId}/restore-preview`);
    expect(restored.body.item.members[0].fromVersionNumber).toBe(3);
  });

  it("persists the trusted canonical rollback refusal audit after the source transaction rolls back", async () => {
    const requestId = randomUUID();
    const rollback = await request(`${canonical.baselineId}/rollback`, "POST", requestId);
    expect(rollback.status).toBe(409);
    const audit = await db.query(`select organization_id,project_id,actor_user_id,actor_type,action,target_id,metadata
      from audit_events where trace_id=$1`, [requestId]);
    expect(audit.rows).toEqual([expect.objectContaining({
      organization_id: organizationId, project_id: projectId, actor_user_id: userId, actor_type: "user",
      action: "deny", target_id: canonical.baselineId,
      metadata: expect.objectContaining({ initiator: "user", operation: "baseline-rollback",
        reason: "canonical-source-transaction-required" })
    })]);
  });

  it("audits the canonical source transaction refusal independently of message wording", async () => {
    const assertAllowed = sourceRepository.assertLegacySourceMutationAllowed;
    const guard = vi.spyOn(sourceRepository, "assertLegacySourceMutationAllowed").mockImplementation(async (...args) => {
      try {
        await assertAllowed(...args);
      } catch (error) {
        if (error instanceof ApiError && error.code === "CONFLICT") {
          error.message = "Review and approve the canonical source transaction before restoring.";
        }
        throw error;
      }
    });
    try {
      const before = await captureConfigurationSourceState(db, { organizationId, projectId });
      const requestId = randomUUID();
      const rollback = await request(`${canonical.baselineId}/rollback`, "POST", requestId);
      expect(rollback).toMatchObject({ status: 409, body: { error: {
        code: "CONFLICT", message: "Review and approve the canonical source transaction before restoring.",
        details: { reason: "canonical-source-transaction-required" }
      } } });
      const audit = await db.query(`select actor_user_id,actor_type,action,metadata from audit_events where trace_id=$1`, [requestId]);
      expect(audit.rows).toEqual([expect.objectContaining({
        actor_user_id: userId, actor_type: "user", action: "deny",
        metadata: expect.objectContaining({ initiator: "user", operation: "baseline-rollback", reason: "canonical-source-transaction-required" })
      })]);
      const after = await captureConfigurationSourceState(db, { organizationId, projectId });
      expect({ ...after, audits: after.audits.filter((event) => event.trace !== requestId) }).toEqual(before);
    } finally {
      guard.mockRestore();
    }
  });

  it("marks a member canonically owned when only its Config set has a canonical source occurrence", async () => {
    expect((await db.query(`select id from parameter_catalog.project_parameter_source_occurrences where file_id=$1`,
      [cohortMember.fileId])).rows).toEqual([]);
    const preview = await request<{ item: RestorePreviewResult }>(`${cohortMember.baselineId}/restore-preview`);
    expect(preview).toMatchObject({ status: 200, body: { item: { driftedCount: 1,
      members: [{ fileId: cohortMember.fileId, canonicalOwned: true }] } } });
    const before = await captureConfigurationSourceState(db, { organizationId, projectId });
    const requestId = randomUUID();
    expect((await request(`${cohortMember.baselineId}/rollback`, "POST", requestId)).status).toBe(409);
    const after = await captureConfigurationSourceState(db, { organizationId, projectId });
    expect(after.audits.filter((event) => event.trace === requestId)).toHaveLength(1);
    expect({ ...after, audits: after.audits.filter((event) => event.trace !== requestId) }).toEqual(before);
  });
});
