import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createReleaseVerificationService } from "../../core/service";
import { digestOf } from "../../core/digest";
import type { PrepareVerificationInput } from "../../core/types";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase,
} from "../../../../testing/testDatabase";
import {
  createPostgresGateAdapters,
  POSTGRES_GATE_IDS,
  loadPackagedMigrationInventory,
} from "./index";
import { DEFAULT_MIGRATIONS_DIR } from "./inventory";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "S10-VMP postgres gate tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
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
    "S10-VMP postgres gate tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

const emptySourceSnapshot = digestOf({
  archives: 0,
  identities: 0,
  ledger: 0,
  mappings: 0,
  registrations: 0,
});

const validPrepare = (
  inventoryDigest: string,
  schemaVersion: string,
  overrides: Partial<PrepareVerificationInput> = {},
): PrepareVerificationInput => ({
  subject: {
    targetId: "target-s10-vmp",
    deploymentClass: "self-hosted",
    environmentId: "env-isolated",
  },
  purpose: "pre-activation",
  mode: "fresh",
  lineage: {
    phaseSnapshot: "P11",
    predecessorReportDigests: [],
    p12State: "not-started",
    p13State: "not-started",
    writerRetirementFingerprint: null,
    runtimePinGeneration: null,
    pointerRollbackStatus: "open",
    trafficIsolationState: "isolated",
  },
  pins: {
    artifact: {
      gitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      releaseTag: "v-s10-vmp",
      packageManifestDigest: "sha256:pkg",
      apiImageDigest: "sha256:api",
      workerImageDigest: "sha256:worker",
      webImageDigest: "sha256:web",
    },
    catalog: {
      releaseId: "",
      releaseDigest: "",
      compiledModelDigest: "",
      materializationFingerprint: "",
    },
    database: {
      targetIdentity: "pg-s10-vmp",
      schemaVersion,
      migrationInventoryDigest: inventoryDigest,
    },
    cutover: {
      planDigest: "sha256:cutover",
      contractVersion: "v1",
      sourceSnapshotFingerprint: emptySourceSnapshot,
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
      deploymentId: "deploy-1",
      hostFingerprint: "sha256:host",
    },
    verification: {
      contractVersion: "s10-vmp",
      verifierRole: "catalog_verifier",
    },
  },
  evidenceRequirements: {
    recoveryPointDigest: "sha256:rp",
    mappingEpoch: "epoch-1",
    cutoverPlanDigest: "sha256:cutover",
    acceptanceContractDigest: "sha256:accept",
  },
  ...overrides,
});

const expectOk = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) {
    throw new Error("expected ok");
  }
  return result.value;
};

const postgresResults = (results: readonly { gateId: string }[]) =>
  results.filter((result) =>
    (POSTGRES_GATE_IDS as readonly string[]).includes(result.gateId),
  );

describe("canonical PostgreSQL verification gates", () => {
  let db: InMemoryTestDatabase;
  let inventoryDigest: string;
  let schemaVersion: string;

  beforeAll(async () => {
    db = await createInMemoryTestDatabase();
    const inventory = await loadPackagedMigrationInventory(DEFAULT_MIGRATIONS_DIR);
    inventoryDigest = inventory.digest;
    schemaVersion = inventory.schemaVersionPrefix;
  }, 60_000);

  afterAll(async () => {
    await db.rollback();
  });

  it("runs every V/M/P gate through runVerification without skip or waiver", async () => {
    const service = createReleaseVerificationService({
      db,
      adapters: createPostgresGateAdapters({ db }),
    });
    const plan = expectOk(
      await service.prepareVerification(
        validPrepare(inventoryDigest, schemaVersion, {
          subject: {
            targetId: "target-s10-vmp-run",
            deploymentClass: "self-hosted",
            environmentId: "env-isolated",
          },
        }),
      ),
    );
    const attempt = expectOk(await service.runVerification(plan.digest));
    const vmp = postgresResults(attempt.results);
    expect(vmp).toHaveLength(POSTGRES_GATE_IDS.length);
    expect(vmp.some((result) => (result.status as string) === "skipped")).toBe(false);
    expect(vmp.some((result) => (result.status as string) === "waived")).toBe(false);
    expect(vmp.some((result) => (result.status as string) === "skipped-as-waived")).toBe(false);
    for (const result of vmp) {
      expect(["passed", "failed"]).toContain(result.status);
      expect(result.evidenceDigest).toBeTruthy();
    }
  });

  it("passes fresh exact-zero V/M/P gates against the migrated database", async () => {
    const service = createReleaseVerificationService({
      db,
      adapters: createPostgresGateAdapters({ db }),
    });
    const plan = expectOk(
      await service.prepareVerification(
        validPrepare(inventoryDigest, schemaVersion, {
          subject: {
            targetId: "target-s10-vmp-fresh",
            deploymentClass: "self-hosted",
            environmentId: "env-isolated",
          },
        }),
      ),
    );
    const attempt = expectOk(await service.runVerification(plan.digest));
    const byId = new Map(attempt.results.map((result) => [result.gateId, result]));
    for (const gateId of POSTGRES_GATE_IDS) {
      const result = byId.get(gateId);
      expect(result?.status, gateId).toBe("passed");
      expect(result?.failureCode, gateId).toBeNull();
    }
  });

  it("drives populated-mode V17 against the exact empty source snapshot fingerprint", async () => {
    const service = createReleaseVerificationService({
      db,
      adapters: createPostgresGateAdapters({ db }),
    });
    const matching = expectOk(
      await service.prepareVerification(
        validPrepare(inventoryDigest, schemaVersion, {
          subject: {
            targetId: "target-s10-vmp-populated-match",
            deploymentClass: "self-hosted",
            environmentId: "env-isolated",
          },
          mode: "populated",
          pins: {
            ...validPrepare(inventoryDigest, schemaVersion).pins,
            database: {
              targetIdentity: "pg-s10-vmp",
              schemaVersion,
              migrationInventoryDigest: inventoryDigest,
            },
            cutover: {
              planDigest: "sha256:cutover",
              contractVersion: "v1",
              sourceSnapshotFingerprint: emptySourceSnapshot,
            },
          },
        }),
      ),
    );
    const matchingAttempt = expectOk(await service.runVerification(matching.digest));
    const matchingV17 = matchingAttempt.results.find((result) => result.gateId === "PCAT-DB-V17");
    expect(matchingV17?.status).toBe("passed");
    expect(matchingV17?.failureCode).toBeNull();

    const driftedBase = validPrepare(inventoryDigest, schemaVersion);
    const drifted = expectOk(
      await service.prepareVerification(
        validPrepare(inventoryDigest, schemaVersion, {
          subject: {
            targetId: "target-s10-vmp-populated-drift",
            deploymentClass: "self-hosted",
            environmentId: "env-isolated",
          },
          mode: "populated",
          pins: {
            ...driftedBase.pins,
            database: {
              targetIdentity: "pg-s10-vmp",
              schemaVersion,
              migrationInventoryDigest: inventoryDigest,
            },
            cutover: {
              planDigest: "sha256:cutover",
              contractVersion: "v1",
              sourceSnapshotFingerprint: "sha256:not-the-source-snapshot",
            },
          },
        }),
      ),
    );
    const driftedAttempt = expectOk(await service.runVerification(drifted.digest));
    const driftedV17 = driftedAttempt.results.find((result) => result.gateId === "PCAT-DB-V17");
    expect(driftedV17?.status).toBe("failed");
    expect(driftedV17?.failureCode).toBe("PCAT-VRF-V17-MODE-RESULT-MISMATCH");
  });

  it("records exact zeros for mapping/Archive/ledger gates instead of skipping when S7-ORC is absent", async () => {
    const service = createReleaseVerificationService({
      db,
      adapters: createPostgresGateAdapters({ db }),
    });
    const plan = expectOk(
      await service.prepareVerification(
        validPrepare(inventoryDigest, schemaVersion, {
          subject: {
            targetId: "target-s10-vmp-cutover-absent",
            deploymentClass: "self-hosted",
            environmentId: "env-isolated",
          },
        }),
      ),
    );
    const attempt = expectOk(await service.runVerification(plan.digest));
    const byId = new Map(attempt.results.map((result) => [result.gateId, result]));
    for (const gateId of ["PCAT-DB-V08", "PCAT-DB-V09", "PCAT-DB-V10", "PCAT-DB-V11", "PCAT-DB-V14"]) {
      expect(byId.get(gateId)?.status, gateId).toBe("passed");
      expect(byId.get(gateId)?.failureCode, gateId).toBeNull();
    }
  });

  it("fails M01 when the pinned inventory digest drifts", async () => {
    const service = createReleaseVerificationService({
      db,
      adapters: createPostgresGateAdapters({ db }),
    });
    const plan = expectOk(
      await service.prepareVerification(
        validPrepare("sha256:not-the-packaged-inventory", schemaVersion, {
          subject: {
            targetId: "target-s10-vmp-m01",
            deploymentClass: "self-hosted",
            environmentId: "env-isolated",
          },
        }),
      ),
    );
    const attempt = expectOk(await service.runVerification(plan.digest));
    const m01 = attempt.results.find((result) => result.gateId === "PCAT-DB-M01");
    expect(m01?.status).toBe("failed");
    expect(m01?.failureCode).toBe("PCAT-MIG-PACKAGE-INVENTORY-DRIFT");
  });

  it("fails V12 when catalog pins do not match the current materialization", async () => {
    const service = createReleaseVerificationService({
      db,
      adapters: createPostgresGateAdapters({ db }),
    });
    const base = validPrepare(inventoryDigest, schemaVersion);
    const plan = expectOk(
      await service.prepareVerification({
        ...base,
        subject: {
          targetId: "target-s10-vmp-v12",
          deploymentClass: "self-hosted",
          environmentId: "env-isolated",
        },
        pins: {
          ...base.pins,
          catalog: {
            releaseId: "crel-missing",
            releaseDigest: "sha256:missing",
            compiledModelDigest: "sha256:missing-model",
            materializationFingerprint: "sha256:missing-fp",
          },
        },
      }),
    );
    const attempt = expectOk(await service.runVerification(plan.digest));
    const v12 = attempt.results.find((result) => result.gateId === "PCAT-DB-V12");
    expect(v12?.status).toBe("failed");
    expect(v12?.failureCode).toBe("PCAT-VRF-V12-CATALOG-MATERIALIZATION-DRIFT");
  });
});
