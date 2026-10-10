import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../../shared/database/client";
import { createEphemeralTestDatabase } from "../../../testing/testDatabase";
import { createRetirementTestHarness } from "../../../testing/parameterCatalog/retirementHarness";
import { requestJson } from "../../../test/testClient";
import { compileOrThrow, installPublishedCatalogChain, nodeTypeAndSecondDriverSuccessorBundle, X_DEFINITION_ID, X_REVISION_1, X_REVISION_2 } from "../../catalog-kernel/runtime/catalogChain.fixture";
import { createCatalogInstaller } from "../../catalog-kernel/install/installer";
import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import type { CatalogReleasePin } from "../../parameter-catalog-contract";
import { classifyFrozenP0Graph } from "../../catalog-cutover/classifier";
import { FROZEN_P0_GRAPH_FIXTURE } from "../../catalog-cutover/classifier/__fixtures__/p0GraphFixture";
import { fixtureCutoverIdentities } from "../../catalog-cutover/identities";
import { planCutover } from "../../catalog-cutover/orchestrator";
import { insertPlannedRun } from "../../catalog-cutover/checkpoints";
import { appendMappingVersion } from "../../catalog-cutover/mapping";
import { createArchiveAdapter, createLocalArchiveObjectStore } from "../../catalog-cutover/archive";
import { CATALOG_SUNSET_HTTP_DATE } from "./headers";
import { catalogLegacySpecListResponseSchema } from "../../contracts/dtoSchemas/parameterCatalog";

const headers = { "X-WiseEff-User": "t1072-reader" };
const specId = "s7cls-spec-r4-driver";
const unmappedId = "s7cls-spec-r5-node";
const blockedId = "s7cls-spec-r0-key";
const archivedId = "s7cls-spec-r1-status";

describe("assembled canonical spec read window", () => {
  let db: RootDatabase;
  let fixture: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let harness: ReturnType<typeof createRetirementTestHarness>;
  let releaseId: string;
  let archiveRoot: string;
  let pin: CatalogReleasePin;

  beforeAll(async () => {
    fixture = await createEphemeralTestDatabase("specwindow");
    db = createPostgresDatabase(fixture.url);
    const pool = getRootPostgresPool(db)!;
    const installed = await installPublishedCatalogChain(pool);
    releaseId = installed.pinC.id;
    pin = installed.pinC;
    await db.query("insert into organizations (id, name) values ('t1072-org', 'Spec window')");
    await db.query(`insert into users (id, organization_id, name, email, title, is_active)
      values ('t1072-reader', 't1072-org', 'Reader', 't1072@example.test', 'Engineer', true)`);
    await db.query(`insert into roles (id, name, level, permissions)
      values ('software-user', 'Software', 10, array['parameter:view']) on conflict (id) do nothing`);
    await db.query(`insert into user_role_bindings (id, user_id, organization_id, role_id)
      values ('t1072-role', 't1072-reader', 't1072-org', 'software-user')`);
    await db.query("insert into organizations (id, name) values ('t1072-other-org', 'Other tenant')");
    await db.query(`insert into users (id, organization_id, name, email, title, is_active)
      values ('t1072-no-view', 't1072-org', 'No view', 't1072-no-view@example.test', 'Engineer', true)`);
    await db.query("insert into roles (id, name, level, permissions) values ('t1072-observer', 'Observer', 1, array[]::text[])");
    await db.query(`insert into user_role_bindings (id, user_id, organization_id, role_id)
      values ('t1072-observer-role', 't1072-no-view', 't1072-org', 't1072-observer')`);
    await db.query(`insert into parameter_specs (id, organization_id, source_kind, specification_key)
      values ('t1072-other-spec', 't1072-other-org', 'manual', 'manual/other-tenant')`);
    await db.query(`insert into parameter_catalog.legacy_identities
      (id, source_system, source_kind, owner_scope_kind, owner_scope_id, source_id)
      values ('t1072-other-identity', 'wiseeff-v1', 'parameter-spec', 'organization', 't1072-other-org', 't1072-other-spec')`);
    for (const sourceId of [specId, unmappedId, blockedId, archivedId]) {
      const spec = FROZEN_P0_GRAPH_FIXTURE.specs.find((item) => item.id === sourceId)!;
      if (spec.attributionSubjectId) {
        const subject = FROZEN_P0_GRAPH_FIXTURE.subjects.find((item) => item.id === spec.attributionSubjectId)!;
        await db.query(`insert into attribution_subjects (id, organization_id, subject_kind, display_name, origin, source_key)
          values ($1, $2, $3, $1, 'curated', $1) on conflict (id) do nothing`,
        [subject.id, subject.organizationId, subject.subjectKind]);
      }
      await db.query(`insert into parameter_specs
        (id, organization_id, source_kind, specification_key, attribution_subject_id, property_key)
        values ($1, $2, $3, $4, $5, $6)`, [spec.id, spec.organizationId, spec.sourceKind,
        spec.specificationKey, spec.attributionSubjectId, spec.propertyKey]);
    }
    await db.query(`insert into parameter_spec_versions
      (id, parameter_spec_id, version, display_name, description, value_shape, lifecycle, version_status)
      values ('s7cls-ver-r4-old', $1, 1, 'Historical name, not canonical', 'Historical', '{}', 'deprecated', 'superseded')`, [specId]);
    const classified = classifyFrozenP0Graph(FROZEN_P0_GRAPH_FIXTURE);
    const plan = await planCutover({ graph: FROZEN_P0_GRAPH_FIXTURE, targetArtifactSha: "a".repeat(40),
      targetCatalogReleaseDigest: installed.pinC.digest, identities: fixtureCutoverIdentities("t1072") });
    if (!classified.ok || !plan.ok) throw new Error("Spec mapping fixture classification failed");
    const client = await pool.connect();
    archiveRoot = await mkdtemp(path.join(tmpdir(), "t1072-archive-"));
    try {
      const run = await insertPlannedRun(client, { runId: "t1072-cutover", plan: plan.value });
      for (const identityId of ["s7cls-lid-r4-driver", "s7cls-lid-r4-old", "s7cls-lid-r5-node",
        "s7cls-lid-r0-key", "s7cls-lid-r1-status"]) {
        const identity = FROZEN_P0_GRAPH_FIXTURE.identities.find((item) => item.id === identityId)!;
        await client.query(`insert into parameter_catalog.legacy_identities
          (id, source_system, source_kind, owner_scope_kind, owner_scope_id, source_id)
          values ($1, $2, $3, $4, $5, $6)`, [identity.id, identity.sourceSystem, identity.sourceKind,
          identity.ownerScopeKind, identity.ownerScopeId, identity.sourceId]);
        if (identityId === "s7cls-lid-r5-node") continue;
        if (identityId === "s7cls-lid-r1-status") {
          const archived = await createArchiveAdapter({ client,
            objectStore: createLocalArchiveObjectStore(archiveRoot), encryptionKey: randomBytes(32) }).persistArchive({
            actor: { role: "cutover-operator", auditRef: "t1072-archive" }, legacyIdentityId: identityId,
            ownerScopeKind: "platform", ownerScopeId: "platform", rClass: "R1", reason: "Historical structural spec",
            sourceGraph: { sourcePayload: { ...FROZEN_P0_GRAPH_FIXTURE.specs.find((item) => item.id === archivedId)! }, relationGraph: {} },
            protectedReferences: [], cutoverRunId: run.id, catalogReleaseId: installed.pinC.id,
            successAuditRef: "t1072-archive", retainUntil: new Date("2027-10-09T00:00:00Z"),
          });
          if (!archived.ok) throw new Error(JSON.stringify(archived.error));
          const mapped = await appendMappingVersion({ client, cutoverRunId: run.id,
            classification: classified.value, identityId, sourceChecksum: archived.value.sourceChecksum, expectedHead: null,
            outcome: { kind: "archived", archiveId: archived.value.archiveId } });
          if (!mapped.ok) throw new Error(JSON.stringify(mapped.error));
          continue;
        }
        const mapped = await appendMappingVersion({ client, cutoverRunId: run.id,
          classification: classified.value, identityId, sourceChecksum: "sha256:t1072-source", expectedHead: null,
          outcome: { kind: "operational", targetKind: identity.sourceKind === "parameter-spec"
            ? "parameter-definition" : "definition-revision", targetId: identity.sourceKind === "parameter-spec"
              ? X_DEFINITION_ID : X_REVISION_1 } });
        if (!mapped.ok) throw new Error(JSON.stringify(mapped.error));
      }
    } finally {
      client.release();
    }
    harness = createRetirementTestHarness({ db, legacyTables: ["parameter_specs", "parameter_spec_versions"] });
  }, 120_000);

  afterAll(async () => {
    await db?.close();
    await fixture?.drop();
    if (archiveRoot) await rm(archiveRoot, { recursive: true, force: true });
  });

  it("serves exact canonical Definition and pinned historical Revision mappings with bounded headers", async () => {
    const expected = {
      legacyType: "parameter-spec", legacyId: specId, disposition: "mapped", historicalOnly: false,
      target: { kind: "parameter-definition", id: X_DEFINITION_ID, href: `/api/v2/catalog/definitions/${X_DEFINITION_ID}` },
      definition: expect.objectContaining({ id: X_DEFINITION_ID,
        currentRevision: expect.objectContaining({ id: X_REVISION_2 }),
        registration: { status: "unregistered" } }),
      revisions: [expect.objectContaining({ legacyType: "parameter-spec-version", legacyId: "s7cls-ver-r4-old",
        target: expect.objectContaining({ kind: "definition-revision", id: X_REVISION_1 }),
        revision: expect.objectContaining({ id: X_REVISION_1, definitionId: X_DEFINITION_ID }) })],
    };
    const list = await requestJson<{ items: unknown[]; historicalItems: unknown[] }>(
      harness.server, "/api/v2/parameter-specs?view=effective", { headers });
    expect(list.status).toBe(200);
    expect(list.body.items).toEqual([expected]);
    expect(list.body.historicalItems).toContainEqual({ legacyType: "parameter-spec", legacyId: unmappedId,
      disposition: "not-found", historicalOnly: true });
    const detail = await requestJson<{ item: unknown }>(harness.server, `/api/v2/parameter-specs/${specId}`, { headers });
    expect(detail.status).toBe(200);
    expect(detail.body.item).toEqual(expected);
    for (const response of [list, detail]) {
      expect(response.headers.get("deprecation")).toBe("true");
      expect(response.headers.get("sunset")).toBe(CATALOG_SUNSET_HTTP_DATE);
      expect(response.headers.get("link")).toBe('</api/v2/catalog>; rel="successor-version"');
      expect(response.headers.get("warning")).toBe('299 WiseEff "Legacy ParameterSpec contract is deprecated"');
      expect(response.headers.get("x-wiseeff-legacy-contract")).toBe("parameter-spec-v2");
      expect(response.headers.get("x-wiseeff-catalog-release")).toBe(releaseId);
    }
  });

  it("reads effective list and detail while both legacy spec tables are inaccessible", async () => {
    const pool = getRootPostgresPool(db)!;
    const lock = await pool.connect();
    const url = new URL(fixture.url);
    url.searchParams.set("options", "-c statement_timeout=500");
    const boundedDb = createPostgresDatabase(url.toString());
    const bounded = createRetirementTestHarness({ db: boundedDb, legacyTables: [] });
    const before = await db.query("select count(*)::int as count from parameter_specs");
    try {
      await lock.query("begin");
      await lock.query("lock table parameter_specs, parameter_spec_versions in access exclusive mode");
      for (const path of ["/api/v2/parameter-specs?view=effective", `/api/v2/parameter-specs/${specId}`]) {
        const response = await requestJson(bounded.server, path, { headers });
        expect(response.status, path).toBe(200);
        expect(response.headers.get("deprecation")).toBe("true");
      }
    } finally {
      await lock.query("rollback");
      lock.release();
      await boundedDb.close();
    }
    expect((await db.query("select count(*)::int as count from parameter_specs")).rows).toEqual(before.rows);
  });

  it("keeps bounded headers on authentication failures before mapping lookup", async () => {
    for (const path of ["/api/v2/parameter-specs", `/api/v2/parameter-specs/${specId}`]) {
      const response = await requestJson(harness.server, path, { headers: { "X-WiseEff-User": "missing-user" } });
      expect(response.status).toBe(401);
      expect(response.headers.get("deprecation")).toBe("true");
      expect(response.headers.get("x-wiseeff-catalog-release")).toBe(releaseId);
    }
  });

  it("refuses release drift and never infers a legacy identity from canonical IDs or property names", async () => {
    const drift = await requestJson<{ error: { details: { reason: string } } }>(harness.server,
      `/api/v2/parameter-specs/${specId}`, { headers: { ...headers, "X-WiseEff-Catalog-Release": "crel_stale" } });
    expect(drift.status).toBe(409);
    expect(drift.body.error.details.reason).toBe("release-drift");
    expect(drift.headers.get("x-wiseeff-catalog-release")).toBe(releaseId);
    for (const path of [`/api/v2/parameter-specs/${X_DEFINITION_ID}`, `/api/v2/parameter-specs/iin_max`,
      `/api/v2/parameter-specs/${unmappedId}`, "/api/v2/parameter-specs?propertyKey=iin_max",
      "/api/v2/parameter-specs?q=Input%20current"]) {
      const response = await requestJson(harness.server, path, { headers });
      expect(response.status, path).toBe(404);
      expect(response.headers.get("deprecation")).toBe("true");
    }
  });

  it("separates blocked and archived identities into typed historical dispositions", async () => {
    const list = await requestJson<{ historicalItems: unknown[] }>(harness.server, "/api/v2/parameter-specs", { headers });
    expect(list.status).toBe(200);
    for (const [legacyId, disposition, status, reason] of [
      [blockedId, "ambiguous", 409, "legacy-id-ambiguous"],
      [archivedId, "archived", 410, "legacy-id-archived"],
    ] as const) {
      expect(list.body.historicalItems).toContainEqual({ legacyType: "parameter-spec", legacyId,
        disposition, historicalOnly: true });
      const detail = await requestJson<{ error: { details: unknown } }>(harness.server,
        `/api/v2/parameter-specs/${legacyId}`, { headers });
      expect(detail.status).toBe(status);
      expect(detail.body.error.details).toMatchObject({ disposition, reason, historicalOnly: true, retryable: false });
      expect(detail.headers.get("deprecation")).toBe("true");
    }
  });

  it("preserves parameter-view permission and owner-scoped identity visibility", async () => {
    for (const path of ["/api/v2/parameter-specs", `/api/v2/parameter-specs/${specId}`]) {
      const denied = await requestJson(harness.server, path, { headers: { "X-WiseEff-User": "t1072-no-view" } });
      expect(denied.status, path).toBe(403);
      expect(denied.headers.get("deprecation")).toBe("true");
    }
    const list = await requestJson<{ historicalItems: Array<{ legacyId: string }> }>(
      harness.server, "/api/v2/parameter-specs", { headers });
    expect(list.status).toBe(200);
    expect(list.body.historicalItems.map((item) => item.legacyId)).not.toContain("t1072-other-spec");
    const other = await requestJson<{ error: { details: { disposition: string } } }>(harness.server,
      "/api/v2/parameter-specs/t1072-other-spec", { headers });
    expect(other.status).toBe(404);
    expect(other.body.error.details.disposition).toBe("not-found");
  });

  it.each(["id", "specId"])("retains the collection envelope for an exact %s filter", async (query) => {
    const response = await requestJson(harness.server, `/api/v2/parameter-specs?view=effective&${query}=${specId}`, { headers });
    expect(response.status).toBe(200);
    const list = catalogLegacySpecListResponseSchema.parse(response.body);
    expect(list.items.map((item) => item.legacyId)).toEqual([specId]);
    expect(list.historicalItems).toEqual([]);
  });

  it("advertises the new release when the Catalog advances during a read-window request", async () => {
    const pool = getRootPostgresPool(db)!;
    const lock = await pool.connect();
    let pending: ReturnType<typeof requestJson<{ error: { details: { reason: string; currentCatalogReleaseId: string } } }>> | undefined;
    const bundle = nodeTypeAndSecondDriverSuccessorBundle();
    const compiled = compileOrThrow(bundle);
    try {
      await lock.query("begin");
      await lock.query("lock table parameter_catalog.legacy_identities in access exclusive mode");
      pending = requestJson(harness.server, `/api/v2/parameter-specs/${specId}`, { headers });
      await expect.poll(async () => (await db.query<{ waiting: boolean }>(`select exists (
        select 1 from pg_locks where relation = 'parameter_catalog.legacy_identities'::regclass
          and database = (select oid from pg_database where datname = current_database()) and not granted
      ) as waiting`)).rows[0]?.waiting, { timeout: 5_000 }).toBe(true);
      const installed = await createCatalogInstaller(pool).installPublishedRelease({ mode: "advance",
        source: jsonCatalogReleaseSource(bundle), expectedCurrent: pin, expectedTargetDigest: compiled.aggregateDigest });
      expect(installed.ok).toBe(true);
    } finally {
      await lock.query("rollback");
      lock.release();
      if (pending) await pending;
    }
    const response = await pending!;
    expect(response.status).toBe(409);
    expect(response.body.error.details).toMatchObject({ reason: "release-drift", currentCatalogReleaseId: compiled.release.id });
    expect(response.headers.get("x-wiseeff-catalog-release")).toBe(compiled.release.id);
    expect(response.headers.get("deprecation")).toBe("true");
  }, 30_000);
});
