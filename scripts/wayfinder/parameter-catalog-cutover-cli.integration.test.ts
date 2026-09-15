import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compileCatalogRelease } from "../../server/modules/catalog-kernel/compiler/index";
import { jsonCatalogReleaseSource } from "../../server/modules/catalog-kernel/interface";
import { installPublishedRelease } from "../../server/modules/catalog-kernel/install/installer";
import { PRE_ACTIVATION_PHASES } from "../../server/modules/catalog-cutover/interface";
import {
  createDisposableParameterCatalogDatabase,
  type ParameterCatalogDatabase,
} from "../../server/testing/parameterCatalog";
import {
  firstReleaseBundle,
  populatedCutoverGraph,
  seedPopulatedCutover,
} from "../../server/testing/parameterCatalog/cutoverPopulatedFixture";
import { runExecuteCutoverCli } from "./execute-parameter-catalog-cutover";
import { runInspectCutoverCli } from "./inspect-parameter-catalog-cutover";
import { runPlanCutoverCli } from "./plan-parameter-catalog-cutover";
import { runRecoverCutoverCli } from "./recover-parameter-catalog-cutover";

/**
 * Exercises the real operator entry points (the functions the four
 * `scripts/wayfinder/*-parameter-catalog-cutover.ts` binaries call) against a real
 * PostgreSQL catalog, as one interrupted-then-resumed run:
 *
 *   plan -> execute (crash before P7) -> inspect -> execute (resume) -> inspect -> recover
 *
 * The module-level orchestrator tests cover the same state machine through direct
 * calls; this test is the operator path itself, including the CLI argument
 * parsing, file loading, and archive-root/encryption-key wiring.
 */
const CATALOG_TEST_TIMEOUT_MS = 120_000;
const CATALOG_HOOK_TIMEOUT_MS = 120_000;

describe("S7-ORC operator CLI path", { timeout: CATALOG_TEST_TIMEOUT_MS }, () => {
  let database: ParameterCatalogDatabase;
  let pool: pg.Pool;
  let client: pg.Client;
  let workspace: string;
  let graphPath: string;
  let releaseJsonPath: string;
  let archiveRoot: string;
  let targetCatalogReleaseDigest: string;

  beforeAll(async () => {
    database = await createDisposableParameterCatalogDatabase("s7cli");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    client = new pg.Client({ connectionString: database.url });
    await client.connect();
    workspace = await mkdtemp(path.join(os.tmpdir(), "s7orc-cli-"));
    archiveRoot = path.join(workspace, "archive");

    const graph = populatedCutoverGraph();
    await seedPopulatedCutover(client, graph);
    const bundle = firstReleaseBundle();
    const compiled = compileCatalogRelease(bundle);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error(compiled.error.kind);
    targetCatalogReleaseDigest = compiled.value.release.digest;

    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(bundle),
      expectedTargetDigest: compiled.value.release.digest,
    });
    expect(installed.ok).toBe(true);

    graphPath = path.join(workspace, "p0-graph.json");
    releaseJsonPath = path.join(workspace, "release.json");
    await writeFile(graphPath, JSON.stringify(graph), "utf8");
    await writeFile(releaseJsonPath, JSON.stringify(bundle), "utf8");
  }, CATALOG_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await client?.end().catch(() => undefined);
    await pool?.end().catch(() => undefined);
    await database?.close();
    if (workspace) await rm(workspace, { recursive: true, force: true });
  }, CATALOG_HOOK_TIMEOUT_MS);

  const common = () => [
    "--database-url",
    database.url,
    "--graph",
    graphPath,
    "--release-json",
    releaseJsonPath,
    "--target-artifact-sha",
    "d".repeat(40),
    "--target-catalog-release-digest",
    targetCatalogReleaseDigest,
  ];

  it("plans, survives an interrupted execute, resumes, and refuses an ad-hoc recovery action", async () => {
    const planned = await runPlanCutoverCli(common());
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const planDigest = planned.value.planDigest;
    expect(planned.value.phases).toEqual([...PRE_ACTIVATION_PHASES]);

    // Interruption: the operator process dies before P7.
    const crashed = await runExecuteCutoverCli([
      ...common(),
      "--archive-root",
      archiveRoot,
      "--archive-key-hex",
      "22".repeat(32),
      "--operator-audit-ref",
      "audit-849-cli",
      "--fail-before-phase",
      "P7",
    ]);
    expect(crashed.ok).toBe(false);
    if (crashed.ok) return;
    expect(crashed.error.code).toBe("PCAT-ORC-CRASH");

    const midInspect = await runInspectCutoverCli(["--database-url", database.url, "--plan-digest", planDigest]);
    expect(midInspect.ok).toBe(true);
    if (!midInspect.ok) return;
    expect(midInspect.value.checkpoints.map((row) => row.phase)).toEqual([
      "P0",
      "P1",
      "P2",
      "P3",
      "P4",
      "P5",
      "P6",
    ]);

    // Resume: the same plan, executed again, continues instead of starting over.
    const resumed = await runExecuteCutoverCli([
      ...common(),
      "--archive-root",
      archiveRoot,
      "--archive-key-hex",
      "22".repeat(32),
      "--operator-audit-ref",
      "audit-849-cli",
    ]);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.value.resumed).toBe(true);
    expect(resumed.value.state).toBe("completed");
    expect(resumed.value.liveRun).toBe(false);
    expect(resumed.value.checkpoints.map((row) => row.phase)).toEqual([...PRE_ACTIVATION_PHASES]);

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

    const finalInspect = await runInspectCutoverCli(["--database-url", database.url, "--run-id", resumed.value.runId]);
    expect(finalInspect.ok).toBe(true);
    if (!finalInspect.ok) return;
    expect(finalInspect.value.planDigest).toBe(planDigest);

    // Recovery is gated on a recorded action and the run-bound token.
    const adHoc = await runRecoverCutoverCli([
      "--database-url",
      database.url,
      "--run-id",
      resumed.value.runId,
      "--action",
      "drop-everything",
      "--run-bound-token",
      resumed.value.runBoundToken ?? "missing",
    ]);
    expect(adHoc.ok).toBe(false);

    const wrongToken = await runRecoverCutoverCli([
      "--database-url",
      database.url,
      "--run-id",
      resumed.value.runId,
      "--action",
      "whole-state-restore",
      "--run-bound-token",
      "not-the-token",
    ]);
    expect(wrongToken.ok).toBe(false);
    if (!wrongToken.ok) {
      expect(wrongToken.error.code).toBe("PCAT-ORC-INVALID-TOKEN");
    }

    // Whole-state restore with the run-bound token rolls the catalog back to the
    // P3 recovery point (the recover path itself refuses on any dump drift).
    expect(resumed.value.runBoundToken).toBeTruthy();
    const restored = await runRecoverCutoverCli([
      "--database-url",
      database.url,
      "--run-id",
      resumed.value.runId,
      "--action",
      "whole-state-restore",
      "--run-bound-token",
      resumed.value.runBoundToken!,
    ]);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.value.state).toBe("recovery-required");

    // The restore rolls back the live mapping pointers for this run. The mapping
    // *versions* are append-only evidence and are deliberately retained, which is
    // why the inventory dump (which counts legacy_mapping_heads) returns to the P3
    // baseline while the version rows stay.
    const afterRestore = await client.query<{ heads: string; versions: string }>(
      `
      select
        (select count(*)::text
           from parameter_catalog.legacy_mapping_heads h
           join parameter_catalog.legacy_mapping_versions v on v.id = h.current_version_id
          where v.cutover_run_id = $1) as heads,
        (select count(*)::text
           from parameter_catalog.legacy_mapping_versions
          where cutover_run_id = $1) as versions
      `,
      [resumed.value.runId],
    );
    expect(Number(afterRestore.rows[0]?.heads)).toBe(0);
    expect(Number(afterRestore.rows[0]?.versions)).toBeGreaterThan(0);
  });
});
