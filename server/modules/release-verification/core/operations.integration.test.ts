import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../../../shared/database/client";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
  type InMemoryTestDatabase,
} from "../../../testing/testDatabase";
import { digestOf } from "./digest";
import { RELEASE_VERIFICATION_GATES, MISSING_APPLICABLE_GATE_FAILURE } from "./gateRegistry";
import { prepareLockMaterial, verificationLockKeys } from "./lock";
import { createReleaseVerificationService } from "./service";
import type {
  GateAdapter,
  PrepareVerificationInput,
  TypedEvidenceRef,
  VerificationPlan,
} from "./types";

const databaseAvailable = await isTestDatabaseAvailable();

if (!databaseAvailable) {
  throw new Error(
    "S10-PER operation tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
  );
}

const pgVectorInstalled = await (async () => {
  const probe = await createInMemoryTestDatabase();
  try {
    const result = await probe.query<{ installed: boolean }>(
      `select exists (
         select 1
         from pg_catalog.pg_extension
         where extname = 'vector'
       ) as installed`,
    );
    return result.rows[0]?.installed === true;
  } finally {
    await probe.rollback();
  }
})();

if (!pgVectorInstalled) {
  throw new Error(
    "S10-PER operation tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

const validPrepare = (
  overrides: Partial<PrepareVerificationInput> = {},
): PrepareVerificationInput => ({
  subject: {
    targetId: "target-lab-1",
    deploymentClass: "self-hosted",
    environmentId: "env-isolated",
  },
  purpose: "pre-activation",
  mode: "populated",
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
      releaseTag: "v-s10-per",
      packageManifestDigest: "sha256:pkg",
      apiImageDigest: "sha256:api",
      workerImageDigest: "sha256:worker",
      webImageDigest: "sha256:web",
    },
    catalog: {
      releaseId: "crel-s10",
      releaseDigest: "sha256:catalog",
      compiledModelDigest: "sha256:compiled",
      materializationFingerprint: "sha256:material",
    },
    database: {
      targetIdentity: "pg-s10",
      schemaVersion: "0139",
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
      deploymentId: "deploy-1",
      hostFingerprint: "sha256:host",
    },
    verification: {
      contractVersion: "s10-per",
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

const evidenceDigestFor = (gateId: string): string =>
  digestOf({ gateId, producer: "test-adapter" });

const planBoundEvidence = (plan: VerificationPlan): TypedEvidenceRef[] =>
  plan.applicabilityProfile
    .filter((entry) => entry.applicability.status === "required-now")
    .map((entry) => ({
      gateId: entry.gateId,
      digest: evidenceDigestFor(entry.gateId),
      producer: "test-adapter",
      purpose: plan.purpose,
      subject: plan.subject,
      phaseSnapshot: plan.lineage.phaseSnapshot,
      pins: plan.pins,
    }));

const passingAdapters = (): Map<string, GateAdapter> => {
  const adapters = new Map<string, GateAdapter>();
  for (const gate of RELEASE_VERIFICATION_GATES) {
    adapters.set(gate.id, async ({ gateId }) => ({
      gateId,
      status: "passed",
      failureCode: null,
      evidenceDigest: evidenceDigestFor(gateId),
      successorPurpose: null,
      notApplicableProof: null,
    }));
  }
  return adapters;
};

const databaseFromClient = (client: pg.Client) =>
  createDatabase({
    query: async (text, values = []) => {
      const result = await client.query(text, values);
      return { rows: result.rows, rowCount: result.rowCount };
    },
  });

const expectOk = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) {
    throw new Error("expected ok");
  }
  return result.value;
};

describe("Release Verification five operations", () => {
  let db: InMemoryTestDatabase;

  beforeAll(async () => {
    db = await createInMemoryTestDatabase();
  });

  afterAll(async () => {
    await db.rollback();
  });

  it("pins purpose and lineage from the registry without a caller gate list", async () => {
    const service = createReleaseVerificationService({ db });
    const plan = expectOk(await service.prepareVerification(validPrepare()));
    expect(plan.purpose).toBe("pre-activation");
    expect(plan.lineage.phaseSnapshot).toBe("P11");
    expect(plan.gateSelectionSource).toBe("registry");
    expect(plan).not.toHaveProperty("gates");
    expect(plan.applicabilityProfile.some((entry) => entry.gateId === "PCAT-DB-V01")).toBe(true);
    expect(
      plan.applicabilityProfile.find((entry) => entry.gateId === "PCAT-API-01")?.applicability,
    ).toEqual({
      status: "not-yet-executable",
      successorPurpose: "isolated-candidate-acceptance",
    });
    const stored = await db.query<{ count: string }>(
      "select count(*)::text as count from parameter_catalog.verification_plans where digest = $1",
      [plan.digest],
    );
    expect(stored.rows[0]?.count).toBe("1");
  });

  it("refuses a caller-supplied waiver or gate list and stores no plan", async () => {
    const service = createReleaseVerificationService({ db });
    const before = await db.query<{ count: string }>(
      "select count(*)::text as count from parameter_catalog.verification_plans",
    );
    const waiver = await service.prepareVerification({
      ...validPrepare(),
      evidenceRequirements: {
        ...validPrepare().evidenceRequirements,
        waiver: true,
      } as PrepareVerificationInput["evidenceRequirements"],
    });
    const gates = await service.prepareVerification({
      ...validPrepare(),
      gates: ["PCAT-DB-V01"],
    } as PrepareVerificationInput);
    expect(waiver).toEqual({
      ok: false,
      error: {
        kind: "waiver-forbidden",
        detail: expect.stringContaining("waiver"),
      },
    });
    expect(gates).toEqual({
      ok: false,
      error: {
        kind: "caller-gate-selection-forbidden",
        detail: expect.stringContaining("gates"),
      },
    });
    const unknown = await service.prepareVerification(validPrepare({ purpose: "invented-purpose" }));
    expect(unknown.ok).toBe(false);
    if (unknown.ok) {
      throw new Error("expected unknown-purpose");
    }
    expect(unknown.error.kind).toBe("unknown-purpose");
    const after = await db.query<{ count: string }>(
      "select count(*)::text as count from parameter_catalog.verification_plans",
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });

  it("marks a missing applicable gate failed or not-yet-executable, never waived", async () => {
    const service = createReleaseVerificationService({ db });
    const plan = expectOk(
      await service.prepareVerification(
        validPrepare({
          subject: {
            targetId: "target-missing-gate",
            deploymentClass: "self-hosted",
            environmentId: "env-isolated",
          },
        }),
      ),
    );
    const attempt = expectOk(await service.runVerification(plan.digest));
    const v01 = attempt.results.find((result) => result.gateId === "PCAT-DB-V01");
    const api01 = attempt.results.find((result) => result.gateId === "PCAT-API-01");
    expect(v01?.status).toBe("failed");
    expect(v01?.failureCode).toBe(MISSING_APPLICABLE_GATE_FAILURE);
    expect(api01?.status).toBe("not-yet-executable");
    expect(attempt.results.some((result) => (result.status as string) === "waived")).toBe(false);
    expect(attempt.results.some((result) => (result.status as string) === "skipped")).toBe(false);
    expect(attempt.results).toHaveLength(plan.applicabilityProfile.length);
  });

  it("refuses to assemble a half-report from an incomplete attempt", async () => {
    const service = createReleaseVerificationService({ db });
    const plan = expectOk(
      await service.prepareVerification(
        validPrepare({
          subject: {
            targetId: "target-incomplete",
            deploymentClass: "self-hosted",
            environmentId: "env-isolated",
          },
        }),
      ),
    );
    const assembled = await service.assembleReport(plan.digest, []);
    expect(assembled).toEqual({
      ok: false,
      error: {
        kind: "incomplete-attempt",
        detail: "purpose profile is not fully recorded",
      },
    });
    const reports = await db.query<{ count: string }>(
      "select count(*)::text as count from parameter_catalog.verification_reports where plan_digest = $1",
      [plan.digest],
    );
    expect(reports.rows[0]?.count).toBe("0");
  });

  it("refuses empty or unpinned evidence for a passed required-now profile", async () => {
    const service = createReleaseVerificationService({ db, adapters: passingAdapters() });
    const plan = expectOk(
      await service.prepareVerification(
        validPrepare({
          subject: {
            targetId: "target-empty-evidence",
            deploymentClass: "self-hosted",
            environmentId: "env-isolated",
          },
        }),
      ),
    );
    expectOk(await service.runVerification(plan.digest));
    const empty = await service.assembleReport(plan.digest, []);
    expect(empty).toEqual({
      ok: false,
      error: {
        kind: "evidence-pin-mismatch",
        detail: "a passed report requires evidence digest for every required-now gate",
      },
    });
    const mismatched = await service.assembleReport(plan.digest, [
      {
        ...planBoundEvidence(plan)[0]!,
        purpose: "public-release",
      },
    ]);
    expect(mismatched).toEqual({
      ok: false,
      error: {
        kind: "evidence-pin-mismatch",
        detail: "evidence purpose, subject, phase snapshot, and pins must equal the plan",
      },
    });
    const reports = await db.query<{ count: string }>(
      "select count(*)::text as count from parameter_catalog.verification_reports where plan_digest = $1",
      [plan.digest],
    );
    expect(reports.rows[0]?.count).toBe("0");
  });

  async function passingReport(
    service: ReturnType<typeof createReleaseVerificationService>,
    input: PrepareVerificationInput,
  ): Promise<{ plan: VerificationPlan; reportDigest: string; canonicalBytes: string }> {
    const plan = expectOk(await service.prepareVerification(input));
    expectOk(await service.runVerification(plan.digest));
    const report = expectOk(await service.assembleReport(plan.digest, planBoundEvidence(plan)));
    expect(report.decision).toBe("passed");
    expect(report.aggregateDigest).toBe(report.digest);
    expect(report.phaseSnapshot).toBe(plan.lineage.phaseSnapshot);
    expect(report.applicabilityProfile).toHaveLength(plan.applicabilityProfile.length);
    expect(report.writerReachability.status).toBe("passed");
    return { plan, reportDigest: report.digest, canonicalBytes: report.canonicalBytes };
  }

  it("refuses approval by the wrong principal or purpose", async () => {
    const service = createReleaseVerificationService({ db, adapters: passingAdapters() });
    const { reportDigest, canonicalBytes } = await passingReport(
      service,
      validPrepare({
        subject: {
          targetId: "target-wrong-principal",
          deploymentClass: "self-hosted",
          environmentId: "env-isolated",
        },
      }),
    );
    const verifier = await service.approveReport(reportDigest, {
      principalKind: "verifier",
      principalId: "person-a",
      purpose: "pre-activation",
    });
    const wrongPurpose = await service.approveReport(reportDigest, {
      principalKind: "operator",
      principalId: "person-operator",
      purpose: "public-release",
    });
    expect(verifier).toEqual({
      ok: false,
      error: {
        kind: "verifier-signature-is-not-approval",
        detail: "verifier signatures cannot approve",
      },
    });
    expect(wrongPurpose).toEqual({
      ok: false,
      error: {
        kind: "wrong-purpose",
        detail: "approval purpose must match the report",
      },
    });
    expectOk(
      await service.approveReport(reportDigest, {
        principalKind: "operator",
        principalId: "person-shared",
        purpose: "pre-activation",
      }),
    );
    const reused = await service.approveReport(reportDigest, {
      principalKind: "platform-owner",
      principalId: "person-shared",
      purpose: "pre-activation",
    });
    expect(reused.ok).toBe(false);
    if (reused.ok) {
      throw new Error("expected distinct principals");
    }
    expect(reused.error.kind).toBe("distinct-principals-required");
    const bytes = await db.query<{ canonical_bytes: string }>(
      "select canonical_bytes from parameter_catalog.verification_reports where digest = $1",
      [reportDigest],
    );
    expect(bytes.rows[0]?.canonical_bytes).toBe(canonicalBytes);
  });

  it("conflicts on a second approve and leaves original report bytes unchanged", async () => {
    const service = createReleaseVerificationService({ db, adapters: passingAdapters() });
    const { reportDigest, canonicalBytes } = await passingReport(
      service,
      validPrepare({
        subject: {
          targetId: "target-second-approve",
          deploymentClass: "self-hosted",
          environmentId: "env-isolated",
        },
      }),
    );
    expectOk(
      await service.approveReport(reportDigest, {
        principalKind: "operator",
        principalId: "operator-1",
        purpose: "pre-activation",
      }),
    );
    const duplicate = await service.approveReport(reportDigest, {
      principalKind: "operator",
      principalId: "operator-2",
      purpose: "pre-activation",
    });
    expect(duplicate).toEqual({
      ok: false,
      error: {
        kind: "append-only-conflict",
        detail: "principal kind already approved this report",
      },
    });
    await expect(
      db.transaction(async (tx) => {
        await tx.query(
          "update parameter_catalog.verification_reports set canonical_bytes = $1 where digest = $2",
          ["tampered", reportDigest],
        );
      }),
    ).rejects.toMatchObject({ code: "55000" });
    const bytes = await db.query<{ canonical_bytes: string }>(
      "select canonical_bytes from parameter_catalog.verification_reports where digest = $1",
      [reportDigest],
    );
    expect(bytes.rows[0]?.canonical_bytes).toBe(canonicalBytes);
  });

  it("returns tagged absence for missing or unapproved reports, not a mutable stub", async () => {
    const service = createReleaseVerificationService({ db, adapters: passingAdapters() });
    const missing = await service.readReport("sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
    expect(missing).toEqual({ kind: "absent", reason: "missing" });

    const { reportDigest } = await passingReport(
      service,
      validPrepare({
        subject: {
          targetId: "target-unapproved",
          deploymentClass: "self-hosted",
          environmentId: "env-isolated",
        },
      }),
    );
    const unapproved = await service.readReport(reportDigest);
    expect(unapproved).toEqual({ kind: "absent", reason: "unapproved" });

    expectOk(
      await service.approveReport(reportDigest, {
        principalKind: "operator",
        principalId: "operator-read",
        purpose: "pre-activation",
      }),
    );
    expectOk(
      await service.approveReport(reportDigest, {
        principalKind: "platform-owner",
        principalId: "owner-read",
        purpose: "pre-activation",
      }),
    );
    const present = await service.readReport(reportDigest);
    expect(present.kind).toBe("present");
    if (present.kind !== "present") {
      throw new Error("expected present report");
    }
    expect(present.report.digest).toBe(reportDigest);
    expect(present.report).not.toHaveProperty("mutable");
  });
});

describe("concurrent prepare and run", () => {
  let database: EphemeralTestDatabase | undefined;

  afterEach(async () => {
    await database?.drop();
  });

  it("keeps one winner when two sessions prepare or run the same purpose", async () => {
    database = await createEphemeralTestDatabase("s10conc");
    const holder = new pg.Client({ connectionString: database.url });
    const contender = new pg.Client({ connectionString: database.url });
    await holder.connect();
    await contender.connect();
    try {
      const input = validPrepare({
        subject: {
          targetId: "target-concurrent",
          deploymentClass: "self-hosted",
          environmentId: "env-isolated",
        },
      });
      const prepareKeys = verificationLockKeys(
        "prepare",
        prepareLockMaterial("pre-activation", input.subject, input.lineage.phaseSnapshot),
      );
      const holderService = createReleaseVerificationService({
        db: databaseFromClient(holder),
        adapters: passingAdapters(),
      });
      const contenderService = createReleaseVerificationService({
        db: databaseFromClient(contender),
        adapters: passingAdapters(),
      });

      await holder.query("begin");
      await holder.query("select pg_catalog.pg_advisory_xact_lock($1, $2)", [
        prepareKeys[0],
        prepareKeys[1],
      ]);
      const prepareConflict = await contenderService.prepareVerification(input);
      expect(prepareConflict).toMatchObject({
        ok: false,
        error: { kind: "concurrent-conflict" },
      });
      await holder.query("rollback");

      const prepared = expectOk(await holderService.prepareVerification(input));
      const plans = await holder.query<{ count: string }>(
        "select count(*)::text as count from parameter_catalog.verification_plans where digest = $1",
        [prepared.digest],
      );
      expect(plans.rows[0]?.count).toBe("1");

      const runKeys = verificationLockKeys("run", prepared.digest);
      await holder.query("begin");
      await holder.query("select pg_catalog.pg_advisory_xact_lock($1, $2)", [
        runKeys[0],
        runKeys[1],
      ]);
      const runConflict = await contenderService.runVerification(prepared.digest);
      expect(runConflict).toMatchObject({
        ok: false,
        error: { kind: "concurrent-conflict" },
      });
      await holder.query("rollback");

      const ran = expectOk(await holderService.runVerification(prepared.digest));
      expect(ran.planDigest).toBe(prepared.digest);
    } finally {
      await holder.end().catch(() => undefined);
      await contender.end().catch(() => undefined);
    }
  });
});
