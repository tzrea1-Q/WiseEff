import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../../shared/database/client";
import { createRetirementTestHarness } from "../../../testing/parameterCatalog/retirementHarness";
import { requestJson } from "../../../test/testClient";
import { applyMigrations } from "../../../shared/database/migrations";
import { seedM0Foundation } from "../../../../scripts/seed-m0";
import { seedPublishedCatalog } from "../../../testing/parameterCatalog/seedPublishedCatalog";
import { captureCurrentCatalogPin } from "../../catalog-publication/runtime";
import { createEvidenceIngest } from "../../parameter-governance/evidence";
import { createReviewQueueReader } from "../../parameter-governance/review";
import { createTokenVerifier } from "../../auth/tokenVerifier";
import { catalogReviewItemDtoSchema } from "../../contracts/dtoSchemas/parameterCatalog";

const headers = { "X-WiseEff-User": "t1068-org-admin" };
const successor = "/parameter-admin/specs?review=open";
const taskId = "t1068-historical-continuity";
const specTaskId = "t1068-historical-spec";

describe("assembled identity task read-window retirement", () => {
  let db: RootDatabase;
  let harness: ReturnType<typeof createRetirementTestHarness>;
  let admin: pg.Client;
  const databaseName = `t1068_tasks_${process.pid}_${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const url = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!);
    admin = new pg.Client({ connectionString: url.toString() });
    await admin.connect();
    await admin.query(`create database "${databaseName}"`);
    url.pathname = `/${databaseName}`;
    db = createPostgresDatabase(url.toString());
    await applyMigrations(db, path.resolve("server/migrations"));
    await seedM0Foundation(db);
    await db.query(`insert into users (id, organization_id, name, email, title, is_active)
      values ('t1068-org-admin', 'org-chargelab', 'Org Admin', 't1068-admin@example.com', 'Admin', true)`);
    await db.query(`insert into user_role_bindings (id, user_id, organization_id, role_id)
      values ('t1068-admin-role', 't1068-org-admin', 'org-chargelab', 'admin')`);
    await db.query(`insert into users (id, organization_id, name, email, title, is_active)
      values ('t1068-platform-only', 'org-chargelab', 'Platform Admin', 't1068-platform@example.com', 'Admin', true)`);
    await db.query(`insert into user_role_bindings (id, user_id, organization_id, role_id)
      values ('t1068-platform-role', 't1068-platform-only', 'org-chargelab', 'platform-admin')`);
    await seedPublishedCatalog(getRootPostgresPool(db)!);
    await db.query(`insert into projects (id, organization_id, name, code, status)
      values ('aurora', 'org-chargelab', 'Task read window', 'T1068', 'initialized')`);
    await db.query(`insert into dts_config_set (id, organization_id, project_id, name)
      values ('t1068-config', 'org-chargelab', 'aurora', 'Task read window')`);
    const id = "t1068-revision";
    const nodeId = "t1068-node";
    await db.query(`insert into dts_config_revisions
      (id, organization_id, project_id, config_set_id, revision_number, status, created_by_user_id)
      values ($1, 'org-chargelab', 'aurora', 't1068-config', 1, 'needs_mapping', 'u-xu-yun')`, [id]);
    await db.query(`insert into dts_logical_nodes (id, organization_id, project_id, config_set_id)
      values ($1, 'org-chargelab', 'aurora', 't1068-config')`, [nodeId]);
    await db.query(`insert into identity_mapping_tasks
      (id, organization_id, project_id, config_revision_id, previous_logical_node_id,
       candidate_logical_node_ids, evidence, status)
      values ($1, 'org-chargelab', 'aurora', $2, $3, $4::jsonb, '{"nodeName":"charger"}', 'open')`,
    [taskId, id, nodeId, JSON.stringify([nodeId])]);
    await db.query(`insert into parameter_spec_review_tasks
      (id, organization_id, source_evidence, candidate_schemas, status)
      values ($1, 'org-chargelab', '{"propertyKey":"gpio_int"}', '[]', 'open')`, [specTaskId]);
    harness = createRetirementTestHarness({
      db, legacyTables: ["identity_mapping_tasks", "parameter_spec_review_tasks", "dts_logical_nodes"],
    });
  });

  afterAll(async () => {
    await db?.close();
    await admin?.query(`drop database if exists "${databaseName}"`);
    await admin?.end();
  });

  it.each([
    `/api/v2/identity-mapping-tasks/${taskId}/resolve`,
    `/api/v2/identity-mapping-tasks/${taskId}/reopen`,
    `/api/v2/parameter-spec-review-tasks/${specTaskId}/resolve`,
  ])("retired %s links to the canonical Review Queue without modifying tasks", async (path) => {
    await harness.assertRetired({ method: "POST", path, successor }, { headers, body: "{}" });
    const response = await requestJson<{ error: { details: { successor: string } } }>(
      harness.server, path, { method: "POST", headers, body: "{}" },
    );
    expect(response.body.error.details.successor).toBe(successor);
    expect(response.headers.get("link")).toBe(`<${successor}>; rel="successor-version"`);
  });

  it.each([
    { path: "/api/v2/identity-mapping-tasks?projectId=aurora", id: taskId },
    { path: "/api/v2/parameter-spec-review-tasks?status=open", id: specTaskId },
  ])("$path does not infer canonical equivalence from a node or property name", async ({ path, id }) => {
    const response = await requestJson<{
      items: unknown[];
      historicalItems: Array<{ id: string; historicalOnly: boolean; needsCanonicalDecision: boolean; successor: string }>;
    }>(harness.server, path, { headers });
    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([]);
    expect(response.body.historicalItems).toContainEqual(expect.objectContaining({
      id, historicalOnly: true, needsCanonicalDecision: true, successor,
    }));
    expect(response.headers.get("deprecation")).toBe("true");
    expect(response.headers.get("link")).toBe(`<${successor}>; rel="successor-version"`);
    expect((await db.query("select status from identity_mapping_tasks where id = $1", [taskId])).rows)
      .toEqual([{ status: "open" }]);
  });

  it("adapts only the exact unresolved typed mapping to an authorized canonical Review Item", async () => {
    const pool = getRootPostgresPool(db)!;
    const pin = (await captureCurrentCatalogPin(pool))!;
    const evidence = await createEvidenceIngest(pool).ingest({
      organizationId: "org-chargelab", sourceIdentity: "t1068-exact-spec-evidence",
      catalogReleaseId: pin.id, matcherRevision: "t1068-matcher", matcherOutput: { status: "unknown" },
      evidence: { propertyKey: "gpio_int" }, provenance: null,
    });
    expect(evidence.ok).toBe(true);
    const queue = await createReviewQueueReader(pool).list({
      organizationId: "org-chargelab", capturedRelease: pin,
      context: { actorKind: "org-admin", organizationId: "org-chargelab", principalId: "t1068-org-admin" },
    });
    expect(queue.ok).toBe(true);
    if (!queue.ok || !evidence.ok || evidence.value.kind !== "review-evidence") throw new Error("Review fixture failed");
    const item = queue.value.items.find((entry) => entry.evidenceRefs.some((ref) => ref.id === evidence.value.id))!;
    expect(item).toBeDefined();
    await db.query(`insert into parameter_spec_review_tasks (id, organization_id, source_evidence, status)
      values ('t1068-exact-spec', 'org-chargelab', '{"propertyKey":"gpio_int"}', 'open')`);
    await db.query(`insert into parameter_catalog.legacy_identities
      (id, source_system, source_kind, owner_scope_kind, owner_scope_id, source_id)
      values ('t1068-exact-identity', 'wiseeff-v1', 'parameter-spec-review-task', 'organization', 'org-chargelab', 't1068-exact-spec')`);
    await db.query(`insert into parameter_catalog.parameter_catalog_cutover_runs
      (id, source_snapshot_fingerprint, target_artifact_sha, target_catalog_release_digest,
       migration_contract_version, plan_digest, current_phase, state)
      values ('t1068-read-cutover', 't1068-source', $1, $2, 't1068', 't1068-plan', 'P7', 'completed')`,
    ["a".repeat(40), pin.digest]);
    await db.query(`insert into parameter_catalog.legacy_mapping_versions
      (id, legacy_identity_id, cutover_run_id, version_number, source_checksum, graph_fingerprint,
       r_class, target_kind, target_id)
      values ('t1068-exact-version', 't1068-exact-identity', 't1068-read-cutover', 1, 't1068-checksum',
        't1068-graph', 'R3', 'review-item', $1)`, [item.id]);
    await db.query(`insert into parameter_catalog.legacy_mapping_heads
      (legacy_identity_id, current_version_id, cas_version)
      values ('t1068-exact-identity', 't1068-exact-version', 1)`);
    const read = () => requestJson<{ items: unknown[]; historicalItems: Array<{ id: string }> }>(
      harness.server, "/api/v2/parameter-spec-review-tasks?status=open", { headers },
    );
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(catalogReviewItemDtoSchema.parse(response.body.items[0])).toMatchObject({
      id: item.id, reason: "unknown", status: "open",
      candidates: [{ subjectId: "property:gpio_int", evidence: [expect.stringMatching(/^sha256:/)] }],
    });
    expect(response.body.historicalItems.map((task) => task.id)).toEqual([specTaskId]);
    await db.query("update parameter_spec_review_tasks set status = 'resolved' where id = 't1068-exact-spec'");
    expect((await read()).body.items).toEqual([]);
    const history = await requestJson<{ historicalItems: unknown[] }>(harness.server,
      "/api/v2/parameter-spec-review-tasks?status=resolved", { headers });
    expect(history.status).toBe(200);
    expect(history.body.historicalItems).toContainEqual(expect.objectContaining({
      id: "t1068-exact-spec", status: "resolved", historicalOnly: true, needsCanonicalDecision: false,
    }));
    await db.query("update parameter_spec_review_tasks set status = 'open' where id = 't1068-exact-spec'");
  });

  it("retains dismissed blocking continuity as evidence needing a canonical decision", async () => {
    await db.query("update identity_mapping_tasks set status = 'dismissed' where id = $1", [taskId]);
    const response = await requestJson<{ historicalItems: unknown[] }>(harness.server,
      "/api/v2/identity-mapping-tasks?projectId=aurora&status=dismissed", { headers });
    expect(response.status).toBe(200);
    expect(response.body.historicalItems).toContainEqual(expect.objectContaining({
      id: taskId, status: "dismissed", historicalOnly: true, needsCanonicalDecision: true,
    }));
  });

  it.each(["t1068-platform-only", "u-xu-yun"])("does not impersonate Organization Admin for %s", async (userId) => {
    const response = await requestJson(harness.server, "/api/v2/parameter-spec-review-tasks?status=open", {
      headers: { "X-WiseEff-User": userId },
    });
    expect(response.status).toBe(403);
  });

  it("keeps task history authenticated and organization scoped", async () => {
    const production = createRetirementTestHarness({
      db, legacyTables: ["identity_mapping_tasks", "parameter_spec_review_tasks"],
      auth: { mode: "production", verifier: createTokenVerifier({ issuer: "t1068", secret: "t1068-test-only" }) },
    });
    const anonymous = await requestJson(production.server, "/api/v2/identity-mapping-tasks");
    expect(anonymous.status).toBe(401);
    await db.query("insert into organizations (id, name) values ('t1068-other-org', 'Other tenant')");
    await db.query(`insert into users (id, organization_id, name, email, title, is_active)
      values ('t1068-other-user', 't1068-other-org', 'Other admin', 't1068-other@example.com', 'Admin', true)`);
    await db.query(`insert into user_role_bindings (id, user_id, organization_id, role_id)
      values ('t1068-other-role', 't1068-other-user', 't1068-other-org', 'admin')`);
    for (const endpoint of ["identity-mapping-tasks", "parameter-spec-review-tasks"]) {
      const response = await requestJson<{ items: unknown[]; historicalItems: unknown[] }>(harness.server,
        `/api/v2/${endpoint}`, { headers: { "X-WiseEff-User": "t1068-other-user" } });
      expect(response.status).toBe(200);
      expect(response.body.items).toEqual([]);
      expect(response.body.historicalItems).toEqual([]);
    }
  });
});
