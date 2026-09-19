import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
import {
  firstReleaseBundle,
  populatedCutoverGraph,
  seedPopulatedCutover,
} from "../../testing/parameterCatalog/cutoverPopulatedFixture";
import { createLocalArchiveObjectStore } from "./archive";
import type { FrozenP0Graph } from "./classifier";
import { executeCutover, inspectCutover, planCutover, recoverCutover } from "./orchestrator";
import { fixtureObservedQuiescence } from "./quiescence";
import { assertRecordedAction, captureInventoryDump, dumpsEqual } from "./recovery";

const CATALOG_TEST_TIMEOUT_MS = 60_000;
const CATALOG_HOOK_TIMEOUT_MS = 120_000;

describe("S7-ORC recovery containment", { timeout: CATALOG_TEST_TIMEOUT_MS }, () => {
  let database: ParameterCatalogDatabase;
  let pool: pg.Pool;
  let client: pg.Client;
  let objectRoot: string;
  let encryptionKey: Buffer;

  beforeAll(async () => {
    database = await createDisposableParameterCatalogDatabase("s7orcr");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    client = new pg.Client({ connectionString: database.url });
    await client.connect();
    objectRoot = await mkdtemp(path.join(os.tmpdir(), "s7orc-recover-"));
    encryptionKey = randomBytes(32);
  }, CATALOG_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await client?.end().catch(() => undefined);
    await pool?.end().catch(() => undefined);
    await database?.close();
    if (objectRoot) await rm(objectRoot, { recursive: true, force: true });
  }, CATALOG_HOOK_TIMEOUT_MS);

  it("T3 refuses ad-hoc SQL recovery", () => {
    const adHoc = assertRecordedAction("ad-hoc-sql");
    expect(adHoc.ok).toBe(false);
    if (!adHoc.ok) expect(adHoc.error.code).toBe("PCAT-ORC-AD-HOC");
    const unknown = assertRecordedAction("drop-table");
    expect(unknown.ok).toBe(false);
  });

  it("T4 rollback dump equals the pre-execute P3 dump", async () => {
    const graph = populatedCutoverGraph();
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

    const preExecuteDump = await captureInventoryDump(client);
    const planned = await planCutover({
      graph,
      targetArtifactSha: "c".repeat(40),
      targetCatalogReleaseDigest: compiled.value.release.digest,
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
      archiveEncryptionKey: encryptionKey,
      operatorAuditRef: "audit-s7orc-recover",
      quiescence: fixtureObservedQuiescence(),
    });
    expect(executed.ok).toBe(true);
    if (!executed.ok) return;
    expect(executed.value.state).toBe("completed");
    expect(executed.value.runBoundToken).toBeTruthy();

    const residue = await client.query<{ mappings: string; archives: string }>(
      `
      select
        (select count(*)::text from parameter_catalog.legacy_mapping_versions where cutover_run_id = $1) as mappings,
        (select count(*)::text from parameter_catalog.parameter_catalog_archives where cutover_run_id = $1) as archives
      `,
      [executed.value.runId],
    );
    expect(Number(residue.rows[0]?.mappings)).toBeGreaterThan(0);
    expect(Number(residue.rows[0]?.archives)).toBeGreaterThan(0);

    const midDump = await captureInventoryDump(client);
    expect(dumpsEqual(midDump, preExecuteDump)).toBe(false);

    const recovered = await recoverCutover({
      pool,
      runId: executed.value.runId,
      recordedAction: "whole-state-restore",
      runBoundToken: executed.value.runBoundToken!,
      archiveObjectStore: createLocalArchiveObjectStore(objectRoot),
    });
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) return;
    expect(recovered.value.state).toBe("recovery-required");
    expect(recovered.value.currentPhase).toBe("P3");

    const restoredDump = await captureInventoryDump(client);
    expect(dumpsEqual(restoredDump, preExecuteDump)).toBe(true);
    expect(dumpsEqual(restoredDump, executed.value.recoveryPointDump ?? "")).toBe(true);

    const inspected = await inspectCutover({ pool, runId: executed.value.runId });
    expect(inspected.ok).toBe(true);
    if (!inspected.ok) return;
    expect(inspected.value.state).toBe("recovery-required");
    expect(inspected.value.currentPhase).toBe("P3");

    const resume = await executeCutover({
      pool,
      plan: planned.value,
      graph,
      catalogReleaseSource: jsonCatalogReleaseSource(bundle),
      archiveObjectStore: createLocalArchiveObjectStore(objectRoot),
      archiveEncryptionKey: encryptionKey,
      operatorAuditRef: "audit-s7orc-recover",
      quiescence: fixtureObservedQuiescence(),
    });
    expect(resume.ok).toBe(false);
    if (resume.ok) return;
    expect(resume.error.code).toBe("PCAT-ORC-RESUME-INVALIDATED");
  });
});
