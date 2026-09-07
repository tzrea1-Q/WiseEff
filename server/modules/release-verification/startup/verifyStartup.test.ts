import { beforeEach, expect, it, vi } from "vitest";
import type { Database } from "../../../shared/database/client";
import type { ReleaseVerificationReport } from "../core/types";
import { reportPins } from "../report/fixtures";
import type { StartupBoundary } from "./interface";
import { verifyIsolatedCandidateStartup } from "./verifyStartup";

// Adapter-only unit tests. These do not create reports or claim gates passed.
// Real report assembly/approval remains covered by the existing report module.
const reader = vi.hoisted(() => vi.fn());
vi.mock("../report/index", () => ({ createStartupRuntimePin: () => ({ readApprovedRuntimePin: reader }) }));
const reports = {} as Database;
type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };
const boundary = (): Mutable<StartupBoundary> => ({
  p13State: "retired", writerRetirementFingerprint: "retired-state", runtimePinGeneration: "generation-1",
  pins: reportPins(), subject: { targetId: "target", deploymentClass: "self-hosted", environmentId: "isolated" },
  reportDigest: "approved-runtime-report", phaseSnapshot: "post-P13-P11", predecessorReportDigests: ["pre-activation"],
  pointerRollbackStatus: "open", trafficIsolationState: "isolated",
});
const projection = (current: StartupBoundary) => ({ kind: "present", report: {
  digest: current.reportDigest, purpose: "post-retirement-runtime", decision: "passed", pins: structuredClone(current.pins),
  phaseSnapshot: current.phaseSnapshot, predecessorReportDigests: [...current.predecessorReportDigests],
  pointerRollbackStatus: current.pointerRollbackStatus, evidenceRefs: [{ subject: current.subject }],
} as ReleaseVerificationReport });
const target = (observe: () => Promise<StartupBoundary>) => ({ observe, withLockedBoundary: async <T>(body: () => Promise<T>) => body() });
beforeEach(() => { reader.mockReset(); });

it("uses only the existing approved projection between two locked live observations", async () => {
  const current = boundary(); const order: string[] = [];
  reader.mockImplementation(async () => { order.push("read"); return projection(current); });
  const result = await verifyIsolatedCandidateStartup({ reports, target: {
    withLockedBoundary: async body => { order.push("lock"); const value = await body(); order.push("unlock"); return value; },
    observe: async () => { order.push("observe"); return current; },
  } });
  expect(result).toEqual({ ok: true, reportDigest: current.reportDigest, scope: "isolated-candidate-startup-only" });
  expect(order).toEqual(["lock", "observe", "read", "observe", "unlock"]);
});

it.each(["missing", "unapproved", "pre-pin"] as const)("preserves typed %s refusal", async reason => {
  reader.mockResolvedValue({ kind: "absent", reason });
  expect(await verifyIsolatedCandidateStartup({ reports, target: target(async () => boundary()) })).toEqual({ ok: false, reason });
});

it.each(["public", "not-retired", "missing-fingerprint", "missing-generation", "missing-report"])("refuses %s before report lookup", async fault => {
  const current = boundary();
  if (fault === "public") current.trafficIsolationState = "public";
  if (fault === "not-retired") current.p13State = "not-started";
  if (fault === "missing-fingerprint") current.writerRetirementFingerprint = null;
  if (fault === "missing-generation") current.runtimePinGeneration = null;
  if (fault === "missing-report") current.reportDigest = "";
  expect((await verifyIsolatedCandidateStartup({ reports, target: target(async () => current) })).ok).toBe(false);
  expect(reader).not.toHaveBeenCalled();
});

it.each(["purpose", "decision", "report", "candidate", "database", "release", "phase", "lineage", "rollback", "subject", "evidence"])("refuses selected report %s mismatch", async fault => {
  const current = boundary(); const value = projection(current); const report = value.report as any;
  if (fault === "purpose") report.purpose = "pre-activation";
  if (fault === "decision") report.decision = "blocked";
  if (fault === "report") report.digest = "older-report";
  if (fault === "candidate") report.pins.artifact.gitSha = "other";
  if (fault === "database") report.pins.database.targetIdentity = "other";
  if (fault === "release") report.pins.catalog.releaseDigest = "other";
  if (fault === "phase") report.phaseSnapshot = "P11";
  if (fault === "lineage") report.predecessorReportDigests = [];
  if (fault === "rollback") report.pointerRollbackStatus = "closed";
  if (fault === "subject") report.evidenceRefs = [{ subject: { ...current.subject, targetId: "other" } }];
  if (fault === "evidence") report.evidenceRefs = [];
  reader.mockResolvedValue(value);
  expect(await verifyIsolatedCandidateStartup({ reports, target: target(async () => current) })).toEqual({ ok: false, reason: "boundary-mismatch" });
});

it("rejects in-place target mutation while reading the report", async () => {
  const current = boundary(); const value = projection(current);
  reader.mockImplementation(async () => { current.runtimePinGeneration = "generation-2"; return value; });
  expect(await verifyIsolatedCandidateStartup({ reports, target: target(async () => current) })).toEqual({ ok: false, reason: "boundary-mismatch" });
});

it("redacts unknown producer and report failures without returning an empty success", async () => {
  reader.mockRejectedValue(new Error("postgres://private-secret"));
  expect(await verifyIsolatedCandidateStartup({ reports, target: target(async () => boundary()) })).toEqual({ ok: false, reason: "source-unavailable" });
  expect(await verifyIsolatedCandidateStartup({ reports, target: target(async () => { throw new Error("private target"); }) })).toEqual({ ok: false, reason: "source-unavailable" });
});
