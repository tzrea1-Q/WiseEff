import { beforeEach, expect, it, vi } from "vitest";
import type { Database } from "../../../shared/database/client";
import { reportPins } from "../report/fixtures";
import { verifyPublishedCandidateStartup, type PublishedStartupBoundary } from "./publishedStartup";

// Admission adapter unit tests, not generated verification evidence or root
// process acceptance. The real report module still owns approval and lineage.
const readers = vi.hoisted(() => ({ runtime: vi.fn(), report: vi.fn() }));
vi.mock("../report/index", () => ({
  createStartupRuntimePin: () => ({ readApprovedRuntimePin: readers.runtime }),
  createVerificationReportService: () => ({ readReport: readers.report }),
}));
const current = (): PublishedStartupBoundary => ({
  pins: reportPins(), subject: { targetId: "synthetic-target", deploymentClass: "self-hosted", environmentId: "synthetic" },
  p13State: "retired", writerRetirementFingerprint: "retirement", runtimePinGeneration: "generation",
  runtimeReportDigest: "runtime", publicReportDigest: "public", phaseSnapshot: "published",
  preActivationReportDigest: "pre", acceptanceReportDigest: "acceptance",
  predecessorReportDigests: ["pre", "runtime", "acceptance"],
  pointerRollbackStatus: "closed", trafficIsolationState: "public",
});
const value = (boundary: PublishedStartupBoundary, purpose: string) => ({ kind: "present", report: {
  digest: purpose === "public-release" ? "public" : purpose === "isolated-candidate-acceptance" ? "acceptance" : purpose === "pre-activation" ? "pre" : "runtime", purpose, decision: "passed", pins: structuredClone(boundary.pins),
  phaseSnapshot: purpose === "public-release" ? "published" : "post-retirement",
  predecessorReportDigests: purpose === "public-release" ? [...boundary.predecessorReportDigests] : purpose === "isolated-candidate-acceptance" ? ["runtime"] : purpose === "pre-activation" ? [] : ["pre"],
  pointerRollbackStatus: purpose === "public-release" ? "closed" : "open",
  evidenceRefs: [{ subject: structuredClone(boundary.subject) }],
} });
const verify = (observe: () => Promise<PublishedStartupBoundary>) => verifyPublishedCandidateStartup({
  reports: {} as Database, target: { observe, withLockedBoundary: async body => body() },
});
beforeEach(() => {
  readers.runtime.mockReset(); readers.report.mockReset();
  const boundary = current();
  readers.runtime.mockResolvedValue(value(boundary, "post-retirement-runtime"));
  readers.report.mockImplementation(async digest => value(boundary, digest === "public" ? "public-release" : digest === "acceptance" ? "isolated-candidate-acceptance" : digest === "pre" ? "pre-activation" : "post-retirement-runtime"));
});

it.each(["target", "retention"])("refuses pre-activation %s mismatch through its existing approved projection", async fault => {
  const original = readers.report.getMockImplementation()!;
  readers.report.mockImplementation(async digest => {
    if (digest !== "pre") return original(digest);
    if (fault === "retention") return { kind: "absent", reason: "missing" };
    const pre = value(current(), "pre-activation");
    pre.report.evidenceRefs[0].subject.environmentId = "another-environment";
    return pre;
  });
  expect(await verify(async () => current())).toEqual({ ok: false, reason: fault === "retention" ? "missing" : "boundary-mismatch" });
});

it("refuses current public/runtime reports borrowing acceptance performed under an older runtime", async () => {
  const acceptance = value(current(), "isolated-candidate-acceptance");
  acceptance.report.predecessorReportDigests = ["older-runtime"];
  readers.report.mockImplementation(async digest => digest === "acceptance" ? acceptance : value(current(), digest === "public" ? "public-release" : "post-retirement-runtime"));
  expect(await verify(async () => current())).toEqual({ ok: false, reason: "boundary-mismatch" });
});

it.each([{ predecessors: [] }, { predecessors: ["other-pre-activation"] }])("requires runtime lineage to bind the actual P12 pre-activation report: %j", async ({ predecessors }) => {
  const runtime = value(current(), "post-retirement-runtime");
  runtime.report.predecessorReportDigests = predecessors;
  readers.runtime.mockResolvedValue(runtime);
  readers.report.mockImplementation(async digest => digest === "runtime" ? runtime : value(current(), digest === "public" ? "public-release" : "isolated-candidate-acceptance"));
  expect(await verify(async () => current())).toEqual({ ok: false, reason: "boundary-mismatch" });
});

it("revalidates both existing projections for a published restart without rewriting the earlier open rollback state", async () => {
  expect(await verify(async () => current())).toEqual({ ok: true, scope: "published-candidate-restart-only", runtimeReportDigest: "runtime", publicReportDigest: "public" });
  expect(readers.report.mock.calls).toEqual([["runtime"], ["public"], ["acceptance"], ["pre"]]);
});

it.each(["missing", "unapproved"])("retains %s report refusal", async reason => {
  readers.report.mockResolvedValue({ kind: "absent", reason });
  expect(await verify(async () => current())).toEqual({ ok: false, reason });
});

it.each(["purpose", "blocked", "target", "candidate", "mapping", "phase", "rollback", "old-runtime", "empty-evidence"])("rejects public %s drift", async fault => {
  const publication = value(current(), "public-release");
  if (fault === "purpose") publication.report.purpose = "pre-activation";
  if (fault === "blocked") publication.report.decision = "blocked";
  if (fault === "target") publication.report.evidenceRefs[0].subject.targetId = "another";
  if (fault === "candidate") (publication.report.pins.artifact as { gitSha: string }).gitSha = "another";
  if (fault === "mapping") (publication.report.pins.mappingArchive as { mappingHeadDigest: string }).mappingHeadDigest = "another";
  if (fault === "phase") publication.report.phaseSnapshot = "old-phase";
  if (fault === "rollback") publication.report.pointerRollbackStatus = "open";
  if (fault === "old-runtime") publication.report.predecessorReportDigests = ["pre", "old-runtime", "acceptance"];
  if (fault === "empty-evidence") publication.report.evidenceRefs = [];
  readers.report.mockImplementation(async digest => digest === "public" ? publication : value(current(), "post-retirement-runtime"));
  expect(await verify(async () => current())).toEqual({ ok: false, reason: "boundary-mismatch" });
});

it("rejects current boundary mutation during projection reads", async () => {
  const boundary = current();
  readers.runtime.mockImplementation(async () => {
    (boundary as { runtimePinGeneration: string }).runtimePinGeneration = "new-generation";
    return value(current(), "post-retirement-runtime");
  });
  expect(await verify(async () => boundary)).toEqual({ ok: false, reason: "boundary-mismatch" });
});

it("redacts failed observers and refuses isolated or pre-pin state without report lookup", async () => {
  expect(await verify(async () => { throw new Error("private target credential"); })).toEqual({ ok: false, reason: "source-unavailable" });
  expect((await verify(async () => ({ ...current(), trafficIsolationState: "isolated" }))).ok).toBe(false);
  expect((await verify(async () => ({ ...current(), p13State: "not-retired" }))).ok).toBe(false);
  expect(readers.runtime).not.toHaveBeenCalled();
});
