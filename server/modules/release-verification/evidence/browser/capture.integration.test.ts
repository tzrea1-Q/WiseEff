import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createDisposableParameterCatalogDatabase,
  type ParameterCatalogDatabase,
} from "../../../../testing/parameterCatalog";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
} from "../../../../testing/testDatabase";
import { seedCompiledCatalogProjection } from "../../../catalog-kernel/runtime/currentSnapshot";
import { digestOf } from "../../core/digest";
import { browserVerificationGateIds } from "../../core/gateRegistry";
import type { VerificationPlan } from "../../core/types";
import { captureCatalogBrowserEvidence, evaluateCatalogBrowserGate } from "./capture";
import { databaseIdentityDigest, readDatabaseIdentity, readLiveCatalogPin } from "./identity";
import {
  CATALOG_BROWSER_REDACTION_POLICY,
  CATALOG_BROWSER_REDACTION_VERSION,
  CATALOG_BROWSER_VIEWPORT_IDS,
  type CatalogBrowserViewportId,
} from "./probes";
import type { CatalogBrowserCandidateDriver, CatalogBrowserViewportObservation } from "./types";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "S10-UI evidence tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
  );
}

const pgVectorInstalled = await (async () => {
  const probe = await createInMemoryTestDatabase();
  try {
    const result = await probe.query<{ installed: boolean }>(
      `select exists (
         select 1 from pg_catalog.pg_extension where extname = 'vector'
       ) as installed`,
    );
    return result.rows[0]?.installed === true;
  } finally {
    await probe.rollback();
  }
})();

if (!pgVectorInstalled) {
  throw new Error(
    "S10-UI evidence tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

const ORG_ID = "org-s10-ui";
const USER_ID = "user-org-admin";

const completeObservation = (
  gateId: string,
  viewport: CatalogBrowserViewportId,
  catalogReleaseId: string,
): CatalogBrowserViewportObservation => ({
  snapshotDigest: `sha256:snap:${gateId}:${viewport}`,
  screenshotDigest: `sha256:shot:${gateId}:${viewport}`,
  console: { errors: [], pageErrors: [] },
  network: {
    exchanges: [
      {
        method: "GET",
        path: "/api/v2/catalog",
        status: 200,
        requestId: `s10ui_${gateId}_${viewport}`,
        catalogReleaseId,
        runtimeKind: "candidate",
        summary: "catalog ready",
      },
    ],
  },
  interactions: [{ name: "inspect", outcome: "recorded" }],
  redaction: {
    status: "passed",
    policy: CATALOG_BROWSER_REDACTION_POLICY,
    version: CATALOG_BROWSER_REDACTION_VERSION,
  },
  browser: { name: "chromium", version: "test" },
  catalogPageMounted: false,
  parity:
    gateId === "PCAT-UI-13"
      ? {
          mockHasExtraPower: false,
          apiStates: ["ready"],
          mockStates: ["ready"],
        }
      : undefined,
});

describe("S10-UI browser evidence against real PostgreSQL", () => {
  let catalogDb: ParameterCatalogDatabase;
  let pool: pg.Pool;
  let plan: VerificationPlan;
  let bundle: Awaited<ReturnType<typeof captureCatalogBrowserEvidence>> extends infer R
    ? R extends { ok: true; value: infer V }
      ? V
      : never
    : never;

  beforeAll(async () => {
    catalogDb = await createDisposableParameterCatalogDatabase("s10ui");
    const seeded = await seedCompiledCatalogProjection(catalogDb.url);
    pool = new pg.Pool({ connectionString: catalogDb.url, max: 4 });
    await pool.query(`insert into public.organizations (id, name) values ($1, 'S10 UI')`, [ORG_ID]);
    const identity = await readDatabaseIdentity((text, values) => pool.query(text, values));
    const liveCatalog = await readLiveCatalogPin((text, values) => pool.query(text, values));
    if (!liveCatalog) {
      throw new Error("seeded catalog pointer must be installed");
    }
    expect(liveCatalog.releaseId).toBe(seeded.current.id);
    const capturePins = {
      artifact: {
        gitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        releaseTag: "v-s10-ui",
        packageManifestDigest: "sha256:pkg",
        apiImageDigest: "sha256:api",
        workerImageDigest: "sha256:worker",
        webImageDigest: "sha256:web",
      },
      catalog: {
        releaseId: liveCatalog.releaseId,
        releaseDigest: liveCatalog.releaseDigest,
        compiledModelDigest: "sha256:compiled",
        materializationFingerprint: "sha256:material",
      },
      database: {
        targetIdentity: databaseIdentityDigest(identity),
        schemaVersion: catalogDb.schemaFingerprint ?? "0139",
        migrationInventoryDigest: "sha256:migrations",
      },
      cutover: {
        planDigest: "sha256:cutover",
        contractVersion: "v1",
        sourceSnapshotFingerprint: "sha256:source",
      },
      mappingArchive: {
        mappingEpoch: "epoch-1",
        mappingHeadDigest: "sha256:map",
        archiveManifestDigest: "sha256:archive",
      },
      recovery: {
        recoveryPointId: "rp-1",
        recoveryPointDigest: "sha256:rp",
      },
      acceptance: {
        openApiDigest: "sha256:openapi",
        browserBundleSha: "sha256:browser",
      },
      target: {
        deploymentId: "deploy-s10-ui",
        hostFingerprint: "sha256:host",
      },
      verification: {
        contractVersion: "s10-ui",
        verifierRole: "catalog_verifier",
      },
    };
    plan = {
      id: "vplan_s10_ui" as VerificationPlan["id"],
      digest: "sha256:plan" as VerificationPlan["digest"],
      canonicalBytes: "{}",
      purpose: "isolated-candidate-acceptance",
      mode: "populated",
      subject: {
        targetId: "target-s10-ui",
        deploymentClass: "self-hosted",
        environmentId: "env-isolated",
      },
      lineage: {
        phaseSnapshot: "P14a",
        predecessorReportDigests: [],
        p12State: "retired",
        p13State: "retired",
        writerRetirementFingerprint: "sha256:writers",
        runtimePinGeneration: "pin-1",
        pointerRollbackStatus: "closed",
        trafficIsolationState: "isolated",
      },
      pins: capturePins,
      evidenceRequirements: {
        recoveryPointDigest: "sha256:rp",
        mappingEpoch: "epoch-1",
        cutoverPlanDigest: "sha256:cutover",
        acceptanceContractDigest: "sha256:accept",
      },
      registryDigest: "sha256:registry" as VerificationPlan["registryDigest"],
      gateSelectionSource: "registry",
      applicabilityProfile: [],
      createdAt: new Date().toISOString(),
    };

    const driver: CatalogBrowserCandidateDriver = {
      kind: "candidate",
      async collect({ gateId, viewport }) {
        return completeObservation(gateId, viewport, liveCatalog.releaseId);
      },
    };

    const captured = await captureCatalogBrowserEvidence({
      plan,
      runtime: { kind: "candidate", candidateId: "sha256:web" },
      driver,
      database: (text, values) => pool.query(text, values),
      principal: {
        principalId: USER_ID,
        organizationId: ORG_ID,
        actorKind: "org-admin",
      },
    });
    expect(captured.ok, JSON.stringify(captured)).toBe(true);
    if (!captured.ok) {
      throw new Error("capture must succeed for S10-UI PostgreSQL pin evidence");
    }
    bundle = captured.value;
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await catalogDb?.close();
  });

  it("binds PCAT-UI-01..15 to one candidate PostgreSQL identity and three viewports", () => {
    expect(bundle.records.map((record) => record.gateId)).toEqual([...browserVerificationGateIds]);
    expect(bundle.evidenceRefs).toHaveLength(15);
    const pinDigest = digestOf(plan.pins);
    for (const record of bundle.records) {
      expect(record.viewports.map((viewport) => viewport.viewport)).toEqual([...CATALOG_BROWSER_VIEWPORT_IDS]);
      expect(digestOf(record.pins)).toBe(pinDigest);
      expect(record.databaseIdentity).toBe(bundle.databaseIdentity);
      expect(record.principalId).toBe(USER_ID);
      expect(evaluateCatalogBrowserGate(record).passed, record.gateId).toBe(true);
    }
  });

  it("stores digest-verified evidence refs for every UI gate", () => {
    for (const ref of bundle.evidenceRefs) {
      expect(ref.digest.startsWith("sha256:")).toBe(true);
      expect(ref.producer).toBe("s10-ui");
      expect(digestOf(ref.pins)).toBe(digestOf(plan.pins));
    }
  });

  it("refuses a stale pin against the live catalog pointer", async () => {
    const stale = await captureCatalogBrowserEvidence({
      plan: {
        ...plan,
        pins: {
          ...plan.pins,
          catalog: { ...plan.pins.catalog, releaseId: "crel_stale_s10_ui" },
        },
      },
      runtime: { kind: "candidate", candidateId: "sha256:web" },
      driver: {
        kind: "candidate",
        async collect({ gateId, viewport }) {
          return completeObservation(gateId, viewport, plan.pins.catalog.releaseId);
        },
      },
      database: (text, values) => pool.query(text, values),
      principal: {
        principalId: USER_ID,
        organizationId: ORG_ID,
        actorKind: "org-admin",
      },
    });
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.error.kind).toBe("stale-pins");
  });
});
