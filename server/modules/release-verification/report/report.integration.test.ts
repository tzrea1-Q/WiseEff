import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Result } from "../../parameter-catalog-contract/index";
import { createReleaseVerificationService } from "../core/service";
import { findLatestAttempt, insertReport } from "../core/persistence";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase,
} from "../../../testing/testDatabase";
import type {
  ApprovalCommand,
  PrepareVerificationInput,
  ReleaseVerificationReport,
  VerificationPlan,
} from "../core/types";
import { VerificationReportId } from "../core/types";
import {
  canonicalReportBytes,
  canonicalReportDigest,
  reportDigestIsDeterministic,
} from "./digest";
import {
  passingAdapters,
  planBoundEvidence,
  reportLineage,
  reportPins,
  validPrepare,
} from "./fixtures";
import { reportAuthorizesPurpose } from "./lineage";
import { createStartupRuntimePin, createVerificationReportService } from "./service";
import { P13_RETIRED_STATE } from "./runtimePin";
import type { ReportRefusal } from "./errors";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "S10-RPT report tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
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
    "S10-RPT report tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

const expectOk = <T>(result: Result<T, unknown>): T => {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) {
    throw new Error("expected ok");
  }
  return result.value;
};

const expectRefusal = (
  result: Result<unknown, ReportRefusal>,
  kind: ReportRefusal["kind"],
): void => {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("expected refusal");
  }
  expect(result.error.kind).toBe(kind);
};

describe("S10-RPT lineage-aware reports", () => {
  let db: InMemoryTestDatabase;
  let seq = 0;

  beforeAll(async () => {
    db = await createInMemoryTestDatabase();
  });

  afterAll(async () => {
    await db.rollback();
  });

  const nextTarget = (label: string): string => {
    seq += 1;
    return `target-${label}-${seq}`;
  };

  const coreService = () =>
    createReleaseVerificationService({ db, adapters: passingAdapters() });
  const reportService = (now = "2026-09-04T00:00:00.000Z") =>
    createVerificationReportService({
      db,
      clock: { now: () => new Date(now) },
    });

  const preparePlan = async (
    input: PrepareVerificationInput,
  ): Promise<VerificationPlan> => expectOk(await coreService().prepareVerification(input));

  const assemblePurpose = async (
    input: PrepareVerificationInput,
  ): Promise<{ plan: VerificationPlan; report: ReleaseVerificationReport }> => {
    const core = coreService();
    const reports = reportService();
    const plan = expectOk(await core.prepareVerification(input));
    expectOk(await core.runVerification(plan.digest));
    const report = expectOk(await reports.assembleReport(plan.digest, planBoundEvidence(plan)));
    return { plan, report };
  };

  const approveDistinct = async (
    reportDigest: string,
    purpose: ApprovalCommand["purpose"],
    prefix: string,
  ): Promise<void> => {
    const reports = reportService();
    expectOk(
      await reports.approveReport(reportDigest, {
        principalKind: "operator",
        principalId: `${prefix}-operator`,
        purpose,
      }),
    );
    expectOk(
      await reports.approveReport(reportDigest, {
        principalKind: "platform-owner",
        principalId: `${prefix}-owner`,
        purpose,
      }),
    );
  };

  const sharedSubject = (targetId: string) => ({
    targetId,
    deploymentClass: "self-hosted" as const,
    environmentId: "env-isolated",
  });

  it("refuses public-release with missing or wrong-purpose predecessors and does not store the report", async () => {
    const targetId = nextTarget("lineage");
    const subject = sharedSubject(targetId);
    const pins = reportPins();
    const pre = await assemblePurpose(
      validPrepare({
        subject,
        pins,
        purpose: "pre-activation",
        lineage: reportLineage({ phaseSnapshot: "P11" }),
      }),
    );
    await approveDistinct(pre.report.digest, "pre-activation", `${targetId}-pre`);
    const post = await assemblePurpose(
      validPrepare({
        subject,
        pins,
        purpose: "post-retirement-runtime",
        lineage: reportLineage({
          phaseSnapshot: "P13",
          p12State: "completed",
          p13State: P13_RETIRED_STATE,
          writerRetirementFingerprint: "retire-fp-1",
          runtimePinGeneration: "pin-1",
        }),
      }),
    );
    await approveDistinct(post.report.digest, "post-retirement-runtime", `${targetId}-post`);
    const isolated = await assemblePurpose(
      validPrepare({
        subject,
        pins,
        purpose: "isolated-candidate-acceptance",
        lineage: reportLineage({
          phaseSnapshot: "P14",
          p12State: "completed",
          p13State: P13_RETIRED_STATE,
          writerRetirementFingerprint: "retire-fp-1",
          runtimePinGeneration: "pin-1",
        }),
      }),
    );

    const reports = reportService();
    const missingPlan = await preparePlan(
      validPrepare({
        subject: sharedSubject(nextTarget("missing-pred")),
        pins,
        purpose: "public-release",
        lineage: reportLineage({
          phaseSnapshot: "P14b",
          predecessorReportDigests: [],
        }),
      }),
    );
    expectOk(await coreService().runVerification(missingPlan.digest));
    const missing = await reports.assembleReport(missingPlan.digest, planBoundEvidence(missingPlan));
    expectRefusal(missing, "missing-predecessor-digest");

    const incompletePlan = await preparePlan(
      validPrepare({
        subject: sharedSubject(nextTarget("incomplete-pred")),
        pins,
        purpose: "public-release",
        lineage: reportLineage({
          phaseSnapshot: "P14b",
          predecessorReportDigests: [pre.report.digest, post.report.digest],
        }),
      }),
    );
    expectOk(await coreService().runVerification(incompletePlan.digest));
    const incomplete = await reports.assembleReport(
      incompletePlan.digest,
      planBoundEvidence(incompletePlan),
    );
    expectRefusal(incomplete, "missing-predecessor-digest");

    const extraPre = await assemblePurpose(
      validPrepare({
        subject: sharedSubject(nextTarget("extra-pre")),
        pins,
        purpose: "pre-activation",
        lineage: reportLineage({ phaseSnapshot: "P11-extra" }),
      }),
    );
    await approveDistinct(extraPre.report.digest, "pre-activation", `${targetId}-extra-pre`);
    const wrongPlan = await preparePlan(
      validPrepare({
        subject: sharedSubject(nextTarget("wrong-pred")),
        pins,
        purpose: "public-release",
        lineage: reportLineage({
          phaseSnapshot: "P14b",
          predecessorReportDigests: [pre.report.digest, extraPre.report.digest, isolated.report.digest],
        }),
      }),
    );
    expectOk(await coreService().runVerification(wrongPlan.digest));
    const wrong = await reports.assembleReport(wrongPlan.digest, planBoundEvidence(wrongPlan));
    expectRefusal(wrong, "wrong-purpose");
    expect(reportAuthorizesPurpose(pre.report, "public-release")).toBe(false);

    const stored = await db.query<{ count: string }>(
      "select count(*)::text as count from parameter_catalog.verification_reports where purpose = 'public-release' and plan_digest = any($1::text[])",
      [[missingPlan.digest, incompletePlan.digest, wrongPlan.digest]],
    );
    expect(stored.rows[0]?.count).toBe("0");

    const publicPlan = await preparePlan(
      validPrepare({
        subject,
        pins,
        purpose: "public-release",
        lineage: reportLineage({
          phaseSnapshot: "P14b",
          p12State: "completed",
          p13State: P13_RETIRED_STATE,
          writerRetirementFingerprint: "retire-fp-1",
          runtimePinGeneration: "pin-1",
          predecessorReportDigests: [pre.report.digest, post.report.digest, isolated.report.digest],
        }),
      }),
    );
    expectOk(await coreService().runVerification(publicPlan.digest));
    const published = expectOk(
      await reports.assembleReport(publicPlan.digest, planBoundEvidence(publicPlan)),
    );
    expect(published.purpose).toBe("public-release");
    expect(new Set(published.predecessorReportDigests)).toEqual(
      new Set([pre.report.digest, post.report.digest, isolated.report.digest]),
    );
    expect(published.applicabilityProfile).toEqual(publicPlan.applicabilityProfile);
  });

  it("refuses verifier signatures and self-approval without mutating report bytes", async () => {
    const { report } = await assemblePurpose(
      validPrepare({
        subject: sharedSubject(nextTarget("approve")),
        purpose: "pre-activation",
      }),
    );
    const reports = reportService();
    const canonicalBytes = report.canonicalBytes;
    const verifier = await reports.approveReport(report.digest, {
      principalKind: "verifier",
      principalId: "person-a",
      purpose: "pre-activation",
    });
    expectRefusal(verifier, "verifier-signature-is-not-approval");
    expectOk(
      await reports.approveReport(report.digest, {
        principalKind: "operator",
        principalId: "person-shared",
        purpose: "pre-activation",
      }),
    );
    const self = await reports.approveReport(report.digest, {
      principalKind: "platform-owner",
      principalId: "person-shared",
      purpose: "pre-activation",
    });
    expectRefusal(self, "self-approval");
    const bytes = await db.query<{ canonical_bytes: string }>(
      "select canonical_bytes from parameter_catalog.verification_reports where digest = $1",
      [report.digest],
    );
    expect(bytes.rows[0]?.canonical_bytes).toBe(canonicalBytes);
  });

  it("fails closed on pre-pin runtime projection and hides prepare/run/assemble/approve from startup", async () => {
    const targetId = nextTarget("runtime-pin");
    const subject = sharedSubject(targetId);
    const pins = reportPins();
    const retired = await assemblePurpose(
      validPrepare({
        subject,
        pins,
        purpose: "post-retirement-runtime",
        lineage: reportLineage({
          phaseSnapshot: "P13",
          p12State: "completed",
          p13State: P13_RETIRED_STATE,
          writerRetirementFingerprint: "retire-fp-runtime",
          runtimePinGeneration: "pin-runtime",
        }),
      }),
    );
    await approveDistinct(retired.report.digest, "post-retirement-runtime", `${targetId}-runtime`);
    const reports = reportService();
    const prePin = await reports.readApprovedRuntimePin({
      p13State: "not-started",
      writerRetirementFingerprint: null,
      runtimePinGeneration: null,
      pins,
      subject,
    });
    expect(prePin).toEqual({ kind: "absent", reason: "pre-pin" });
    const missingFingerprint = await reports.readApprovedRuntimePin({
      p13State: P13_RETIRED_STATE,
      writerRetirementFingerprint: null,
      runtimePinGeneration: "pin-runtime",
      pins,
      subject,
    });
    expect(missingFingerprint).toEqual({ kind: "absent", reason: "pre-pin" });
    const present = await reports.readApprovedRuntimePin({
      p13State: P13_RETIRED_STATE,
      writerRetirementFingerprint: "retire-fp-runtime",
      runtimePinGeneration: "pin-runtime",
      pins,
      subject,
    });
    expect(present.kind).toBe("present");
    if (present.kind !== "present") {
      throw new Error("expected runtime pin");
    }
    expect(present.report.digest).toBe(retired.report.digest);
    expect(present.report.purpose).toBe("post-retirement-runtime");

    const startup = createStartupRuntimePin({
      db,
      clock: { now: () => new Date("2026-09-04T00:00:00.000Z") },
    });
    expect(Object.keys(startup).sort()).toEqual(["readApprovedRuntimePin"]);
    expect(startup).not.toHaveProperty("prepareVerification");
    expect(startup).not.toHaveProperty("runVerification");
    expect(startup).not.toHaveProperty("assembleReport");
    expect(startup).not.toHaveProperty("approveReport");
    const startupPresent = await startup.readApprovedRuntimePin({
      p13State: P13_RETIRED_STATE,
      writerRetirementFingerprint: "retire-fp-runtime",
      runtimePinGeneration: "pin-runtime",
      pins,
      subject,
    });
    expect(startupPresent.kind).toBe("present");
  });

  it("returns the same digest for the same canonical inputs and excludes assembledAt", async () => {
    const { report } = await assemblePurpose(
      validPrepare({
        subject: sharedSubject(nextTarget("digest")),
        purpose: "pre-activation",
      }),
    );
    expect(report.digest).toBe(canonicalReportDigest(report));
    expect(report.canonicalBytes).toBe(canonicalReportBytes(report));
    expect(report.canonicalBytes.includes(report.assembledAt)).toBe(false);
    expect(reportDigestIsDeterministic(report)).toBe(true);
    const later = {
      ...report,
      id: VerificationReportId("vreport_replay"),
      assembledAt: "2099-12-31T23:59:59.000Z",
    };
    expect(canonicalReportDigest(later)).toBe(report.digest);
  });

  it("returns tagged absence for missing or unapproved reports, never a mutable stub", async () => {
    const reports = reportService();
    const missing = await reports.readReport(
      "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    );
    expect(missing).toEqual({ kind: "absent", reason: "missing" });
    const { report } = await assemblePurpose(
      validPrepare({
        subject: sharedSubject(nextTarget("unapproved")),
        purpose: "pre-activation",
      }),
    );
    const unapproved = await reports.readReport(report.digest);
    expect(unapproved).toEqual({ kind: "absent", reason: "unapproved" });
    expect(unapproved).not.toHaveProperty("report");
    await approveDistinct(report.digest, "pre-activation", nextTarget("read"));
    const present = await reports.readReport(report.digest);
    expect(present.kind).toBe("present");
    if (present.kind !== "present") {
      throw new Error("expected present report");
    }
    expect(present.report.digest).toBe(report.digest);
    expect(present.report).not.toHaveProperty("mutable");
  });

  it("hides expired and unbound cleanup reports from readReport after retention closes", async () => {
    const expired = await assemblePurpose(
      validPrepare({
        subject: sharedSubject(nextTarget("expired")),
        purpose: "pre-activation",
        pins: reportPins("2020-01-01T00:00:00.000Z"),
        evidenceRequirements: {
          recoveryPointDigest: "2020-01-01T00:00:00.000Z",
          mappingEpoch: "epoch-1",
          cutoverPlanDigest: "sha256:cutover",
          acceptanceContractDigest: "sha256:accept",
        },
      }),
    );
    await approveDistinct(expired.report.digest, "pre-activation", nextTarget("expired-app"));
    const reports = reportService("2026-09-04T00:00:00.000Z");
    const expiredRead = await reports.readReport(expired.report.digest);
    expect(expiredRead).toEqual({ kind: "absent", reason: "missing" });

    const cleanupInput = validPrepare({
      subject: sharedSubject(nextTarget("unbound-cleanup")),
      purpose: "p16-cleanup",
      mode: "cleanup",
      lineage: reportLineage({ phaseSnapshot: "P16" }),
    });
    const core = coreService();
    const plan = expectOk(await core.prepareVerification(cleanupInput));
    expectOk(await core.runVerification(plan.digest));
    const attempt = await findLatestAttempt(db, plan.digest);
    if (!attempt) {
      throw new Error("expected cleanup attempt");
    }
    const unboundDraft = {
      planId: plan.id,
      planDigest: plan.digest,
      attemptId: attempt.id,
      attemptDigest: attempt.digest,
      purpose: plan.purpose,
      mode: plan.mode,
      phaseSnapshot: plan.lineage.phaseSnapshot,
      predecessorReportDigests: plan.lineage.predecessorReportDigests,
      pins: plan.pins,
      applicabilityProfile: plan.applicabilityProfile,
      decision: "passed" as const,
      results: attempt.results,
      evidenceRefs: planBoundEvidence(plan),
      evidenceDigests: attempt.results.map((result) => ({
        gateId: result.gateId,
        digest: result.evidenceDigest,
      })),
      consumerFamilyCoverageChecksum: expired.report.consumerFamilyCoverageChecksum,
      protectedReferenceCoverageChecksum: expired.report.protectedReferenceCoverageChecksum,
      writerReachability: expired.report.writerReachability,
      pointerRollbackStatus: plan.lineage.pointerRollbackStatus,
      redactionPolicy: expired.report.redactionPolicy,
      redactionVersion: expired.report.redactionVersion,
      retentionDeadlineInputs: {
        repositoryAuditHoldPolicyId: plan.pins.verification.contractVersion,
        longestProtectedRetentionClass: plan.pins.mappingArchive.archiveManifestDigest,
        cleanupReleaseAcceptanceBound: null,
        lastSupportedRestoreOrCompatibilityBound: plan.pins.recovery.recoveryPointDigest,
        publicLegacyReadWindowBound: plan.lineage.phaseSnapshot,
      },
      registryDigest: plan.registryDigest,
    };
    const unboundDigest = canonicalReportDigest(unboundDraft);
    const inserted = await insertReport(db, {
      ...unboundDraft,
      id: VerificationReportId(`vreport_unbound_${seq}`),
      digest: unboundDigest,
      aggregateDigest: unboundDigest,
      canonicalBytes: canonicalReportBytes(unboundDraft),
      assembledAt: "2026-09-04T00:00:00.000Z",
    });
    expect(inserted.ok, JSON.stringify(inserted)).toBe(true);
    if (!inserted.ok) {
      throw new Error("expected unbound cleanup report insert");
    }
    await approveDistinct(inserted.report.digest, "p16-cleanup", nextTarget("unbound-app"));
    const unboundRead = await reports.readReport(inserted.report.digest);
    expect(unboundRead).toEqual({ kind: "absent", reason: "missing" });

    const closed = await reports.cleanupUnreadableReports();
    expect(closed).toContain(expired.report.digest);
    const stillExpired = await reports.readReport(expired.report.digest);
    expect(stillExpired.kind).toBe("absent");
    expect(stillExpired).not.toEqual({ kind: "present", report: expired.report });
  });
});
