import { randomBytes } from "node:crypto";
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
import { createLocalArchiveObjectStore } from "./archive";
import { classifyFrozenP0Graph, type FrozenP0Graph } from "./classifier";
import {
  PRE_ACTIVATION_PHASES,
  THREAT_MATRIX,
  type CutoverPlan,
} from "./interface";
import {
  executeCutover,
  inspectCutover,
  planCutover,
} from "./orchestrator";

const CATALOG_TEST_TIMEOUT_MS = 60_000;
const CATALOG_HOOK_TIMEOUT_MS = 120_000;
const cutoverDir = path.dirname(fileURLToPath(import.meta.url));

const populatedCutoverGraph = (): FrozenP0Graph => ({
  catalog: "parameter-catalog-p0-graph",
  identities: [
    {
      id: "s7orc-lid-r1",
      sourceSystem: "wiseeff-v1",
      sourceKind: "parameter-spec",
      ownerScopeKind: "platform",
      ownerScopeId: "platform",
      sourceId: "s7orc-spec-r1",
    },
    {
      id: "s7orc-lid-r10",
      sourceSystem: "wiseeff-v1",
      sourceKind: "parameter-spec",
      ownerScopeKind: "platform",
      ownerScopeId: "platform",
      sourceId: "s7orc-spec-r10",
    },
  ],
  specs: [
    {
      id: "s7orc-spec-r1",
      organizationId: null,
      sourceKind: "dts",
      specificationKey: "s7orc.r1.status",
      attributionSubjectId: null,
      definitionLifecycle: "active",
      propertyKey: "status",
    },
    {
      id: "s7orc-spec-r10",
      organizationId: null,
      sourceKind: "dts",
      specificationKey: "s7orc.r10.unknown",
      attributionSubjectId: null,
      definitionLifecycle: "active",
      propertyKey: "s7orc,unknown",
    },
  ],
  specVersions: [
    {
      id: "s7orc-ver-r1",
      parameterSpecId: "s7orc-spec-r1",
      version: 1,
      lifecycle: "active",
      versionStatus: "active",
    },
    {
      id: "s7orc-ver-r10",
      parameterSpecId: "s7orc-spec-r10",
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

const firstReleaseBundle = (): CatalogReleaseBundle => {
  const full = validCatalogReleaseBundle();
  const first = structuredClone(full.releases[0]!);
  return {
    schemaVersion: full.schemaVersion,
    targetReleaseId: first.manifest.release.id,
    releases: [first],
  };
};

const seedPopulatedCutover = async (
  client: pg.Client,
  graph: FrozenP0Graph,
): Promise<void> => {
  for (const spec of graph.specs) {
    await client.query(
      `
      insert into public.parameter_specs (
        id, organization_id, source_kind, specification_key,
        attribution_subject_id, definition_lifecycle, property_key
      ) values ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        spec.id,
        spec.organizationId,
        spec.sourceKind,
        spec.specificationKey,
        spec.attributionSubjectId,
        spec.definitionLifecycle,
        spec.propertyKey,
      ],
    );
  }
  for (const version of graph.specVersions) {
    await client.query(
      `
      insert into public.parameter_spec_versions (
        id, parameter_spec_id, version, display_name, description, value_shape,
        lifecycle, version_status
      ) values ($1, $2, $3, $4, $4, '{}', $5, $6)
      `,
      [
        version.id,
        version.parameterSpecId,
        version.version,
        version.id,
        version.lifecycle,
        version.versionStatus,
      ],
    );
  }
  for (const identity of graph.identities) {
    await client.query(
      `
      insert into parameter_catalog.legacy_identities (
        id, source_system, source_kind, owner_scope_kind, owner_scope_id, source_id
      ) values ($1, $2, $3, $4, $5, $6)
      `,
      [
        identity.id,
        identity.sourceSystem,
        identity.sourceKind,
        identity.ownerScopeKind,
        identity.ownerScopeId,
        identity.sourceId,
      ],
    );
  }
};

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
    });
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.error.code).toBe("PCAT-ORC-NOT-POPULATED");
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
