import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import pg from "pg";
import { expect, it } from "vitest";

import { getAuthContextForExternalIdentity } from "../auth/repository";
import { compileCatalogRelease } from "../catalog-kernel/compiler";
import { jsonCatalogReleaseSource } from "../catalog-kernel/interface";
import { installPublishedRelease } from "../catalog-kernel/install/installer";
import { createDisposableParameterCatalogDatabase } from "../../testing/parameterCatalog";
import {
  firstReleaseBundle,
  populatedCutoverGraph,
  seedPopulatedCutover,
} from "../../testing/parameterCatalog/cutoverPopulatedFixture";
import { createLocalArchiveObjectStore } from "./archive";
import {
  checkpointDigestFor,
  insertPlannedRun,
  persistCheckpoint,
  updateRunProgress,
} from "./checkpoints";
import { readCompletedCutoverMappingManifest } from "./completedMappingManifest";
import { fixtureCutoverIdentities } from "./identities";
import {
  mappingManifestDigestFor,
  parseMappingManifestV2,
  type MappingManifestV2WithoutDigest,
} from "./mappingManifest";
import { executeCutover, inspectCutover, planCutover } from "./orchestrator";
import { fixtureObservedQuiescence } from "./quiescence";
import { fixtureObservedRecoveryPoint } from "./recoveryPointObservation";

it("exports a verified completed mapping manifest as organization-bound projections without writes", async () => {
  const database = await createDisposableParameterCatalogDatabase("s7manifestread");
  const pool = new pg.Pool({ connectionString: database.url, max: 4 });
  const client = new pg.Client({ connectionString: database.url });
  const objectRoot = await mkdtemp(path.join(os.tmpdir(), "s7manifestread-"));
  const localReadRole = `s7_manifest_reader_${randomBytes(5).toString("hex")}`;
  let localReadPool: pg.Pool | null = null;
  let localReadRoleCreated = false;
  const organizations = ["s7manifest-org-a", "s7manifest-org-b", "s7manifest-org-c"] as const;
  const userFor = (organizationId: string) => `${organizationId}-admin`;
  try {
    await client.connect();
    for (const organizationId of organizations) {
      await client.query(
        "insert into public.organizations(id,name) values ($1,$2)",
        [organizationId, organizationId],
      );
      await client.query(
        `insert into public.users(id,organization_id,name,email,title,is_active)
         values ($1,$2,$1,$3,'S7 manifest reader',true)`,
        [userFor(organizationId), organizationId, `${userFor(organizationId)}@example.test`],
      );
      await client.query(
        `insert into public.user_role_bindings(id,user_id,organization_id,project_id,role_id)
         values ($1,$2,$3,null,'admin')`,
        [`role-${userFor(organizationId)}`, userFor(organizationId), organizationId],
      );
    }
    const baseGraph = populatedCutoverGraph();
    const graph = {
      ...baseGraph,
      identities: baseGraph.identities.map((identity, index) => ({
        ...identity,
        ownerScopeKind: "organization" as const,
        ownerScopeId: organizations[index]!,
      })),
      specs: baseGraph.specs.map((spec, index) => ({
        ...spec,
        organizationId: organizations[index]!,
      })),
    };
    await seedPopulatedCutover(client, graph);
    const bundle = firstReleaseBundle();
    const compiled = compileCatalogRelease(bundle);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(bundle),
      expectedTargetDigest: compiled.value.release.digest,
    });
    expect(installed.ok).toBe(true);
    const planned = await planCutover({
      graph,
      targetArtifactSha: "a".repeat(40),
      targetCatalogReleaseDigest: compiled.value.release.digest,
      identities: fixtureCutoverIdentities("manifest-reader"),
      catalogReleaseSource: jsonCatalogReleaseSource(bundle),
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const executed = await executeCutover({
      pool,
      plan: planned.value,
      graph,
      catalogReleaseSource: jsonCatalogReleaseSource(bundle),
      archiveObjectStore: createLocalArchiveObjectStore(objectRoot),
      archiveEncryptionKey: randomBytes(32),
      operatorAuditRef: "audit-s7-manifest-reader",
      quiescence: fixtureObservedQuiescence(),
      recoveryPoint: fixtureObservedRecoveryPoint(),
    });
    expect(executed.ok).toBe(true);
    if (!executed.ok) return;
    expect(executed.value.state).toBe("completed");

    // A historical v1-shaped fixture has every checkpoint but no exact P7 version selection.
    // It is deliberately inserted as test data, not presented as a production v1 run.
    const v1RunId = "cutover_s7manifest_v1_fixture";
    const v1PlanDigest = `sha256:${createHash("sha256").update(v1RunId).digest("hex")}`;
    await client.query(
      `insert into parameter_catalog.parameter_catalog_cutover_runs
         (id, source_snapshot_fingerprint, target_artifact_sha,
          target_catalog_release_digest, migration_contract_version,
          plan_digest, current_phase, state)
       select $1, source_snapshot_fingerprint, target_artifact_sha,
              target_catalog_release_digest, 's7-orc-p0-p10-v1',
              $2, current_phase, state
         from parameter_catalog.parameter_catalog_cutover_runs where id = $3`,
      [v1RunId, v1PlanDigest, executed.value.runId],
    );
    const originalCheckpoints = await client.query<{
      phase: (typeof executed.value.checkpoints)[number]["phase"];
      checkpoint_digest: string;
      payload: Record<string, unknown>;
    }>(
      `select phase, checkpoint_digest, payload
         from parameter_catalog.parameter_catalog_cutover_checkpoints
        where cutover_run_id = $1 order by phase`,
      [executed.value.runId],
    );
    for (const checkpoint of originalCheckpoints.rows) {
      const { mappingManifest: _v2, ...legacyPayload } = checkpoint.payload;
      const payload = checkpoint.phase === "P7" ? legacyPayload : checkpoint.payload;
      const digest = checkpoint.phase === "P7"
        ? checkpointDigestFor("P7", payload)
        : checkpoint.checkpoint_digest;
      await client.query(
        `insert into parameter_catalog.parameter_catalog_cutover_checkpoints
           (cutover_run_id, phase, checkpoint_digest, payload)
         values ($1,$2,$3,$4::jsonb)`,
        [v1RunId, checkpoint.phase, digest, JSON.stringify(payload)],
      );
    }
    const inspectedV1 = await inspectCutover({ pool, runId: v1RunId });
    expect(inspectedV1.ok).toBe(true);
    if (inspectedV1.ok) expect(inspectedV1.value.checkpoints).toHaveLength(11);
    const before = await client.query<{
      versions: string;
      checkpoints: string;
      archives: string;
      events: string;
    }>(`
      select
        (select count(*)::text from parameter_catalog.legacy_mapping_versions) as versions,
        (select count(*)::text from parameter_catalog.parameter_catalog_cutover_checkpoints) as checkpoints,
        (select count(*)::text from parameter_catalog.parameter_catalog_archives) as archives,
        (select count(*)::text from parameter_catalog.parameter_catalog_cutover_events) as events
    `);
    const authFor = (organizationId: string) => getAuthContextForExternalIdentity(client, {
      organizationId,
      subject: userFor(organizationId),
    });
    const authA = await authFor(organizations[0]);
    const authB = await authFor(organizations[1]);
    const authC = await authFor(organizations[2]);
    const oldRead = await readCompletedCutoverMappingManifest({ pool, runId: v1RunId, auth: authA });
    expect(oldRead).toMatchObject({
      ok: false,
      error: { code: "PCAT-ORC-MANIFEST-UNAVAILABLE", detail: "mapping-manifest-not-captured" },
    });
    const readA = await readCompletedCutoverMappingManifest({
      pool, runId: executed.value.runId, auth: authA,
    });
    const readB = await readCompletedCutoverMappingManifest({
      pool, runId: executed.value.runId, auth: authB,
    });
    expect(readA.ok).toBe(true);
    expect(readB.ok).toBe(true);
    if (!readA.ok || !readB.ok) return;
    expect(readA.value.fullRunSelectionCount).toBeNull();
    expect(readB.value.fullRunDigest).toBe(readA.value.fullRunDigest);
    expect(readA.value.projection.coverage).toBe("organization-projection");
    expect(readB.value.projection.coverage).toBe("organization-projection");
    expect(readA.value.projection.selectionCount).toBe(1);
    expect(readB.value.projection.selectionCount).toBe(1);
    expect(readA.value.projection.selections[0]?.legacyIdentityId).toBe(graph.identities[0]?.id);
    expect(readB.value.projection.selections[0]?.legacyIdentityId).toBe(graph.identities[1]?.id);
    expect(readA.value.projection.digest).not.toBe(readB.value.projection.digest);
    // A disposable, SELECT-only LOGIN proves the seam does not require a superuser.
    // These test-database grants do not define a production runner or deployment role.
    const localPassword = randomBytes(24).toString("hex");
    await client.query(`create role ${localReadRole} login password '${localPassword}'`);
    localReadRoleCreated = true;
    await client.query(`grant usage on schema public, parameter_catalog to ${localReadRole}`);
    await client.query(`grant select on public.users, public.organizations,
      public.user_role_bindings, public.user_password_credentials, public.roles,
      public.projects, parameter_catalog.parameter_catalog_cutover_runs,
      parameter_catalog.parameter_catalog_cutover_checkpoints,
      parameter_catalog.catalog_releases, parameter_catalog.legacy_mapping_versions,
      parameter_catalog.legacy_identities to ${localReadRole}`);
    const localUrl = new URL(database.url);
    localUrl.username = localReadRole;
    localUrl.password = localPassword;
    localReadPool = new pg.Pool({ connectionString: localUrl.toString(), max: 1 });
    const roleReceipt = await localReadPool.query<{
      session_user: string; current_user: string; rolsuper: boolean;
    }>(`select session_user, current_user, rolsuper from pg_roles where rolname = current_user`);
    expect(roleReceipt.rows).toEqual([{
      session_user: localReadRole, current_user: localReadRole, rolsuper: false,
    }]);
    const restrictedRead = await readCompletedCutoverMappingManifest({
      pool: localReadPool, runId: executed.value.runId, auth: authA,
    });
    expect(restrictedRead).toEqual(readA);
    const unavailablePool = new pg.Pool({ connectionString: database.url, max: 1 });
    await unavailablePool.end();
    const unavailableRead = await readCompletedCutoverMappingManifest({
      pool: unavailablePool, runId: executed.value.runId, auth: authA,
    });
    expect(unavailableRead).toMatchObject({
      ok: false, error: { code: "PCAT-ORC-MANIFEST-UNAVAILABLE" },
    });
    const foreign = await readCompletedCutoverMappingManifest({
      pool, runId: executed.value.runId, auth: authC,
    });
    expect(foreign).toMatchObject({ ok: false, error: { code: "PCAT-ORC-NOT-FOUND" } });
    const forged = await readCompletedCutoverMappingManifest({
      pool,
      runId: executed.value.runId,
      auth: { ...authA, user: { ...authA.user, id: authB.user.id } },
    });
    expect(forged).toMatchObject({ ok: false, error: { code: "PCAT-ORC-PERMISSION-DENIED" } });
    const after = await client.query<{
      versions: string;
      checkpoints: string;
      archives: string;
      events: string;
    }>(`
      select
        (select count(*)::text from parameter_catalog.legacy_mapping_versions) as versions,
        (select count(*)::text from parameter_catalog.parameter_catalog_cutover_checkpoints) as checkpoints,
        (select count(*)::text from parameter_catalog.parameter_catalog_archives) as archives,
        (select count(*)::text from parameter_catalog.parameter_catalog_cutover_events) as events
    `);
    expect(after.rows).toEqual(before.rows);

    // These are deliberately malformed persisted checkpoint fixtures. The successful
    // cutover above, rather than these fixtures, proves the production write path.
    const originalP7 = originalCheckpoints.rows.find((row) => row.phase === "P7");
    const originalManifest = parseMappingManifestV2(originalP7?.payload.mappingManifest);
    expect(originalManifest).not.toBeNull();
    if (!originalManifest) return;
    for (const fault of [
      "missing", "duplicate", "reordered", "wrong-version", "wrong-identity",
      "wrong-run", "wrong-context", "wrong-release", "wrong-p10-digest",
    ] as const) {
      const artifactSha = createHash("sha256").update(`manifest-${fault}`).digest("hex").slice(0, 40);
      const malformedPlan = await planCutover({
        graph,
        targetArtifactSha: artifactSha,
        targetCatalogReleaseDigest: compiled.value.release.digest,
        identities: fixtureCutoverIdentities(`manifest-${fault}`),
        catalogReleaseSource: jsonCatalogReleaseSource(bundle),
      });
      expect(malformedPlan.ok, fault).toBe(true);
      if (!malformedPlan.ok) return;
      const badRunId = `cutover_s7manifest_bad_${fault}`;
      await insertPlannedRun(client, { runId: badRunId, plan: malformedPlan.value });
      let candidate: MappingManifestV2WithoutDigest = {
        ...originalManifest,
        selectionRunId: badRunId,
        planDigest: malformedPlan.value.planDigest,
        targetArtifactSha: artifactSha,
      };
      const first = candidate.selections[0]!;
      switch (fault) {
        case "missing":
          candidate = { ...candidate, selections: candidate.selections.slice(0, 1) };
          break;
        case "duplicate":
          candidate = { ...candidate, selections: [first, first] };
          break;
        case "reordered":
          candidate = { ...candidate, selections: [...candidate.selections].reverse() };
          break;
        case "wrong-version":
          candidate = {
            ...candidate,
            selections: [
              { ...first, mappingVersion: { ...first.mappingVersion, id: "lmap_absent" } },
              ...candidate.selections.slice(1),
            ],
          };
          break;
        case "wrong-identity":
          candidate = {
            ...candidate,
            selections: [{ ...first, legacyIdentityId: "s7manifest-other-identity" }, ...candidate.selections.slice(1)],
          };
          break;
        case "wrong-run":
          candidate = { ...candidate, selectionRunId: executed.value.runId };
          break;
        case "wrong-context":
          candidate = { ...candidate, targetArtifactSha: "b".repeat(40) };
          break;
        case "wrong-release":
          candidate = {
            ...candidate,
            catalogReleaseDigest: `sha256:${"c".repeat(64)}`,
          };
          break;
      }
      const payload = {
        ...originalP7!.payload,
        mappingManifest: { ...candidate, digest: mappingManifestDigestFor(candidate) },
      };
      for (const checkpoint of originalCheckpoints.rows) {
        if (fault === "wrong-p10-digest" && checkpoint.phase === "P10") {
          // A malformed persisted fixture: normal writers never choose the digest.
          await client.query(
            `insert into parameter_catalog.parameter_catalog_cutover_checkpoints
               (cutover_run_id, phase, checkpoint_digest, payload)
             values ($1, 'P10', $2, $3::jsonb)`,
            [badRunId, `sha256:${"0".repeat(64)}`, JSON.stringify(checkpoint.payload)],
          );
          continue;
        }
        const written = await persistCheckpoint(client, {
          runId: badRunId,
          phase: checkpoint.phase,
          payload: checkpoint.phase === "P7" ? payload : checkpoint.payload,
        });
        expect(written.ok, `${fault}:${checkpoint.phase}`).toBe(true);
      }
      await updateRunProgress(client, { runId: badRunId, phase: "P10", state: "completed" });
      const refused = await readCompletedCutoverMappingManifest({ pool, runId: badRunId, auth: authA });
      expect(refused, fault).toMatchObject({ ok: false, error: { code: "PCAT-ORC-MANIFEST-INVALID" } });
      if (fault === "wrong-p10-digest" && !refused.ok) {
        expect(refused.error.detail).toBe("Completed run has a checkpoint digest mismatch");
      }
    }
    const unfinishedPlan = await planCutover({
      graph,
      targetArtifactSha: "d".repeat(40),
      targetCatalogReleaseDigest: compiled.value.release.digest,
      identities: fixtureCutoverIdentities("manifest-unfinished"),
      catalogReleaseSource: jsonCatalogReleaseSource(bundle),
    });
    expect(unfinishedPlan.ok).toBe(true);
    if (unfinishedPlan.ok) {
      const unfinishedRunId = "cutover_s7manifest_unfinished";
      await insertPlannedRun(client, { runId: unfinishedRunId, plan: unfinishedPlan.value });
      const unavailable = await readCompletedCutoverMappingManifest({ pool, runId: unfinishedRunId, auth: authA });
      expect(unavailable).toMatchObject({ ok: false, error: { code: "PCAT-ORC-MANIFEST-UNAVAILABLE" } });
    }
  } finally {
    await localReadPool?.end().catch(() => undefined);
    if (localReadRoleCreated) {
      await client.query(`drop owned by ${localReadRole}`).catch(() => undefined);
      await client.query(`drop role ${localReadRole}`).catch(() => undefined);
    }
    await client.end().catch(() => undefined);
    await pool.end().catch(() => undefined);
    await database.close().catch(() => undefined);
    await rm(objectRoot, { recursive: true, force: true });
  }
}, 120_000);
