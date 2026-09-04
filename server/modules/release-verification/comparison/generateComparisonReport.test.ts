import { describe, expect, it } from "vitest";

import {
  aggregateComparisonCorpus,
  assertIndependentPhaseReports,
  generateComparisonReport,
} from "./index";
import { ComparisonCorpusError } from "./errors";
import {
  FRESH_POST_SHA,
  FRESH_PRE_SHA,
  POP_POST_SHA,
  POP_PRE_SHA,
  aggregationContext,
  makeFamilyContributions,
} from "./corpusTestSupport";

describe("generateComparisonReport", () => {
  it("binds phase, pins, eleven family checksums, and a deterministic report checksum", () => {
    const context = aggregationContext("fresh", "pre-activation", FRESH_PRE_SHA);
    const corpus = aggregateComparisonCorpus(makeFamilyContributions(context), context);
    const report = generateComparisonReport(corpus);
    expect(report.phase).toBe("pre-activation");
    expect(report.inventoryMode).toBe("fresh");
    expect(report.candidateSha).toBe(FRESH_PRE_SHA);
    expect(report.planPin).toBe(context.planPin);
    expect(report.mappingHeadId).toBe(context.mappingHeadId);
    expect(report.mappingHeadVersion).toBe(1);
    expect(report.mappingHeadChecksum).toBe(context.mappingHeadChecksum);
    expect(report.catalogSnapshotChecksum).toBe(context.catalogSnapshotChecksum);
    expect(report.corpusChecksum).toBe(corpus.checksum);
    expect(Object.keys(report.familyChecksums)).toHaveLength(11);
    expect(report.unexplainedDifferenceCount).toBe(0);
    expect(report.unqueryableProtectedReferenceCount).toBe(0);
    expect(report.failureCodes).toEqual([]);
    expect(generateComparisonReport(corpus).checksum).toBe(report.checksum);
  });

  it("reused-pre-activation-after-p13 refuses identical phase reports", () => {
    const context = aggregationContext("populated", "pre-activation", POP_PRE_SHA);
    const report = generateComparisonReport(
      aggregateComparisonCorpus(makeFamilyContributions(context), context),
    );
    try {
      assertIndependentPhaseReports(report, report);
      throw new Error("expected phase reuse refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(ComparisonCorpusError);
      expect((error as ComparisonCorpusError).code).toBe("PCAT-CMP-PHASE-REUSE");
    }
  });

  it("accepts independently bound pre-activation and post-p13 reports", () => {
    const preContext = aggregationContext("fresh", "pre-activation", FRESH_PRE_SHA);
    const postContext = aggregationContext("fresh", "post-p13", FRESH_POST_SHA);
    const pre = generateComparisonReport(
      aggregateComparisonCorpus(makeFamilyContributions(preContext), preContext),
    );
    const post = generateComparisonReport(
      aggregateComparisonCorpus(makeFamilyContributions(postContext), postContext),
    );
    assertIndependentPhaseReports(pre, post);
    expect(pre.checksum).not.toBe(post.checksum);
    expect(pre.corpusChecksum).not.toBe(post.corpusChecksum);
    expect(JSON.stringify(pre.familyChecksums)).not.toBe(JSON.stringify(post.familyChecksums));

    const popPre = aggregationContext("populated", "pre-activation", POP_PRE_SHA);
    const popPost = aggregationContext("populated", "post-p13", POP_POST_SHA);
    assertIndependentPhaseReports(
      generateComparisonReport(aggregateComparisonCorpus(makeFamilyContributions(popPre), popPre)),
      generateComparisonReport(aggregateComparisonCorpus(makeFamilyContributions(popPost), popPost)),
    );
  });
});
