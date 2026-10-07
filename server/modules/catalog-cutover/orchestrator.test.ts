import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compileCatalogRelease } from "../catalog-kernel/compiler/index";
import { validCatalogReleaseBundle } from "../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import type { CatalogReleaseBundle } from "../catalog-kernel/compiler/types";
import { jsonCatalogReleaseSource } from "../catalog-kernel/interface";
import { installPublishedRelease } from "../catalog-kernel/install/installer";
import {
  createDisposableParameterCatalogDatabase,
  type ParameterCatalogDatabase,
} from "../../testing/parameterCatalog";
import { seedOrganization } from "../../testing/fixtures";
import {
  firstReleaseBundle,
  populatedCutoverGraph,
  seedPopulatedCutover,
} from "../../testing/parameterCatalog/cutoverPopulatedFixture";
import { createPostgresDatabase } from "../../shared/database/client";
import { createArchiveAdapter, createLocalArchiveObjectStore } from "./archive";
import { classifyFrozenP0Graph, type FrozenP0Graph } from "./classifier";
import { appendMappingVersion, readCurrentMappingHead } from "./mapping";
import {
  LEGACY_MIGRATION_CONTRACT_VERSION,
  MIGRATION_CONTRACT_VERSION,
  PRE_ACTIVATION_PHASES,
  THREAT_MATRIX,
  type CutoverPlan,
} from "./interface";
import {
  insertPlannedRun,
  normalizedCheckpointDigestFor,
  normalizedP7CheckpointDigestFor,
  persistCheckpoint,
  updateRunProgress,
} from "./checkpoints";
import {
  executeCutover,
  inspectCutover,
  planCutover,
} from "./orchestrator";
import { fixtureCutoverIdentities } from "./identities";
import { fixtureObservedQuiescence } from "./quiescence";
import { fixtureObservedRecoveryPoint } from "./recoveryPointObservation";
import { parseMappingManifestV2 } from "./mappingManifest";
import { createParameterModule } from "../parameters/parameterModuleRepository";

const CATALOG_TEST_TIMEOUT_MS = 60_000;
const CATALOG_HOOK_TIMEOUT_MS = 120_000;
const cutoverDir = path.dirname(fileURLToPath(import.meta.url));

const productionSources = async (): Promise<readonly { name: string; text: string }[]> => {
  const names = (await readdir(cutoverDir)).filter(
    (name) =>
      name.endsWith(".ts") &&
      !name.includes(".test.") &&
      name !== "classifier" &&
      !name.startsWith("classifier") &&
      name !== "mapping" &&
      !name.startsWith("mapping") &&
      name !== "archive" &&
      !name.startsWith("archive"),
  );
  const owned = names.filter((name) =>
    [
      "interface.ts",
      "orchestrator.ts",
      "checkpoints.ts",
      "recovery.ts",
      "threatMatrix.ts",
    ].includes(name),
  );
  return Promise.all(
    owned.map(async (name) => ({
      name,
      text: await readFile(path.join(cutoverDir, name), "utf8"),
    })),
  );
};

const s7R9R10ManifestGraph = (): FrozenP0Graph => ({
  catalog: "parameter-catalog-p0-graph",
  identities: [
    {
      id: "a-s7p7-lid-r9",
      sourceSystem: "wiseeff-v1",
      sourceKind: "parameter-spec",
      ownerScopeKind: "platform",
      ownerScopeId: "platform",
      sourceId: "s7p7-spec-r9",
    },
    {
      id: "z-s7p7-lid-r10",
      sourceSystem: "wiseeff-v1",
      sourceKind: "parameter-spec",
      ownerScopeKind: "platform",
      ownerScopeId: "platform",
      sourceId: "s7p7-spec-r10",
    },
  ],
  specs: [
    {
      id: "s7p7-spec-r9",
      organizationId: null,
      sourceKind: "dts",
      specificationKey: "s7p7.r9.historical",
      attributionSubjectId: null,
      definitionLifecycle: "deprecated",
      propertyKey: "s7p7,historical",
    },
    {
      id: "s7p7-spec-r10",
      organizationId: null,
      sourceKind: "dts",
      specificationKey: "s7p7.r10.unknown",
      attributionSubjectId: null,
      definitionLifecycle: "active",
      propertyKey: "s7p7,unknown",
    },
  ],
  specVersions: [
    {
      id: "s7p7-ver-r9",
      parameterSpecId: "s7p7-spec-r9",
      version: 1,
      lifecycle: "deprecated",
      versionStatus: "superseded",
    },
    {
      id: "s7p7-ver-r10",
      parameterSpecId: "s7p7-spec-r10",
      version: 1,
      lifecycle: "active",
      versionStatus: "active",
    },
  ],
  subjects: [],
  driverRegistrations: [],
  nodeTypeDefinitions: [],
  driverSchemas: [],
  driverSchemaVersions: [],
  dtsPropertySpecs: [],
  modules: [],
  placements: [],
  bindings: [],
  bindingRevisions: [],
});

const s7ModR1R10ManifestGraph = (modules: {
  r1: { id: string; attributionSubjectId: string | null };
  r10: { id: string; attributionSubjectId: string | null };
}): FrozenP0Graph => ({
  ...populatedCutoverGraph(),
  identities: [
    {
      id: "a-s7mod-lid-r1",
      sourceSystem: "wiseeff-v1",
      sourceKind: "parameter-module",
      ownerScopeKind: "organization",
      ownerScopeId: "s7mod-org",
      sourceId: modules.r1.id,
    },
    {
      id: "b-s7mod-lid-r10",
      sourceSystem: "wiseeff-v1",
      sourceKind: "parameter-module",
      ownerScopeKind: "organization",
      ownerScopeId: "s7mod-org",
      sourceId: modules.r10.id,
    },
  ],
  modules: [
    {
      id: modules.r1.id,
      organizationId: "s7mod-org",
      kind: "driver-group",
      origin: "curated",
      name: "amba",
      attributionSubjectId: modules.r1.attributionSubjectId,
    },
    {
      id: modules.r10.id,
      organizationId: "s7mod-org",
      kind: "driver-group",
      origin: "curated",
      name: "s7mod-unknown",
      attributionSubjectId: modules.r10.attributionSubjectId,
    },
  ],
});

describe("S7-ORC restartable pre-activation cutover", { timeout: CATALOG_TEST_TIMEOUT_MS }, () => {
  let database: ParameterCatalogDatabase;
  let pool: pg.Pool;
  let client: pg.Client;
  let objectRoot: string;
  let encryptionKey: Buffer;
  let bundle: CatalogReleaseBundle;
  let plan: CutoverPlan;
  const graph = populatedCutoverGraph();

  beforeAll(async () => {
    const classified = classifyFrozenP0Graph(graph);
    expect(classified.ok).toBe(true);
    if (classified.ok) {
      expect(classified.value.blockers).toHaveLength(0);
      expect(classified.value.assignments.map((row) => row.rClass).sort()).toEqual(["R1", "R10"]);
    }

    database = await createDisposableParameterCatalogDatabase("s7orc");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    client = new pg.Client({ connectionString: database.url });
    await client.connect();
    objectRoot = await mkdtemp(path.join(os.tmpdir(), "s7orc-objects-"));
    encryptionKey = randomBytes(32);
    bundle = firstReleaseBundle();
    const compiled = compileCatalogRelease(bundle);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error(compiled.error.kind);
    await seedPopulatedCutover(client, graph);
    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(bundle),
      expectedTargetDigest: compiled.value.release.digest,
    });
    expect(installed.ok).toBe(true);
    const planned = await planCutover({
      graph,
      targetArtifactSha: "b".repeat(40),
      targetCatalogReleaseDigest: compiled.value.release.digest,
      identities: fixtureCutoverIdentities(),
      catalogReleaseSource: jsonCatalogReleaseSource(bundle),
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) throw new Error(planned.error.detail);
    plan = planned.value;
  }, CATALOG_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await client?.end().catch(() => undefined);
    await pool?.end().catch(() => undefined);
    await database?.close();
    if (objectRoot) await rm(objectRoot, { recursive: true, force: true });
  }, CATALOG_HOOK_TIMEOUT_MS);

  const executeInput = (failBeforePhase?: CutoverPlan["phases"][number]) => ({
    pool,
    plan,
    graph,
    catalogReleaseSource: jsonCatalogReleaseSource(bundle),
    archiveObjectStore: createLocalArchiveObjectStore(objectRoot),
    archiveEncryptionKey: encryptionKey,
    operatorAuditRef: "audit-s7orc-operator",
    failBeforePhase,
    quiescence: fixtureObservedQuiescence(),
    recoveryPoint: fixtureObservedRecoveryPoint(),
  });

  it("freezes the seven R3 threat-matrix rows", () => {
    expect(THREAT_MATRIX.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(THREAT_MATRIX.map((row) => row.name)).toEqual([
      "planned-p0-p10-checkpoints",
      "duplicate-plan-execute-resume",
      "unknown-or-adhoc-phase",
      "rollback-dump-equality",
      "crash-mid-phase-resume",
      "populated-catalog-required",
      "frozen-producer-types-no-release-writer",
    ]);
  });

  it("T1 plans and executes P0-P10 into ordered checkpoints with mapping and Archive residue", async () => {
    const crashed = await executeCutover(executeInput("P7"));
    expect(crashed.ok).toBe(false);
    if (crashed.ok) return;
    expect(crashed.error.code).toBe("PCAT-ORC-CRASH");

    const inspected = await inspectCutover({ pool, planDigest: plan.planDigest });
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    expect(inspected.value.checkpoints.map((row) => row.phase)).toEqual([
      "P0",
      "P1",
      "P2",
      "P3",
      "P4",
      "P5",
      "P6",
    ]);
    expect(inspected.value.planDigest).toBe(plan.planDigest);

    const resumed = await executeCutover(executeInput());
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.value.resumed).toBe(true);
    expect(resumed.value.state).toBe("completed");
    expect(resumed.value.checkpoints.map((row) => row.phase)).toEqual([...PRE_ACTIVATION_PHASES]);
    expect(resumed.value.liveRun).toBe(false);

    const residue = await client.query<{ mappings: string; archives: string }>(
      `
      select
        (select count(*)::text from parameter_catalog.legacy_mapping_versions where cutover_run_id = $1) as mappings,
        (select count(*)::text from parameter_catalog.parameter_catalog_archives where cutover_run_id = $1) as archives
      `,
      [resumed.value.runId],
    );
    expect(Number(residue.rows[0]?.mappings)).toBeGreaterThan(0);
    expect(Number(residue.rows[0]?.archives)).toBeGreaterThan(0);
  });

  it("T2 duplicate plan/execute resumes the same run and does not start a second live run", async () => {
    const again = await planCutover({
      graph,
      targetArtifactSha: plan.targetArtifactSha,
      targetCatalogReleaseDigest: plan.targetCatalogReleaseDigest,
      identities: fixtureCutoverIdentities(),
      catalogReleaseSource: jsonCatalogReleaseSource(bundle),
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.planDigest).toBe(plan.planDigest);

    const duplicate = await executeCutover(executeInput());
    expect(duplicate.ok).toBe(true);
    if (!duplicate.ok) return;
    expect(duplicate.value.resumed).toBe(true);
    expect(duplicate.value.state).toBe("completed");
    expect(duplicate.value.liveRun).toBe(false);

    const runs = await client.query<{ n: string }>(
      `
      select count(*)::text as n
        from parameter_catalog.parameter_catalog_cutover_runs
       where plan_digest = $1
      `,
      [plan.planDigest],
    );
    expect(runs.rows[0]?.n).toBe("1");
  });

  it("P2 refuses execute without observed quiescence", async () => {
    const planned = await planCutover({
      graph,
      targetArtifactSha: "d".repeat(40),
      targetCatalogReleaseDigest: plan.targetCatalogReleaseDigest,
      identities: fixtureCutoverIdentities(),
      catalogReleaseSource: jsonCatalogReleaseSource(bundle),
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const { quiescence: _ignored, ...withoutQuiescence } = executeInput();
    const refused = await executeCutover({
      ...withoutQuiescence,
      plan: planned.value,
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.code).toBe("PCAT-ORC-PHASE-FAILED");
    expect(refused.error.detail).toMatch(/attestation is not proof/);
  });

  it("T3 unknown and activation phases are typed refusals", async () => {
    const unknown = await executeCutover({
      ...executeInput(),
      failBeforePhase: "P12" as never,
    });
    expect(unknown.ok).toBe(false);
    if (unknown.ok) return;
    expect(unknown.error.code).toBe("PCAT-ORC-ACTIVATION-UNAVAILABLE");
  });

  it("T6 empty catalog is not P0-P10 evidence", async () => {
    const empty = await planCutover({
      graph: { ...graph, identities: [] },
      targetArtifactSha: plan.targetArtifactSha,
      targetCatalogReleaseDigest: plan.targetCatalogReleaseDigest,
      identities: fixtureCutoverIdentities(),
    });
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.error.code).toBe("PCAT-ORC-NOT-POPULATED");
  });

  it("interrupts every durable pre-activation phase then resumes to completion", async () => {
    const isolated = await createDisposableParameterCatalogDatabase("s7orc-int");
    const isolatedPool = new pg.Pool({ connectionString: isolated.url, max: 4 });
    const isolatedClient = new pg.Client({ connectionString: isolated.url });
    const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), "s7orc-int-"));
    let postP7: {
      runId: string;
      mappingVersions: readonly { id: string; legacy_identity_id: string; version_number: string; cutover_run_id: string }[];
      archives: readonly { id: string; legacy_identity_id: string; cutover_run_id: string }[];
      p7CheckpointDigest: string;
      manifestDigest: string;
    } | null = null;
    try {
      await isolatedClient.connect();
      await seedPopulatedCutover(isolatedClient, graph);
      const compiled = compileCatalogRelease(bundle);
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) return;
      const installed = await installPublishedRelease(isolatedPool, {
        mode: "bootstrap",
        source: jsonCatalogReleaseSource(bundle),
        expectedTargetDigest: compiled.value.release.digest,
      });
      expect(installed.ok).toBe(true);
      const planned = await planCutover({
        graph,
        targetArtifactSha: "e".repeat(40),
        targetCatalogReleaseDigest: plan.targetCatalogReleaseDigest,
        identities: fixtureCutoverIdentities("interrupt"),
        catalogReleaseSource: jsonCatalogReleaseSource(bundle),
      });
      expect(planned.ok).toBe(true);
      if (!planned.ok) return;
      const isolatedExecute = (failBeforePhase?: CutoverPlan["phases"][number]) => ({
        ...executeInput(failBeforePhase),
        pool: isolatedPool,
        plan: planned.value,
        archiveObjectStore: createLocalArchiveObjectStore(isolatedRoot),
      });
      for (const phase of PRE_ACTIVATION_PHASES) {
        const interrupted = await executeCutover(isolatedExecute(phase));
        expect(interrupted.ok, phase).toBe(false);
        if (interrupted.ok) return;
        expect(interrupted.error.code, `${phase}: ${interrupted.error.detail}`).toBe("PCAT-ORC-CRASH");
        if (phase === "P8") {
          const storedRun = await isolatedClient.query<{ id: string }>(
            "select id from parameter_catalog.parameter_catalog_cutover_runs where plan_digest = $1",
            [planned.value.planDigest],
          );
          const runId = storedRun.rows[0]?.id;
          expect(runId).toBeTruthy();
          if (!runId) return;
          const mappings = await isolatedClient.query<{
            id: string;
            legacy_identity_id: string;
            version_number: string;
            cutover_run_id: string;
          }>(
            `select id, legacy_identity_id, version_number::text as version_number, cutover_run_id
               from parameter_catalog.legacy_mapping_versions
              where cutover_run_id = $1
              order by legacy_identity_id, version_number, id`,
            [runId],
          );
          const archives = await isolatedClient.query<{
            id: string;
            legacy_identity_id: string;
            cutover_run_id: string;
          }>(
            `select id, legacy_identity_id, cutover_run_id
               from parameter_catalog.parameter_catalog_archives
              where cutover_run_id = $1
              order by legacy_identity_id, id`,
            [runId],
          );
          const p7Rows = await isolatedClient.query<{
            checkpoint_digest: string;
            payload: Record<string, unknown>;
          }>(
            `select checkpoint_digest, payload
               from parameter_catalog.parameter_catalog_cutover_checkpoints
              where cutover_run_id = $1 and phase = 'P7'`,
            [runId],
          );
          expect(mappings.rowCount).toBe(graph.identities.length);
          expect(archives.rowCount).toBeGreaterThan(0);
          expect(p7Rows.rowCount).toBe(1);
          const manifest = parseMappingManifestV2(p7Rows.rows[0]?.payload.mappingManifest);
          expect(manifest).not.toBeNull();
          if (!manifest || !p7Rows.rows[0]) return;
          expect(manifest.selectionCount).toBe(graph.identities.length);
          postP7 = {
            runId,
            mappingVersions: mappings.rows,
            archives: archives.rows,
            p7CheckpointDigest: p7Rows.rows[0].checkpoint_digest,
            manifestDigest: manifest.digest,
          };
        }
      }
      expect(postP7).not.toBeNull();
      const resumed = await executeCutover(isolatedExecute());
      expect(resumed.ok).toBe(true);
      if (!resumed.ok) return;
      expect(resumed.value.state).toBe("completed");
      expect(resumed.value.checkpoints.map((row) => row.phase)).toEqual([...PRE_ACTIVATION_PHASES]);
      if (!postP7) return;
      const finalMappings = await isolatedClient.query<{
        id: string;
        legacy_identity_id: string;
        version_number: string;
        cutover_run_id: string;
      }>(
        `select id, legacy_identity_id, version_number::text as version_number, cutover_run_id
           from parameter_catalog.legacy_mapping_versions
          where cutover_run_id = $1
          order by legacy_identity_id, version_number, id`,
        [postP7.runId],
      );
      const finalArchives = await isolatedClient.query<{
        id: string;
        legacy_identity_id: string;
        cutover_run_id: string;
      }>(
        `select id, legacy_identity_id, cutover_run_id
           from parameter_catalog.parameter_catalog_archives
          where cutover_run_id = $1
          order by legacy_identity_id, id`,
        [postP7.runId],
      );
      const finalP7Rows = await isolatedClient.query<{
        checkpoint_digest: string;
        payload: Record<string, unknown>;
      }>(
        `select checkpoint_digest, payload
           from parameter_catalog.parameter_catalog_cutover_checkpoints
          where cutover_run_id = $1 and phase = 'P7'`,
        [postP7.runId],
      );
      expect(finalMappings.rows).toEqual(postP7.mappingVersions);
      expect(finalArchives.rows).toEqual(postP7.archives);
      expect(finalP7Rows.rowCount).toBe(1);
      expect(finalP7Rows.rows[0]?.checkpoint_digest).toBe(postP7.p7CheckpointDigest);
      const finalManifest = parseMappingManifestV2(finalP7Rows.rows[0]?.payload.mappingManifest);
      expect(finalManifest?.digest).toBe(postP7.manifestDigest);
      expect(finalManifest?.selections.map((selection) => selection.mappingVersion.id)).toEqual(
        postP7.mappingVersions.map((row) => row.id),
      );
    } finally {
      await isolatedClient.end().catch(() => undefined);
      await isolatedPool.end().catch(() => undefined);
      await isolated.close().catch(() => undefined);
      await rm(isolatedRoot, { recursive: true, force: true });
    }
  });

  it("refuses P7 when the current Catalog Release drifts from P1, P5, and the plan", async () => {
    const isolated = await createDisposableParameterCatalogDatabase("s7orc-pin-drift");
    const isolatedPool = new pg.Pool({ connectionString: isolated.url, max: 4 });
    const isolatedClient = new pg.Client({ connectionString: isolated.url });
    const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), "s7orc-pin-drift-"));
    try {
      await isolatedClient.connect();
      await seedPopulatedCutover(isolatedClient, graph);
      const firstCompiled = compileCatalogRelease(bundle);
      expect(firstCompiled.ok).toBe(true);
      if (!firstCompiled.ok) return;
      const firstInstall = await installPublishedRelease(isolatedPool, {
        mode: "bootstrap",
        source: jsonCatalogReleaseSource(bundle),
        expectedTargetDigest: firstCompiled.value.release.digest,
      });
      expect(firstInstall.ok).toBe(true);
      if (!firstInstall.ok) return;
      const planned = await planCutover({
        graph,
        targetArtifactSha: "c".repeat(40),
        targetCatalogReleaseDigest: firstCompiled.value.release.digest,
        identities: fixtureCutoverIdentities("p7-release-pin-drift"),
        catalogReleaseSource: jsonCatalogReleaseSource(bundle),
      });
      expect(planned.ok).toBe(true);
      if (!planned.ok) return;
      expect(planned.value.migrationContractVersion).toBe(MIGRATION_CONTRACT_VERSION);

      const objectStore = createLocalArchiveObjectStore(isolatedRoot);
      const executeInput = {
        pool: isolatedPool,
        plan: planned.value,
        graph,
        catalogReleaseSource: jsonCatalogReleaseSource(bundle),
        archiveObjectStore: objectStore,
        archiveEncryptionKey: randomBytes(32),
        operatorAuditRef: "audit-s7-p7-pin-drift",
        quiescence: fixtureObservedQuiescence(),
        recoveryPoint: fixtureObservedRecoveryPoint(),
      };
      const stoppedBeforeP7 = await executeCutover({ ...executeInput, failBeforePhase: "P7" });
      expect(stoppedBeforeP7.ok).toBe(false);
      if (stoppedBeforeP7.ok) return;
      expect(stoppedBeforeP7.error.code).toBe("PCAT-ORC-CRASH");
      const run = await isolatedClient.query<{ id: string }>(
        "select id from parameter_catalog.parameter_catalog_cutover_runs where plan_digest = $1",
        [planned.value.planDigest],
      );
      const runId = run.rows[0]?.id;
      expect(runId).toBeTruthy();
      if (!runId) return;
      const beforeP7 = await isolatedClient.query<{ mappings: string; archives: string; checkpoints: string }>(
        `select
           (select count(*)::text from parameter_catalog.legacy_mapping_versions where cutover_run_id = $1) as mappings,
           (select count(*)::text from parameter_catalog.parameter_catalog_archives where cutover_run_id = $1) as archives,
           (select count(*)::text from parameter_catalog.parameter_catalog_cutover_checkpoints where cutover_run_id = $1 and phase = 'P7') as checkpoints`,
        [runId],
      );
      expect(beforeP7.rows[0]).toEqual({ mappings: "0", archives: "0", checkpoints: "0" });

      const successorBundle = validCatalogReleaseBundle();
      const successorCompiled = compileCatalogRelease(successorBundle);
      expect(successorCompiled.ok).toBe(true);
      if (!successorCompiled.ok) return;
      const advancedRelease = await installPublishedRelease(isolatedPool, {
        mode: "advance",
        source: jsonCatalogReleaseSource(successorBundle),
        expectedCurrent: firstInstall.value.current,
        expectedTargetDigest: successorCompiled.value.release.digest,
      });
      expect(advancedRelease.ok).toBe(true);
      if (!advancedRelease.ok) return;
      expect(advancedRelease.value.current.digest).not.toBe(planned.value.targetCatalogReleaseDigest);

      const refused = await executeCutover(executeInput);
      expect(refused.ok).toBe(false);
      if (refused.ok) return;
      expect(refused.error.code).toBe("PCAT-ORC-PHASE-FAILED");
      expect(refused.error.detail).toMatch(/P1, P5, or the plan/);
      const afterP7 = await isolatedClient.query<{ mappings: string; archives: string; checkpoints: string; all_checkpoints: string }>(
        `select
           (select count(*)::text from parameter_catalog.legacy_mapping_versions where cutover_run_id = $1) as mappings,
           (select count(*)::text from parameter_catalog.parameter_catalog_archives where cutover_run_id = $1) as archives,
           (select count(*)::text from parameter_catalog.parameter_catalog_cutover_checkpoints where cutover_run_id = $1 and phase = 'P7') as checkpoints,
           (select count(*)::text from parameter_catalog.parameter_catalog_cutover_checkpoints where cutover_run_id = $1) as all_checkpoints`,
        [runId],
      );
      expect(afterP7.rows[0]).toEqual({ mappings: "0", archives: "0", checkpoints: "0", all_checkpoints: "7" });
    } finally {
      await isolatedClient.end().catch(() => undefined);
      await isolatedPool.end().catch(() => undefined);
      await isolated.close().catch(() => undefined);
      await rm(isolatedRoot, { recursive: true, force: true });
    }
  });

  it("retries the same P7 run after an archive object failure without duplicating mappings", async () => {
    const manifestGraph = s7R9R10ManifestGraph();
    const classified = classifyFrozenP0Graph(manifestGraph);
    expect(classified.ok).toBe(true);
    if (!classified.ok) return;
    expect(classified.value.assignments.map((row) => row.rClass)).toEqual(["R9", "R10"]);

    const isolated = await createDisposableParameterCatalogDatabase("s7p7retry");
    const isolatedPool = new pg.Pool({ connectionString: isolated.url, max: 4 });
    const isolatedClient = new pg.Client({ connectionString: isolated.url });
    const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), "s7p7retry-"));
    try {
      await isolatedClient.connect();
      await seedPopulatedCutover(isolatedClient, manifestGraph);
      const compiled = compileCatalogRelease(bundle);
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) return;
      const installed = await installPublishedRelease(isolatedPool, {
        mode: "bootstrap",
        source: jsonCatalogReleaseSource(bundle),
        expectedTargetDigest: compiled.value.release.digest,
      });
      expect(installed.ok).toBe(true);
      if (!installed.ok) return;
      const retryPlan = await planCutover({
        graph: manifestGraph,
        targetArtifactSha: "d".repeat(40),
        targetCatalogReleaseDigest: compiled.value.release.digest,
        identities: fixtureCutoverIdentities("p7-manifest-retry"),
        catalogReleaseSource: jsonCatalogReleaseSource(bundle),
      });
      expect(retryPlan.ok).toBe(true);
      if (!retryPlan.ok) return;

      const objectStore = createLocalArchiveObjectStore(isolatedRoot);
      let failFirstArchiveWrite = true;
      const failOnceObjectStore = {
        ...objectStore,
        async putExclusive(ref: string, bytes: Buffer) {
          if (failFirstArchiveWrite) {
            failFirstArchiveWrite = false;
            throw new Error("injected P7 archive object failure");
          }
          return objectStore.putExclusive(ref, bytes);
        },
      };
      const executeInputFor = (archiveObjectStore: typeof objectStore) => ({
        pool: isolatedPool,
        plan: retryPlan.value,
        graph: manifestGraph,
        catalogReleaseSource: jsonCatalogReleaseSource(bundle),
        archiveObjectStore,
        archiveEncryptionKey: encryptionKey,
        operatorAuditRef: "audit-s7-p7-same-run-retry",
        quiescence: fixtureObservedQuiescence(),
        recoveryPoint: fixtureObservedRecoveryPoint(),
      });

      const interrupted = await executeCutover(executeInputFor(failOnceObjectStore));
      expect(interrupted.ok).toBe(false);
      if (interrupted.ok) return;
      expect(interrupted.error.code).toBe("PCAT-ORC-PHASE-FAILED");
      const runRow = await isolatedClient.query<{ id: string }>(
        "select id from parameter_catalog.parameter_catalog_cutover_runs where plan_digest = $1",
        [retryPlan.value.planDigest],
      );
      const runId = runRow.rows[0]?.id;
      expect(runId).toBeTruthy();
      if (!runId) return;
      const mappingsBeforeRetry = await isolatedClient.query<{
        id: string;
        legacy_identity_id: string;
        version_number: string;
        cutover_run_id: string;
      }>(
        `select id, legacy_identity_id, version_number::text as version_number, cutover_run_id
           from parameter_catalog.legacy_mapping_versions
          where cutover_run_id = $1
          order by legacy_identity_id, version_number, id`,
        [runId],
      );
      expect(mappingsBeforeRetry.rows).toHaveLength(1);
      expect(mappingsBeforeRetry.rows[0]?.legacy_identity_id).toBe("a-s7p7-lid-r9");
      const firstMappingVersionId = mappingsBeforeRetry.rows[0]?.id;
      expect(firstMappingVersionId).toBeTruthy();
      const noArchiveBeforeRetry = await isolatedClient.query<{ count: string }>(
        "select count(*)::text as count from parameter_catalog.parameter_catalog_archives where cutover_run_id = $1",
        [runId],
      );
      const noP7BeforeRetry = await isolatedClient.query<{ count: string }>(
        "select count(*)::text as count from parameter_catalog.parameter_catalog_cutover_checkpoints where cutover_run_id = $1 and phase = 'P7'",
        [runId],
      );
      expect(noArchiveBeforeRetry.rows[0]?.count).toBe("0");
      expect(noP7BeforeRetry.rows[0]?.count).toBe("0");

      const resumed = await executeCutover(executeInputFor(objectStore));
      expect(resumed.ok).toBe(true);
      if (!resumed.ok) return;
      expect(resumed.value.runId).toBe(runId);
      expect(resumed.value.state).toBe("completed");
      expect(resumed.value.checkpoints.map((row) => row.phase)).toEqual([...PRE_ACTIVATION_PHASES]);
      for (const checkpoint of resumed.value.checkpoints) {
        expect(checkpoint.checkpointDigest).toBe(
          normalizedCheckpointDigestFor(checkpoint.phase, checkpoint.payload),
        );
      }

      const mappingsAfterRetry = await isolatedClient.query<{
        id: string;
        legacy_identity_id: string;
        version_number: string;
        cutover_run_id: string;
      }>(
        `select id, legacy_identity_id, version_number::text as version_number, cutover_run_id
           from parameter_catalog.legacy_mapping_versions
          where cutover_run_id = $1
          order by legacy_identity_id, version_number, id`,
        [runId],
      );
      expect(mappingsAfterRetry.rows).toHaveLength(2);
      expect(mappingsAfterRetry.rows[0]?.id).toBe(firstMappingVersionId);
      expect(mappingsAfterRetry.rows.map((row) => row.legacy_identity_id)).toEqual([
        "a-s7p7-lid-r9",
        "z-s7p7-lid-r10",
      ]);
      const archivesAfterRetry = await isolatedClient.query<{ id: string; legacy_identity_id: string }>(
        `select id, legacy_identity_id
           from parameter_catalog.parameter_catalog_archives
          where cutover_run_id = $1
          order by legacy_identity_id, id`,
        [runId],
      );
      expect(archivesAfterRetry.rows).toHaveLength(1);
      expect(archivesAfterRetry.rows[0]?.legacy_identity_id).toBe("z-s7p7-lid-r10");
      const p7Rows = await isolatedClient.query<{
        checkpoint_digest: string;
        payload: Record<string, unknown>;
      }>(
        `select checkpoint_digest, payload
           from parameter_catalog.parameter_catalog_cutover_checkpoints
          where cutover_run_id = $1 and phase = 'P7'`,
        [runId],
      );
      expect(p7Rows.rows).toHaveLength(1);
      expect(p7Rows.rows[0]?.checkpoint_digest).toBe(
        normalizedP7CheckpointDigestFor(p7Rows.rows[0]?.payload ?? {}),
      );
      const manifest = parseMappingManifestV2(p7Rows.rows[0]?.payload.mappingManifest);
      expect(manifest).not.toBeNull();
      if (!manifest || !firstMappingVersionId || !p7Rows.rows[0]) return;
      expect(manifest.selections.map((selection) => [
        selection.legacyIdentityId,
        selection.status,
        selection.mappingVersion.id,
        selection.mappingVersion.cutoverRunId,
        selection.headCasVersion,
      ])).toEqual([
        ["a-s7p7-lid-r9", "replayed", firstMappingVersionId, runId, 1],
        ["z-s7p7-lid-r10", "appended", mappingsAfterRetry.rows[1]?.id, runId, 1],
      ]);
      expect(manifest.selections[1]?.mappingVersion.archiveId).toBe(archivesAfterRetry.rows[0]?.id);
    } finally {
      await isolatedClient.end().catch(() => undefined);
      await isolatedPool.end().catch(() => undefined);
      await isolated.close().catch(() => undefined);
      await rm(isolatedRoot, { recursive: true, force: true });
    }
  });

  it("reproduces cross-run P7 replay, current-run append, and a later head advance", async () => {
    const manifestGraph = s7R9R10ManifestGraph();
    const classification = classifyFrozenP0Graph(manifestGraph);
    expect(classification.ok).toBe(true);
    if (!classification.ok) return;
    expect(classification.value.assignments.map((row) => row.rClass)).toEqual(["R9", "R10"]);

    const isolated = await createDisposableParameterCatalogDatabase("s7p7manifest");
    const isolatedPool = new pg.Pool({ connectionString: isolated.url, max: 4 });
    const isolatedClient = new pg.Client({ connectionString: isolated.url });
    const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), "s7p7manifest-"));
    try {
      await isolatedClient.connect();
      await seedPopulatedCutover(isolatedClient, manifestGraph);
      const compiled = compileCatalogRelease(bundle);
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) return;
      const installed = await installPublishedRelease(isolatedPool, {
        mode: "bootstrap",
        source: jsonCatalogReleaseSource(bundle),
        expectedTargetDigest: compiled.value.release.digest,
      });
      expect(installed.ok).toBe(true);

      const planA = await planCutover({
        graph: manifestGraph,
        targetArtifactSha: "f".repeat(40),
        targetCatalogReleaseDigest: plan.targetCatalogReleaseDigest,
        identities: fixtureCutoverIdentities("p7-manifest"),
        catalogReleaseSource: jsonCatalogReleaseSource(bundle),
      });
      expect(planA.ok).toBe(true);
      if (!planA.ok) return;

      const objectStore = createLocalArchiveObjectStore(isolatedRoot);
      const failArchiveWrite = {
        ...objectStore,
        async putExclusive() {
          throw new Error("injected P7 archive object failure");
        },
      };
      const executeInputFor = (
        runPlan: CutoverPlan,
        archiveObjectStore: ReturnType<typeof createLocalArchiveObjectStore>,
      ) => ({
        pool: isolatedPool,
        plan: runPlan,
        graph: manifestGraph,
        catalogReleaseSource: jsonCatalogReleaseSource(bundle),
        archiveObjectStore,
        archiveEncryptionKey: encryptionKey,
        operatorAuditRef: "audit-s7-p7-manifest",
        quiescence: fixtureObservedQuiescence(),
        recoveryPoint: fixtureObservedRecoveryPoint(),
      });

      const runA = await executeCutover(executeInputFor(planA.value, failArchiveWrite));
      expect(runA.ok).toBe(false);
      if (runA.ok) return;
      expect(runA.error.code).toBe("PCAT-ORC-PHASE-FAILED");
      const runARow = await isolatedClient.query<{ id: string }>(
        "select id from parameter_catalog.parameter_catalog_cutover_runs where plan_digest = $1",
        [planA.value.planDigest],
      );
      const runAId = runARow.rows[0]?.id;
      expect(runAId).toBeTruthy();
      if (!runAId) return;
      const runACheckpoint = await isolatedClient.query(
        "select phase from parameter_catalog.parameter_catalog_cutover_checkpoints where cutover_run_id = $1 and phase = 'P7'",
        [runAId],
      );
      expect(runACheckpoint.rowCount).toBe(0);
      const headAfterA = await readCurrentMappingHead({
        client: isolatedClient,
        identityId: "a-s7p7-lid-r9",
      });
      if (!headAfterA.ok) {
        throw new Error(`run A failed at ${runA.error.code}: ${runA.error.detail}; head read: ${headAfterA.error.code}`);
      }
      expect(headAfterA.value.version.cutoverRunId).toBe(runAId);

      const planB = await planCutover({
        graph: manifestGraph,
        targetArtifactSha: "e".repeat(40),
        targetCatalogReleaseDigest: plan.targetCatalogReleaseDigest,
        identities: fixtureCutoverIdentities("p7-manifest"),
        catalogReleaseSource: jsonCatalogReleaseSource(bundle),
      });
      expect(planB.ok).toBe(true);
      if (!planB.ok) return;
      const runB = await executeCutover(executeInputFor(planB.value, objectStore));
      expect(runB.ok).toBe(true);
      if (!runB.ok) return;
      expect(runB.value.state).toBe("completed");

      const headAfterB = await readCurrentMappingHead({
        client: isolatedClient,
        identityId: "a-s7p7-lid-r9",
      });
      const secondHead = await readCurrentMappingHead({
        client: isolatedClient,
        identityId: "z-s7p7-lid-r10",
      });
      expect(headAfterB.ok).toBe(true);
      expect(secondHead.ok).toBe(true);
      if (!headAfterB.ok || !secondHead.ok) return;
      expect(headAfterB.value.currentVersionId).toBe(headAfterA.value.currentVersionId);
      expect(headAfterB.value.version.cutoverRunId).toBe(runAId);
      expect(secondHead.value.version.cutoverRunId).toBe(runB.value.runId);

      const p7 = runB.value.checkpoints.find((row) => row.phase === "P7");
      expect(p7).toBeDefined();
      if (!p7) return;
      expect(p7?.payload.dispatched).toEqual([
        "a-s7p7-lid-r9:mapped",
        "z-s7p7-lid-r10:archived",
      ]);
      expect(p7.checkpointDigest).toBe(normalizedP7CheckpointDigestFor(p7.payload));
      const mappingManifest = parseMappingManifestV2(p7.payload.mappingManifest);
      expect(mappingManifest).not.toBeNull();
      if (!mappingManifest) return;
      const tamperedManifest = {
        ...mappingManifest,
        selections: mappingManifest.selections.map((selection, index) =>
          index === 0
            ? {
                ...selection,
                mappingVersion: { ...selection.mappingVersion, id: "lmap_tampered" },
              }
            : selection,
        ),
      };
      expect(parseMappingManifestV2(tamperedManifest)).toBeNull();
      expect(
        normalizedP7CheckpointDigestFor({ ...p7.payload, mappingManifest: tamperedManifest }),
      ).not.toBe(p7.checkpointDigest);
      expect(mappingManifest.selectionRunId).toBe(runB.value.runId);
      expect(mappingManifest.planDigest).toBe(planB.value.planDigest);
      expect(mappingManifest.selectionCount).toBe(2);
      expect(mappingManifest.selections.map((selection) => [
        selection.legacyIdentityId,
        selection.status,
        selection.mappingVersion.id,
        selection.mappingVersion.cutoverRunId,
        selection.headCasVersion,
      ])).toEqual([
        ["a-s7p7-lid-r9", "replayed", headAfterA.value.currentVersionId, runAId, 1],
        ["z-s7p7-lid-r10", "appended", secondHead.value.currentVersionId, runB.value.runId, 1],
      ]);

      const subjectTarget = await isolatedClient.query<{ id: string }>(
        "select id from parameter_catalog.catalog_subjects order by id limit 1",
      );
      const nextTarget = subjectTarget.rows[0]?.id;
      expect(nextTarget).toBeTruthy();
      if (!nextTarget) return;

      const advanced = await appendMappingVersion({
        client: isolatedClient,
        cutoverRunId: runB.value.runId,
        classification: classification.value,
        identityId: "a-s7p7-lid-r9",
        sourceChecksum: "sha256:s7-orc-later-head-advance",
        expectedHead: {
          casVersion: headAfterB.value.casVersion,
          versionId: headAfterB.value.currentVersionId,
        },
        outcome: {
          kind: "operational",
          targetKind: "catalog-subject",
          targetId: nextTarget,
        },
      });
      expect(advanced.ok).toBe(true);
      if (!advanced.ok || advanced.value.status !== "appended") return;
      expect(advanced.value.head.version.versionNumber).toBe(2);
      expect(advanced.value.head.currentVersionId).not.toBe(headAfterB.value.currentVersionId);
      const persistedAfterAdvance = await isolatedClient.query<{ payload: unknown }>(
        "select payload from parameter_catalog.parameter_catalog_cutover_checkpoints where cutover_run_id = $1 and phase = 'P7'",
        [runB.value.runId],
      );
      const afterAdvanceManifest = parseMappingManifestV2(
        (persistedAfterAdvance.rows[0]?.payload as { mappingManifest?: unknown } | undefined)
          ?.mappingManifest,
      );
      expect(afterAdvanceManifest?.digest).toBe(mappingManifest.digest);
      expect(afterAdvanceManifest?.selections[0]?.mappingVersion.id).toBe(headAfterA.value.currentVersionId);
      expect(advanced.value.head.currentVersionId).not.toBe(afterAdvanceManifest?.selections[0]?.mappingVersion.id);
      expect(p7.payload.dispatched).toEqual([
        "a-s7p7-lid-r9:mapped",
        "z-s7p7-lid-r10:archived",
      ]);
    } finally {
      await isolatedClient.end().catch(() => undefined);
      await isolatedPool.end().catch(() => undefined);
      await isolated.close().catch(() => undefined);
      await rm(isolatedRoot, { recursive: true, force: true });
    }
  });

  it("refuses cross-run replay when a MOD mapping's new Archive ID differs", async () => {
    const isolated = await createDisposableParameterCatalogDatabase("s7modreplay");
    const isolatedPool = new pg.Pool({ connectionString: isolated.url, max: 4 });
    const isolatedClient = new pg.Client({ connectionString: isolated.url });
    const ownerDatabase = createPostgresDatabase(isolated.url);
    const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), "s7mod-replay-"));
    try {
      await isolatedClient.connect();
      await seedOrganization(isolatedClient, { id: "s7mod-org" });
      const moduleR1 = await createParameterModule(ownerDatabase, {
        organizationId: "s7mod-org",
        name: "amba",
        kind: "driver-group",
        origin: "curated",
        sourceKey: "compatible:s7mod-r1",
      });
      const moduleR10 = await createParameterModule(ownerDatabase, {
        organizationId: "s7mod-org",
        name: "s7mod-unknown",
        kind: "driver-group",
        origin: "curated",
        sourceKey: "compatible:s7mod-r10",
      });
      const modGraph = s7ModR1R10ManifestGraph({
        r1: { id: moduleR1.id, attributionSubjectId: moduleR1.attributionSubjectId },
        r10: { id: moduleR10.id, attributionSubjectId: moduleR10.attributionSubjectId },
      });
      const classification = classifyFrozenP0Graph(modGraph);
      expect(classification.ok).toBe(true);
      if (!classification.ok) return;
      expect(classification.value.assignments.map(({ identityId, rClass }) => [identityId, rClass])).toEqual([
        ["a-s7mod-lid-r1", "R1"],
        ["b-s7mod-lid-r10", "R10"],
      ]);
      await seedPopulatedCutover(isolatedClient, modGraph);
      const compiled = compileCatalogRelease(bundle);
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) return;
      const installed = await installPublishedRelease(isolatedPool, {
        mode: "bootstrap",
        source: jsonCatalogReleaseSource(bundle),
        expectedTargetDigest: compiled.value.release.digest,
      });
      expect(installed.ok).toBe(true);
      if (!installed.ok) return;

      const makePlan = async (artifactSha: string, seed: string) => planCutover({
        graph: modGraph,
        targetArtifactSha: artifactSha,
        targetCatalogReleaseDigest: compiled.value.release.digest,
        identities: fixtureCutoverIdentities(seed),
        catalogReleaseSource: jsonCatalogReleaseSource(bundle),
      });
      const planA = await makePlan("a".repeat(40), "s7mod-run-a");
      expect(planA.ok).toBe(true);
      if (!planA.ok) return;

      const objectStore = createLocalArchiveObjectStore(isolatedRoot);
      let archiveObjectWrites = 0;
      const failSecondArchiveWrite = {
        ...objectStore,
        async putExclusive(ref: string, bytes: Buffer) {
          archiveObjectWrites += 1;
          if (archiveObjectWrites === 2) throw new Error("injected second MOD Archive object failure");
          return objectStore.putExclusive(ref, bytes);
        },
      };
      const executeInputFor = (runPlan: CutoverPlan, archiveObjectStore: typeof objectStore) => ({
        pool: isolatedPool,
        plan: runPlan,
        graph: modGraph,
        catalogReleaseSource: jsonCatalogReleaseSource(bundle),
        archiveObjectStore,
        archiveEncryptionKey: encryptionKey,
        operatorAuditRef: `audit-${runPlan.targetArtifactSha.slice(0, 1)}-s7mod-replay`,
        quiescence: fixtureObservedQuiescence(),
        recoveryPoint: fixtureObservedRecoveryPoint(),
      });

      const runA = await executeCutover(executeInputFor(planA.value, failSecondArchiveWrite));
      expect(archiveObjectWrites).toBe(2);
      expect(runA).toMatchObject({
        ok: false,
        error: { code: "PCAT-ORC-PHASE-FAILED", detail: "injected second MOD Archive object failure" },
      });
      const inspectedA = await inspectCutover({ pool: isolatedPool, planDigest: planA.value.planDigest });
      expect(inspectedA.ok).toBe(true);
      if (!inspectedA.ok) return;
      expect(inspectedA.value.state).toBe("failed");
      expect(inspectedA.value.currentPhase).toBe("P7");
      expect(inspectedA.value.checkpoints.some(({ phase }) => phase === "P7")).toBe(false);

      const archiveReader = createArchiveAdapter({ client: isolatedClient, objectStore, encryptionKey });
      const archiveActor = { role: "cutover-operator" as const, auditRef: "audit-s7mod-replay-reader" };
      const firstArchiveA = await archiveReader.restoreArchive({
        actor: archiveActor,
        legacyIdentityId: "a-s7mod-lid-r1",
        cutoverRunId: inspectedA.value.runId,
      });
      expect(firstArchiveA.ok).toBe(true);
      if (!firstArchiveA.ok) return;
      expect(firstArchiveA.value.metadata.rClass).toBe("R1");
      expect(firstArchiveA.value.metadata.cutoverRunId).toBe(inspectedA.value.runId);
      expect(await archiveReader.restoreArchive({
        actor: archiveActor,
        legacyIdentityId: "b-s7mod-lid-r10",
        cutoverRunId: inspectedA.value.runId,
      })).toMatchObject({ ok: false, error: { code: "PCAT-ARC-NOT-FOUND" } });

      const firstHeadA = await readCurrentMappingHead({ client: isolatedClient, identityId: "a-s7mod-lid-r1" });
      expect(firstHeadA.ok).toBe(true);
      if (!firstHeadA.ok) return;
      expect(firstHeadA.value.version).toMatchObject({
        cutoverRunId: inspectedA.value.runId,
        versionNumber: 1,
        rClass: "R1",
        archiveId: firstArchiveA.value.metadata.archiveId,
      });
      expect(await readCurrentMappingHead({ client: isolatedClient, identityId: "b-s7mod-lid-r10" }))
        .toMatchObject({ ok: false, error: { code: "PCAT-MAP-UNMAPPED" } });

      const planB = await makePlan("b".repeat(40), "s7mod-run-b");
      expect(planB.ok).toBe(true);
      if (!planB.ok) return;
      const runB = await executeCutover(executeInputFor(planB.value, objectStore));
      expect(runB).toMatchObject({
        ok: false,
        error: {
          code: "PCAT-ORC-PHASE-FAILED",
          detail: "CAS mismatch: refusing to overwrite the current mapping head",
        },
      });
      const inspectedB = await inspectCutover({ pool: isolatedPool, planDigest: planB.value.planDigest });
      expect(inspectedB.ok).toBe(true);
      if (!inspectedB.ok) return;
      expect(inspectedB.value.runId).not.toBe(inspectedA.value.runId);
      expect(inspectedB.value.currentPhase).toBe("P7");
      expect(inspectedB.value.checkpoints.some(({ phase }) => phase === "P7")).toBe(false);

      const firstArchiveB = await archiveReader.restoreArchive({
        actor: archiveActor,
        legacyIdentityId: "a-s7mod-lid-r1",
        cutoverRunId: inspectedB.value.runId,
      });
      expect(firstArchiveB.ok).toBe(true);
      if (!firstArchiveB.ok) return;
      expect(firstArchiveB.value.metadata.archiveId).not.toBe(firstArchiveA.value.metadata.archiveId);
      expect(firstArchiveB.value.metadata.rClass).toBe("R1");
      expect(await appendMappingVersion({
        client: isolatedClient,
        cutoverRunId: inspectedB.value.runId,
        classification: classification.value,
        identityId: "a-s7mod-lid-r1",
        sourceChecksum: classification.value.graphFingerprint,
        expectedHead: null,
        outcome: { kind: "archived", archiveId: firstArchiveB.value.metadata.archiveId },
      })).toMatchObject({
        ok: false,
        error: {
          code: "PCAT-MAP-CONFLICT",
          detail: "CAS mismatch: refusing to overwrite the current mapping head",
        },
      });
      expect(await archiveReader.restoreArchive({
        actor: archiveActor,
        legacyIdentityId: "b-s7mod-lid-r10",
        cutoverRunId: inspectedB.value.runId,
      })).toMatchObject({ ok: false, error: { code: "PCAT-ARC-NOT-FOUND" } });

      const firstHeadB = await readCurrentMappingHead({ client: isolatedClient, identityId: "a-s7mod-lid-r1" });
      expect(firstHeadB).toEqual(firstHeadA);
      expect(await readCurrentMappingHead({ client: isolatedClient, identityId: "b-s7mod-lid-r10" }))
        .toMatchObject({ ok: false, error: { code: "PCAT-MAP-UNMAPPED" } });
      expect(await objectStore.listRefs()).toHaveLength(2);
    } finally {
      await isolatedClient.end().catch(() => undefined);
      await isolatedPool.end().catch(() => undefined);
      await ownerDatabase.close().catch(() => undefined);
      await isolated.close().catch(() => undefined);
      await rm(isolatedRoot, { recursive: true, force: true });
    }
  });

  it("resumes a persisted v1 run with its legacy P7 payload", async () => {
    const legacyPlanFields = {
      sourceSnapshotFingerprint: plan.sourceSnapshotFingerprint,
      targetArtifactSha: plan.targetArtifactSha,
      targetCatalogReleaseDigest: plan.targetCatalogReleaseDigest,
      migrationContractVersion: LEGACY_MIGRATION_CONTRACT_VERSION,
      phases: plan.phases,
      identities: plan.identities,
    };
    const legacyPlanDigest = `sha256:${createHash("sha256")
      .update(JSON.stringify(legacyPlanFields))
      .digest("hex")}`;
    const legacyPlan: CutoverPlan = { ...legacyPlanFields, planDigest: legacyPlanDigest };
    const isolated = await createDisposableParameterCatalogDatabase("s7orcv1resume");
    const isolatedPool = new pg.Pool({ connectionString: isolated.url, max: 4 });
    const isolatedClient = new pg.Client({ connectionString: isolated.url });
    const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), "s7orcv1resume-"));
    try {
      await isolatedClient.connect();
      await seedPopulatedCutover(isolatedClient, graph);
      const compiled = compileCatalogRelease(bundle);
      expect(compiled.ok).toBe(true);
      if (!compiled.ok) return;
      const installed = await installPublishedRelease(isolatedPool, {
        mode: "bootstrap",
        source: jsonCatalogReleaseSource(bundle),
        expectedTargetDigest: compiled.value.release.digest,
      });
      expect(installed.ok).toBe(true);

      const runId = `cutover_${legacyPlanDigest.slice("sha256:".length, "sha256:".length + 32)}`;
      const run = await insertPlannedRun(isolatedClient, { runId, plan: legacyPlan });
      expect(run.migration_contract_version).toBe(LEGACY_MIGRATION_CONTRACT_VERSION);
      for (const phase of PRE_ACTIVATION_PHASES.slice(0, 7)) {
        const checkpoint = await persistCheckpoint(isolatedClient, {
          runId,
          phase,
          payload: { legacyPriorCheckpoint: phase },
        });
        expect(checkpoint.ok, phase).toBe(true);
      }
      await updateRunProgress(isolatedClient, { runId, phase: "P6", state: "running" });
      const executeInput = {
        pool: isolatedPool,
        plan: legacyPlan,
        graph,
        catalogReleaseSource: jsonCatalogReleaseSource(bundle),
        archiveObjectStore: createLocalArchiveObjectStore(isolatedRoot),
        archiveEncryptionKey: randomBytes(32),
        operatorAuditRef: "audit-s7-v1-resume",
        quiescence: fixtureObservedQuiescence(),
        recoveryPoint: fixtureObservedRecoveryPoint(),
      };
      const forgedV2 = await executeCutover({
        ...executeInput,
        plan: { ...legacyPlan, migrationContractVersion: MIGRATION_CONTRACT_VERSION },
      });
      expect(forgedV2.ok).toBe(false);
      if (forgedV2.ok) return;
      expect(forgedV2.error.code).toBe("PCAT-ORC-INVALID-PLAN");
      const unchangedRun = await isolatedClient.query<{ migration_contract_version: string; current_phase: string }>(
        "select migration_contract_version, current_phase from parameter_catalog.parameter_catalog_cutover_runs where id = $1",
        [runId],
      );
      expect(unchangedRun.rows[0]).toEqual({
        migration_contract_version: LEGACY_MIGRATION_CONTRACT_VERSION,
        current_phase: "P6",
      });

      const resumed = await executeCutover(executeInput);
      expect(resumed.ok).toBe(true);
      if (!resumed.ok) return;
      const p7 = resumed.value.checkpoints.find((row) => row.phase === "P7");
      expect(p7?.payload).not.toHaveProperty("mappingManifest");
      expect(p7?.payload.dispatched).toEqual(["s7orc-lid-r1:archived", "s7orc-lid-r10:archived"]);
    } finally {
      await isolatedClient.end().catch(() => undefined);
      await isolatedPool.end().catch(() => undefined);
      await isolated.close().catch(() => undefined);
      await rm(isolatedRoot, { recursive: true, force: true });
    }
  });

  it("T7 consumes frozen producer types and has no catalog_releases writer DML or banned literals", async () => {
    const sources = await productionSources();
    expect(sources.length).toBe(5);
    const bannedDefinitions = ["parameter", "definitions"].join("_");
    const bannedValues = ["project_parameter", "values"].join("_");
    const joined = sources.map((row) => row.text).join("\n");
    expect(joined).toContain("classifier");
    expect(joined).toContain("mapping");
    expect(joined).toContain("archive");
    expect(joined).toContain("installPublishedRelease");
    expect(joined).toContain("registrationCommandFamily");
    expect(joined).toContain("stabilizeCanonicalBinding");
    for (const source of sources) {
      expect(source.text, source.name).not.toContain(bannedDefinitions);
      expect(source.text, source.name).not.toContain(bannedValues);
      expect(source.text, source.name).not.toMatch(
        /\b(?:insert|update|delete)\s+(?:into|from)?\s*parameter_catalog\.catalog_releases\b/i,
      );
    }
  });
});
