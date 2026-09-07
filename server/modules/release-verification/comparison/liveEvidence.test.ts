import { describe, expect, it, vi } from "vitest";
import type { ComparisonProvider } from "./productionProviders";
const fixtureProviders = vi.hoisted(() => ({ value: [] as ComparisonProvider[] }));
// Only the consumer contributions are synthetic. The public live aggregator,
// parser, full-family validation, report generator and evidence adapter execute.
vi.mock("./productionProviders", () => ({ createProductionComparisonProviders: () => fixtureProviders.value }));
import { assertComparisonEvidenceAssociation, COMPARISON_EVIDENCE_PRODUCER, createComparisonEvidenceExecution,
  type ComparisonBoundaryObservation, type LiveComparisonSource } from "./liveEvidence";
import { comparisonVerificationGateIds } from "../../parameter-catalog-contract/index";
import { VerificationGateId, type ReleaseVerificationReport, type VerificationPlan } from "../core/types";
import { digestOf } from "../core/digest";
import { purposeProfile } from "../core/gateRegistry";
import { validPrepare } from "../report/fixtures";
import { aggregationContext, makeCase, makeContribution, makeFamilyContributions } from "./corpusTestSupport";
import { checksumComparisonContribution, COMPARISON_FAMILIES, FAMILY_COMPARISON_IDS } from "./corpusContributionSchema";
import { checksumComparisonReport } from "./corpusResultSchema";

function fixture(purpose: "pre-activation" | "post-retirement-runtime" = "pre-activation", mode: "fresh" | "populated" = "populated") {
  const input = validPrepare({ purpose, mode });
  const plan = { ...input, id: "synthetic-plan", digest: digestOf(input), canonicalBytes: "synthetic plan fixture",
    registryDigest: digestOf("registry"), gateSelectionSource: "registry", createdAt: "2026-09-07T00:00:00.000Z",
    applicabilityProfile: purposeProfile(purpose, mode) } as VerificationPlan;
  const context = { ...aggregationContext(mode, purpose === "pre-activation" ? "pre-activation" : "post-p13", plan.pins.artifact.gitSha),
    planPin: plan.pins.cutover.planDigest };
  const observation: ComparisonBoundaryObservation = { context, pins: structuredClone(plan.pins), subject: structuredClone(plan.subject), lineage: structuredClone(plan.lineage) };
  const contributions = makeFamilyContributions(context);
  fixtureProviders.value = COMPARISON_FAMILIES.map(family => ({ family, comparisonIds: FAMILY_COMPARISON_IDS[family],
    provide: vi.fn(async () => structuredClone(contributions.find(item => item.family === family)!)) }));
  const observe = vi.fn(async () => observation);
  const reader = { database: {} as never, pool: {} as never, observe };
  const source: LiveComparisonSource = { withBoundary: vi.fn(async body => { await body(reader); }) };
  const execution = createComparisonEvidenceExecution({ source });
  return { plan, observation, contributions, reader, source, observe, execution };
}
async function run(f: ReturnType<typeof fixture>) {
  const results = [];
  for (const id of comparisonVerificationGateIds) {
    const gateId = VerificationGateId(id);
    results.push(await f.execution.adapters.get(id)!({ gateId, plan: f.plan }));
  }
  return results;
}
function associatedReport(f: ReturnType<typeof fixture>, results: Awaited<ReturnType<typeof run>>): ReleaseVerificationReport {
  const bundle = f.execution.readEvidence();
  // This is a typed association fixture, never an approved report or a real
  // verification-service execution. Its integrity fields are exercised below.
  return { planDigest: f.plan.digest, purpose: f.plan.purpose, mode: f.plan.mode, pins: f.plan.pins,
    phaseSnapshot: f.plan.lineage.phaseSnapshot, decision: "passed", results,
    evidenceRefs: bundle.evidenceRefs, evidenceDigests: results.map(result => ({ gateId: result.gateId, digest: result.evidenceDigest })) } as unknown as ReleaseVerificationReport;
}

describe("comparison evidence execution with synthetic family contributions", () => {
  it("fails closed when the composition root has not installed a live source", async () => {
    const execution = createComparisonEvidenceExecution({});
    const gateId = VerificationGateId(comparisonVerificationGateIds[0]);
    const result = await execution.adapters.get(gateId)!({ gateId, plan: {} as VerificationPlan });
    expect(result.status).toBe("failed");
    expect(() => execution.readEvidence()).toThrow("PCAT-CMP-EVIDENCE-SOURCE-UNAVAILABLE");
  });

  it.each(["pre-activation", "post-retirement-runtime"] as const)("runs the actual aggregation/report pipeline once and binds all nine envelopes for %s", async purpose => {
    const f = fixture(purpose); const results = await run(f); const bundle = f.execution.readEvidence();
    expect(results.every(result => result.status === "passed")).toBe(true);
    expect(bundle.report.sourceInventoryCount).toBeGreaterThan(0);
    expect(bundle.report.gateCoverage).toHaveLength(9);
    expect(bundle.report.checksum).toBe(checksumComparisonReport(bundle.report));
    expect(bundle.reportArtifactDigest).toBe(`sha256:${bundle.report.checksum}`);
    expect(new Set(bundle.evidenceRefs.map(ref => ref.digest)).size).toBe(9);
    for (const provider of fixtureProviders.value) expect(provider.provide).toHaveBeenCalledOnce();
    expect(f.source.withBoundary).toHaveBeenCalledOnce(); expect(f.observe).toHaveBeenCalledTimes(2);
    for (const ref of bundle.evidenceRefs) {
      expect(ref).toMatchObject({ producer: COMPARISON_EVIDENCE_PRODUCER, purpose, subject: f.plan.subject,
        phaseSnapshot: f.plan.lineage.phaseSnapshot, pins: f.plan.pins });
      expect(results.find(result => result.gateId === ref.gateId)?.evidenceDigest).toBe(ref.digest);
    }
    expect(assertComparisonEvidenceAssociation({ comparisonReport: bundle.report, verificationReport: associatedReport(f, results), subject: f.plan.subject }))
      .toEqual({ comparisonReportDigest: bundle.reportArtifactDigest });
  });

  it("accepts the frozen true-fresh corpus path without replacing it with a boolean", async () => {
    const f = fixture("pre-activation", "fresh"); expect((await run(f)).every(result => result.status === "passed")).toBe(true);
    expect(f.execution.readEvidence().report.sourceInventoryCount).toBe(0);
    for (const provider of fixtureProviders.value) expect(provider.provide).toHaveBeenCalledOnce();
  });

  it.each(["pins", "subject", "lineage", "candidate", "plan"])("rejects current %s not matching the planned boundary before queries", async field => {
    const f = fixture();
    if (field === "pins") Object.assign(f.observation.pins.database, { targetIdentity: "other-database" });
    if (field === "subject") Object.assign(f.observation.subject, { targetId: "other-target" });
    if (field === "lineage") Object.assign(f.observation.lineage, { phaseSnapshot: "other-phase" });
    if (field === "candidate") Object.assign(f.observation.context, { candidateSha: "b".repeat(40) });
    if (field === "plan") Object.assign(f.observation.context, { planPin: "other-cutover" });
    expect((await run(f)).every(result => result.status === "failed")).toBe(true);
    for (const provider of fixtureProviders.value) expect(provider.provide).not.toHaveBeenCalled();
    expect(() => f.execution.readEvidence()).toThrow("BOUNDARY-MISMATCH");
  });

  it.each(["mapping", "catalog", "database", "phase"])("snapshots the first observation and rejects the reused object drifting in %s", async field => {
    const f = fixture();
    f.observe.mockImplementationOnce(async () => f.observation).mockImplementationOnce(async () => {
      if (field === "mapping") Object.assign(f.observation.context, { mappingHeadVersion: f.observation.context.mappingHeadVersion + 1 });
      if (field === "catalog") Object.assign(f.observation.context, { catalogSnapshotChecksum: "f".repeat(64) });
      if (field === "database") Object.assign(f.observation.pins.database, { targetIdentity: "other" });
      if (field === "phase") Object.assign(f.observation.lineage, { phaseSnapshot: "other" });
      return f.observation;
    });
    expect((await run(f)).every(result => result.status === "failed")).toBe(true);
    expect(() => f.execution.readEvidence()).toThrow("BOUNDARY-DRIFT");
  });

  it.each(["no-callback", "twice", "lock-loss"])("does not publish a bundle when the boundary producer returns %s", async fault => {
    const f = fixture();
    f.execution = createComparisonEvidenceExecution({ source: { async withBoundary(body) {
      if (fault === "no-callback") return;
      await body(f.reader);
      if (fault === "twice") await body(f.reader);
      if (fault === "lock-loss") throw new Error("private lock path and credential");
    } } });
    expect((await run(f)).every(result => result.status === "failed")).toBe(true);
    expect(() => f.execution.readEvidence()).toThrow(/^PCAT-CMP-EVIDENCE-(BOUNDARY-MISMATCH|CAPTURE-FAILED)$/);
  });

  it.each(["missing", "unqueryable", "unexplained", "bad-checksum", "unknown-error"])("preserves failure closure for %s contributions", async fault => {
    const f = fixture();
    if (fault === "missing") fixtureProviders.value.pop();
    else if (fault === "unknown-error") Object.assign(fixtureProviders.value[0]!, { provide: vi.fn(async () => { throw new Error("private raw business value"); }) });
    else {
      const family = "CGH"; const context = f.observation.context;
      const changed = fault === "bad-checksum" ? { ...f.contributions[0]!, checksum: "0".repeat(64) } : makeContribution(family, context, {
        cases: FAMILY_COMPARISON_IDS.CGH.map(id => makeCase(family, id, context, "ref-1",
          fault === "unqueryable" ? "unqueryable/protected-reference-missing" : "unexplained-difference")),
      });
      Object.assign(fixtureProviders.value[0]!, { provide: vi.fn(async () => changed) });
    }
    expect((await run(f)).every(result => result.status === "failed" && result.evidenceDigest === null)).toBe(true);
    try { f.execution.readEvidence(); throw new Error("must-refuse"); } catch (error) {
      expect(error).toMatchObject({ reason: "CAPTURE-FAILED" });
      expect(String(error)).not.toContain("private");
      if (fault === "missing") expect(error).toMatchObject({ corpusFailureCode: "PCAT-CMP-MISSING-FAMILY" });
      if (fault === "unqueryable") expect(error).toMatchObject({ corpusFailureCode: "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE" });
      if (fault === "unexplained") expect(error).toMatchObject({ corpusFailureCode: "PCAT-CMP-UNEXPLAINED-DIFFERENCE" });
    }
  });

  it.each(["same-plan", "different-plan"])("does not reuse an execution for a second attempt: %s", async mode => {
    const f = fixture(); await run(f);
    const gateId = VerificationGateId(comparisonVerificationGateIds[0]);
    const changed = mode === "different-plan" ? { ...f.plan, digest: digestOf("other") as VerificationPlan["digest"] } : f.plan;
    expect((await f.execution.adapters.get(gateId)!({ gateId, plan: changed })).status).toBe("failed");
    expect(() => f.execution.readEvidence()).toThrow("ATTEMPT-REUSED");
    f.execution = createComparisonEvidenceExecution({ source: f.source });
    expect((await run(f)).every(result => result.status === "passed")).toBe(true);
    for (const provider of fixtureProviders.value) expect(provider.provide).toHaveBeenCalledTimes(2);
  });

  it("does not expose partial or mutable evidence", async () => {
    const f = fixture();
    const id = VerificationGateId(comparisonVerificationGateIds[0]);
    await f.execution.adapters.get(id)!({ gateId: id, plan: f.plan });
    expect(() => f.execution.readEvidence()).toThrow("NOT-COMPLETE");
    for (const raw of comparisonVerificationGateIds.slice(1)) {
      const gateId = VerificationGateId(raw); await f.execution.adapters.get(raw)!({ gateId, plan: f.plan });
    }
    const bundle = f.execution.readEvidence(); Object.assign(bundle.report, { checksum: "tampered" });
    expect(f.execution.readEvidence().report.checksum).not.toBe("tampered");
  });

  it.each(["purpose", "restored", "cleanup"] as const)("does not infer an unsupported phase or inventory: %s", async mode => {
    const f = fixture();
    if (mode === "purpose") f.plan = { ...f.plan, purpose: "p16-cleanup" };
    else f.plan = { ...f.plan, mode };
    expect((await run(f)).every(result => result.status === "failed")).toBe(true);
    expect(() => f.execution.readEvidence()).toThrow(/PURPOSE-UNSUPPORTED|MODE-UNSUPPORTED/);
  });

  it("preserves registry not-applicable outcomes without querying providers", async () => {
    const f = fixture(); f.plan = { ...f.plan, purpose: "public-release" };
    expect((await run(f)).every(result => result.status === "not-applicable" && result.evidenceDigest === null)).toBe(true);
    expect(f.source.withBoundary).not.toHaveBeenCalled();
    expect(() => f.execution.readEvidence()).toThrow("NOT-COMPLETE");
  });

  it.each(["checksum", "rehashed-report", "purpose", "pins", "subject", "phase", "missing-gate", "duplicate-ref", "producer", "evidence-digest", "blocked"])("rejects a forged or unrelated report association: %s", async fault => {
    const f = fixture(); const results = await run(f); const bundle = f.execution.readEvidence();
    const report = structuredClone(associatedReport(f, results)); const comparison = structuredClone(bundle.report);
    let subject = structuredClone(f.plan.subject);
    if (fault === "checksum") Object.assign(comparison, { checksum: "0".repeat(64) });
    if (fault === "rehashed-report") { Object.assign(comparison, { mappingHeadId: "another-head" }); Object.assign(comparison, { checksum: checksumComparisonReport(comparison) }); }
    if (fault === "purpose") Object.assign(report, { purpose: "public-release" });
    if (fault === "pins") Object.assign(report.pins.database, { targetIdentity: "other" });
    if (fault === "subject") subject = { ...subject, targetId: "other" };
    if (fault === "phase") Object.assign(report, { phaseSnapshot: "other" });
    if (fault === "missing-gate") Object.assign(report, { results: report.results.slice(1) });
    if (fault === "duplicate-ref") Object.assign(report, { evidenceRefs: [...report.evidenceRefs, report.evidenceRefs[0]] });
    if (fault === "producer") Object.assign(report.evidenceRefs[0]!, { producer: "caller" });
    if (fault === "evidence-digest") Object.assign(report.evidenceDigests[0]!, { digest: "sha256:caller" });
    if (fault === "blocked") Object.assign(report, { decision: "blocked" });
    expect(() => assertComparisonEvidenceAssociation({ comparisonReport: comparison, verificationReport: report, subject })).toThrow("PCAT-CMP-EVIDENCE");
  });

  it("retains the frozen multi-head mismatch instead of relabeling per-case heads as one epoch", async () => {
    const f = fixture(); Object.assign(f.observation.context, { mappingHeadId: "version-a", mappingHeadVersion: 1 });
    const contributions = makeFamilyContributions(f.observation.context);
    const cgh = contributions[0]!;
    // Static domain counterexample: source A has version-a/cas 1, source B
    // has version-b/cas 2. Their distinct exact mapping evidence cannot both
    // equal the one contribution/context head under the current codec.
    Object.assign(cgh.cases[1]!.expectedDifference!, { mappingHeadId: "version-b", mappingHeadVersion: 2 });
    Object.assign(cgh, { checksum: checksumComparisonContribution(cgh) });
    fixtureProviders.value = COMPARISON_FAMILIES.map(family => ({ family, comparisonIds: FAMILY_COMPARISON_IDS[family],
      provide: vi.fn(async () => structuredClone(contributions.find(item => item.family === family)!)) }));
    expect((await run(f)).every(result => result.status === "failed")).toBe(true);
    expect(() => f.execution.readEvidence()).toThrow("PCAT-CMP-EXPECTED-DIFFERENCE-EVIDENCE");
  });
});
