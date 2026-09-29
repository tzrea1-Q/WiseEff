import { randomBytes } from "node:crypto";
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
import { classifyFrozenP0Graph } from "./classifier";
import { readCompletedCutoverMappingManifest } from "./completedMappingManifest";
import { fixtureCutoverIdentities } from "./identities";
import { appendMappingVersion, readCurrentMappingHead } from "./mapping";
import { normalizedCheckpointDigestFor, persistCheckpoint } from "./checkpoints";
import { mappingManifestDigestFor, parseMappingManifestV2 } from "./mappingManifest";
import { executeCutover, inspectCutover, planCutover } from "./orchestrator";
import { fixtureObservedQuiescence } from "./quiescence";
import { fixtureObservedRecoveryPoint } from "./recoveryPointObservation";

it("rejects re-digested P7 CAS tampering after cross-run replay and append", async () => {
  const database = await createDisposableParameterCatalogDatabase("s7manifestcas");
  const pool = new pg.Pool({ connectionString: database.url, max: 4 });
  const client = new pg.Client({ connectionString: database.url });
  const objectRoot = await mkdtemp(path.join(os.tmpdir(), "s7manifestcas-"));
  const organizationId = "s7-manifest-cas-org";
  const principalId = "s7-manifest-cas-admin";
  const baseGraph = populatedCutoverGraph();
  const graph = {
    ...baseGraph,
    identities: baseGraph.identities.map((identity) => ({
      ...identity,
      ownerScopeKind: "organization" as const,
      ownerScopeId: organizationId,
    })),
    specs: baseGraph.specs.map((spec) => ({
      ...spec,
      organizationId,
      ...(spec.id === "s7orc-spec-r1"
        ? {
            specificationKey: "s7p7.r9.historical",
            definitionLifecycle: "deprecated" as const,
            propertyKey: "s7p7,historical",
          }
        : {}),
    })),
    specVersions: baseGraph.specVersions.map((version) =>
      version.parameterSpecId === "s7orc-spec-r1"
        ? { ...version, lifecycle: "deprecated" as const, versionStatus: "superseded" as const }
        : version,
    ),
  };
  try {
    await client.connect();
    await client.query("insert into public.organizations(id,name) values ($1,$1)", [organizationId]);
    await client.query(
      `insert into public.users(id,organization_id,name,email,title,is_active)
       values ($1,$2,$1,$3,'S7 manifest CAS fixture',true)`,
      [principalId, organizationId, `${principalId}@example.test`],
    );
    await client.query(
      `insert into public.user_role_bindings(id,user_id,organization_id,project_id,role_id)
       values ($1,$2,$3,null,'admin')`,
      [`role-${principalId}`, principalId, organizationId],
    );
    await seedPopulatedCutover(client, graph);

    const bundle = firstReleaseBundle();
    const source = jsonCatalogReleaseSource(bundle);
    const compiled = compileCatalogRelease(bundle);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source,
      expectedTargetDigest: compiled.value.release.digest,
    });
    expect(installed.ok).toBe(true);

    const planFor = async (artifact: string) => planCutover({
      graph,
      targetArtifactSha: artifact.repeat(40),
      targetCatalogReleaseDigest: compiled.value.release.digest,
      identities: fixtureCutoverIdentities("s7-manifest-cas"),
      catalogReleaseSource: source,
    });
    const planA = await planFor("a");
    expect(planA.ok).toBe(true);
    if (!planA.ok) return;
    const objectStore = createLocalArchiveObjectStore(objectRoot);
    const failArchiveWrite = {
      ...objectStore,
      async putExclusive() {
        throw new Error("controlled P7 archive failure after first mapping append");
      },
    };
    const runA = await executeCutover({
      pool,
      plan: planA.value,
      graph,
      catalogReleaseSource: source,
      archiveObjectStore: failArchiveWrite,
      archiveEncryptionKey: randomBytes(32),
      operatorAuditRef: "audit-s7-manifest-cas-a",
      quiescence: fixtureObservedQuiescence(),
      recoveryPoint: fixtureObservedRecoveryPoint(),
    });
    expect(runA).toMatchObject({ ok: false, error: { code: "PCAT-ORC-PHASE-FAILED" } });

    const planB = await planFor("b");
    expect(planB.ok).toBe(true);
    if (!planB.ok) return;
    const runB = await executeCutover({
      pool,
      plan: planB.value,
      graph,
      catalogReleaseSource: source,
      archiveObjectStore: objectStore,
      archiveEncryptionKey: randomBytes(32),
      operatorAuditRef: "audit-s7-manifest-cas-b",
      quiescence: fixtureObservedQuiescence(),
      recoveryPoint: fixtureObservedRecoveryPoint(),
    });
    expect(runB).toMatchObject({ ok: true, value: { state: "completed" } });
    if (!runB.ok) return;

    const p7 = runB.value.checkpoints.find((checkpoint) => checkpoint.phase === "P7");
    expect(p7).toBeDefined();
    const manifest = parseMappingManifestV2(p7?.payload.mappingManifest);
    expect(manifest).not.toBeNull();
    if (!p7 || !manifest) return;
    expect(manifest.selections.map((selection) => [
      selection.legacyIdentityId,
      selection.status,
      selection.headCasVersion,
      selection.mappingVersion.versionNumber,
      selection.mappingVersion.cutoverRunId,
    ])).toEqual([
      ["s7orc-lid-r1", "replayed", 1, 1, expect.any(String)],
      ["s7orc-lid-r10", "appended", 1, 1, runB.value.runId],
    ]);
    const replayCreator = manifest.selections[0]?.mappingVersion.cutoverRunId;
    expect(replayCreator).not.toBe(runB.value.runId);

    const auth = await getAuthContextForExternalIdentity(client, {
      organizationId,
      subject: principalId,
    });
    const readBefore = await readCompletedCutoverMappingManifest({
      pool,
      runId: runB.value.runId,
      auth,
    });
    expect(readBefore.ok).toBe(true);
    if (!readBefore.ok) return;

    const retriedCheckpoint = await persistCheckpoint(client, {
      runId: runB.value.runId,
      phase: "P7",
      payload: p7.payload,
    });
    expect(retriedCheckpoint.ok).toBe(true);
    const readAfterCheckpointRetry = await readCompletedCutoverMappingManifest({
      pool,
      runId: runB.value.runId,
      auth,
    });
    expect(readAfterCheckpointRetry).toEqual(readBefore);

    const replaySelection = manifest.selections[0]!;
    const classification = classifyFrozenP0Graph(graph);
    expect(classification.ok).toBe(true);
    if (!classification.ok) return;
    const headBeforeAdvance = await readCurrentMappingHead({
      client,
      identityId: replaySelection.legacyIdentityId,
    });
    expect(headBeforeAdvance.ok).toBe(true);
    if (!headBeforeAdvance.ok) return;
    expect(headBeforeAdvance.value.currentVersionId).toBe(replaySelection.mappingVersion.id);
    expect(headBeforeAdvance.value.casVersion).toBe(replaySelection.headCasVersion);
    const advanced = await appendMappingVersion({
      client,
      cutoverRunId: runB.value.runId,
      classification: classification.value,
      identityId: replaySelection.legacyIdentityId,
      sourceChecksum: "sha256:s7-manifest-cas-later-head",
      expectedHead: {
        casVersion: headBeforeAdvance.value.casVersion,
        versionId: headBeforeAdvance.value.currentVersionId,
      },
      outcome: {
        kind: "operational",
        targetKind: replaySelection.mappingVersion.targetKind!,
        targetId: replaySelection.mappingVersion.targetId!,
      },
    });
    expect(advanced).toMatchObject({ ok: true, value: { status: "appended" } });
    if (!advanced.ok || advanced.value.status !== "appended") return;
    expect(advanced.value.head.currentVersionId).not.toBe(replaySelection.mappingVersion.id);
    expect(advanced.value.head.casVersion).toBeGreaterThan(replaySelection.headCasVersion);
    const readAfterAdvance = await readCompletedCutoverMappingManifest({
      pool,
      runId: runB.value.runId,
      auth,
    });
    expect(readAfterAdvance).toEqual(readBefore);

    const event = await client.query<{ checkpoint_digest: string }>(
      `select payload->>'checkpointDigest' as checkpoint_digest
         from parameter_catalog.parameter_catalog_cutover_events
        where cutover_run_id = $1 and phase = 'P7' and event_kind = 'checkpoint'`,
      [runB.value.runId],
    );
    expect(event.rows.length).toBeGreaterThan(0);
    expect(event.rows.every((row) => row.checkpoint_digest === p7.checkpointDigest)).toBe(true);

    const role = await client.query<{ current_user: string; rolsuper: boolean }>(
      `select current_user, rolsuper from pg_roles where rolname = current_user`,
    );
    // This controlled corruption fixture needs superuser to bypass immutable triggers.
    expect(role.rows).toHaveLength(1);
    expect(role.rows[0]?.rolsuper).toBe(true);
    const { digest: _digest, ...withoutDigest } = manifest;
    const tamperedManifest = {
      ...withoutDigest,
      selections: manifest.selections.map((selection, index) =>
        index === 0 ? { ...selection, headCasVersion: selection.headCasVersion + 41 } : selection,
      ),
    };
    const tamperedPayload = {
      ...p7.payload,
      mappingManifest: {
        ...tamperedManifest,
        digest: mappingManifestDigestFor(tamperedManifest),
      },
    };
    const tamperedCheckpointDigest = normalizedCheckpointDigestFor("P7", tamperedPayload);
    await client.query("begin");
    await client.query("set local session_replication_role = replica");
    await client.query(
      `update parameter_catalog.parameter_catalog_cutover_checkpoints
          set payload = $3::jsonb, checkpoint_digest = $4
        where cutover_run_id = $1 and phase = 'P7' and checkpoint_digest = $2`,
      [runB.value.runId, p7.checkpointDigest, JSON.stringify(tamperedPayload), tamperedCheckpointDigest],
    );
    await client.query("commit");

    const readAfterTamper = await readCompletedCutoverMappingManifest({
      pool,
      runId: runB.value.runId,
      auth,
    });
    const inspection = await inspectCutover({ pool, runId: runB.value.runId });
    expect(inspection.ok).toBe(true);
    if (inspection.ok) {
      const inspectedP7 = inspection.value.checkpoints.find((checkpoint) => checkpoint.phase === "P7");
      expect(inspectedP7?.checkpointDigest).toBe(tamperedCheckpointDigest);
      const inspectedManifest = inspectedP7?.payload.mappingManifest as {
        selections: readonly { headCasVersion: number }[];
      } | undefined;
      expect(inspectedManifest?.selections[0]?.headCasVersion).toBe(
        manifest.selections[0]!.headCasVersion + 41,
      );
    }
    expect(readAfterTamper).toMatchObject({
      ok: false,
      error: {
        code: "PCAT-ORC-MANIFEST-INVALID",
        detail: "P7 checkpoint digest differs from immutable checkpoint events",
      },
    });
  } finally {
    await client.end().catch(() => undefined);
    await pool.end().catch(() => undefined);
    await database.close().catch(() => undefined);
    await rm(objectRoot, { recursive: true, force: true });
  }
}, 120_000);
