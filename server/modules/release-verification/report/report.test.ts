import { describe, expect, it } from "vitest";
import {
  canonicalReportBytes,
  canonicalReportDigest,
  reportCanonicalPayload,
  reportDigestIsDeterministic,
} from "./digest";
import { evaluateRetention } from "./retention";
import {
  PUBLIC_RELEASE_PREDECESSOR_PURPOSES,
  allowedPredecessorPurposes,
  reportAuthorizesPurpose,
  requiredPredecessorPurposes,
} from "./lineage";
import { P13_RETIRED_STATE } from "./runtimePin";
import type { ReleaseVerificationReport } from "../core/types";
import { VerificationReportId } from "../core/types";
import { reportPins } from "./fixtures";

const sampleReport = (
  overrides: Partial<ReleaseVerificationReport> = {},
): ReleaseVerificationReport => {
  const base = {
    planId: "vplan_1" as ReleaseVerificationReport["planId"],
    planDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as ReleaseVerificationReport["planDigest"],
    attemptId: "vattempt_1" as ReleaseVerificationReport["attemptId"],
    attemptDigest:
      "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as ReleaseVerificationReport["attemptDigest"],
    purpose: "pre-activation" as const,
    mode: "populated" as const,
    phaseSnapshot: "P11",
    predecessorReportDigests: [] as const,
    pins: reportPins(),
    applicabilityProfile: [] as const,
    decision: "passed" as const,
    results: [] as const,
    evidenceRefs: [] as const,
    evidenceDigests: [] as const,
    consumerFamilyCoverageChecksum:
      "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    protectedReferenceCoverageChecksum:
      "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    writerReachability: {
      status: "passed" as const,
      evidenceDigest: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      failureCode: null,
    },
    pointerRollbackStatus: "open" as const,
    redactionPolicy: "catalog-verification-redaction",
    redactionVersion: "1",
    retentionDeadlineInputs: {
      repositoryAuditHoldPolicyId: "s10-rpt",
      longestProtectedRetentionClass: "sha256:archive",
      cleanupReleaseAcceptanceBound: null,
      lastSupportedRestoreOrCompatibilityBound: "sha256:rp",
      publicLegacyReadWindowBound: null,
    },
    registryDigest:
      "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" as ReleaseVerificationReport["registryDigest"],
  };
  const digest = canonicalReportDigest(base);
  return {
    ...base,
    id: VerificationReportId("vreport_1"),
    digest,
    aggregateDigest: digest,
    canonicalBytes: canonicalReportBytes(base),
    assembledAt: "2026-09-04T12:00:00.000Z",
    ...overrides,
  };
};

describe("S10-RPT report lineage helpers", () => {
  it("requires exact public-release predecessor purposes and does not let a report authorize another purpose", () => {
    expect([...PUBLIC_RELEASE_PREDECESSOR_PURPOSES]).toEqual([
      "pre-activation",
      "post-retirement-runtime",
      "isolated-candidate-acceptance",
    ]);
    expect(requiredPredecessorPurposes("public-release")).toEqual(PUBLIC_RELEASE_PREDECESSOR_PURPOSES);
    expect(requiredPredecessorPurposes("pre-activation")).toEqual([]);
    expect(allowedPredecessorPurposes("pre-activation")).toEqual([]);
    const pre = sampleReport({ purpose: "pre-activation" });
    expect(reportAuthorizesPurpose(pre, "pre-activation")).toBe(true);
    expect(reportAuthorizesPurpose(pre, "public-release")).toBe(false);
  });

  it("keeps canonical report digests stable across assembledAt and opaque ids", () => {
    const first = sampleReport();
    const second = sampleReport({
      id: VerificationReportId("vreport_other"),
      assembledAt: "2099-01-01T00:00:00.000Z",
    });
    expect(canonicalReportDigest(first)).toBe(canonicalReportDigest(second));
    expect(first.digest).toBe(second.digest);
    expect(reportCanonicalPayload(first)).not.toHaveProperty("assembledAt");
    expect(reportCanonicalPayload(first)).not.toHaveProperty("id");
    expect(first.canonicalBytes.includes(first.assembledAt)).toBe(false);
    expect(reportDigestIsDeterministic(first)).toBe(true);
    expect(P13_RETIRED_STATE).toBe("retired");
  });

  it("treats expired dated bounds and unbound cleanup as not retained", () => {
    const clock = { now: () => new Date("2026-09-04T00:00:00.000Z") };
    expect(
      evaluateRetention(
        {
          repositoryAuditHoldPolicyId: "s10-rpt",
          longestProtectedRetentionClass: "archive",
          cleanupReleaseAcceptanceBound: null,
          lastSupportedRestoreOrCompatibilityBound: "2020-01-01T00:00:00.000Z",
          publicLegacyReadWindowBound: null,
        },
        "pre-activation",
        clock,
      ),
    ).toMatchObject({ status: "expired" });
    expect(
      evaluateRetention(
        {
          repositoryAuditHoldPolicyId: "s10-rpt",
          longestProtectedRetentionClass: "archive",
          cleanupReleaseAcceptanceBound: null,
          lastSupportedRestoreOrCompatibilityBound: "sha256:rp",
          publicLegacyReadWindowBound: null,
        },
        "p16-cleanup",
        clock,
      ),
    ).toEqual({
      status: "unbound",
      missing: ["cleanupReleaseAcceptanceBound"],
    });
    expect(
      evaluateRetention(
        {
          repositoryAuditHoldPolicyId: "s10-rpt",
          longestProtectedRetentionClass: "archive",
          cleanupReleaseAcceptanceBound: "P16",
          lastSupportedRestoreOrCompatibilityBound: "sha256:rp",
          publicLegacyReadWindowBound: null,
        },
        "p16-cleanup",
        clock,
      ).status,
    ).toBe("retained");
  });
});
