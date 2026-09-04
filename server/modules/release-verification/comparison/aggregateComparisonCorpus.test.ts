import { describe, expect, it } from "vitest";

import {
  aggregateComparisonCorpus,
  generateComparisonReport,
} from "./index";
import {
  COMPARISON_FAMILIES,
  checksumComparisonContribution,
  type ComparisonFamily,
  type ComparisonId,
} from "./corpusContributionSchema";
import { ComparisonCorpusError } from "./errors";
import {
  FRESH_POST_SHA,
  FRESH_PRE_SHA,
  POP_PRE_SHA,
  aggregationContext,
  makeCase,
  makeContribution,
  makeFamilyContributions,
} from "./corpusTestSupport";

function expectCode(run: () => unknown, code: string) {
  try {
    run();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ComparisonCorpusError);
    expect((error as ComparisonCorpusError).code).toBe(code);
  }
}

describe("aggregateComparisonCorpus adversarial refusals", () => {
  const fresh = aggregationContext("fresh", "pre-activation", FRESH_PRE_SHA);
  const populated = aggregationContext("populated", "pre-activation", POP_PRE_SHA);

  it("missing-family-registration refuses before comparison", () => {
    const contributions = makeFamilyContributions(fresh).filter((item) => item.family !== "LOG");
    expectCode(
      () => aggregateComparisonCorpus(contributions, fresh),
      "PCAT-CMP-MISSING-FAMILY",
    );
  });

  it("duplicate-family-registration refuses before comparison", () => {
    const contributions = makeFamilyContributions(fresh);
    const duplicated = [
      ...contributions.filter((item) => item.family !== "TOP"),
      makeContribution("CGH", fresh),
    ];
    expectCode(
      () => aggregateComparisonCorpus(duplicated, fresh),
      "PCAT-CMP-DUPLICATE-FAMILY",
    );
  });

  it("unknown-family-or-comparison-id refuses unknown family", () => {
    const contributions = makeFamilyContributions(fresh).map((item) =>
      item.family === "OPS" ? { ...item, family: "XYZ" as ComparisonFamily } : item,
    );
    expectCode(
      () => aggregateComparisonCorpus(contributions, fresh),
      "PCAT-CMP-UNKNOWN-FAMILY",
    );
  });

  it("unknown-family-or-comparison-id refuses an ID outside D01-D09", () => {
    const contributions = makeFamilyContributions(populated).map((item) => {
      if (item.family !== "PRJ") return item;
      const forged = makeContribution("PRJ", populated, {
        cases: [
          {
            ...makeCase("PRJ", "PCAT-CMP-D04-BINDING-HISTORY", populated),
            comparisonId: "PCAT-CMP-D99-NOT-A-GATE" as ComparisonId,
          },
        ],
        sourceInventoryCount: 1,
      });
      return forged;
    });
    expectCode(
      () => aggregateComparisonCorpus(contributions, populated),
      "PCAT-CMP-UNKNOWN-COMPARISON-ID",
    );
  });

  it("checksum-or-canonical-order-drift refuses a mutated checksum", () => {
    const contributions = makeFamilyContributions(fresh).map((item) =>
      item.family === "CGH"
        ? { ...item, checksum: "0".repeat(64) }
        : item,
    );
    expectCode(
      () => aggregateComparisonCorpus(contributions, fresh),
      "PCAT-CMP-CHECKSUM-INVALID",
    );
  });

  it("checksum-or-canonical-order-drift refuses reordered cases", () => {
    const context = populated;
    const contributions = makeFamilyContributions(context).map((item) => {
      if (item.family !== "TOP") return item;
      const reversed = [...item.cases].reverse();
      const unsigned = { ...item, cases: reversed };
      return { ...unsigned, checksum: checksumComparisonContribution(unsigned) };
    });
    expectCode(
      () => aggregateComparisonCorpus(contributions, context),
      "PCAT-CMP-ORDER-DRIFT",
    );
  });

  it("sampled-populated-inventory refuses a truncated protected-reference set", () => {
    const contributions = makeFamilyContributions(populated).map((item) => {
      if (item.family !== "FIL") return item;
      const first = item.cases[0];
      if (!first) {
        throw new Error("expected FIL cases");
      }
      return makeContribution("FIL", populated, {
        cases: [first],
        sourceInventoryCount: 2,
      });
    });
    expectCode(
      () => aggregateComparisonCorpus(contributions, populated),
      "PCAT-CMP-SAMPLED-POPULATED",
    );
  });

  it("reused-pre-activation-after-p13 refuses pre-activation bytes on the post-p13 attempt", () => {
    const preContext = aggregationContext("fresh", "pre-activation", FRESH_PRE_SHA);
    const postContext = aggregationContext("fresh", "post-p13", FRESH_POST_SHA);
    const preContributions = makeFamilyContributions(preContext);
    expectCode(
      () => aggregateComparisonCorpus(preContributions, postContext),
      "PCAT-CMP-PHASE-REUSE",
    );
  });

  it("fresh-phase-without-real-postgres-zero-inventory refuses nonzero fresh cases", () => {
    const contributions = makeFamilyContributions(fresh).map((item) =>
      item.family === "MOD"
        ? makeContribution("MOD", fresh, {
            cases: [makeCase("MOD", "PCAT-CMP-D02-SUBJECT-IDENTITY", fresh)],
            sourceInventoryCount: 1,
          })
        : item,
    );
    expectCode(
      () => aggregateComparisonCorpus(contributions, fresh),
      "PCAT-CMP-FRESH-INVENTORY-NOT-ZERO",
    );
  });

  it("unexplained-or-unqueryable-nonzero refuses unexplained-difference", () => {
    const contributions = makeFamilyContributions(populated).map((item) =>
      item.family === "PRJ"
        ? makeContribution("PRJ", populated, {
            cases: [
              makeCase("PRJ", "PCAT-CMP-D04-BINDING-HISTORY", populated, "ref-1", "unexplained-difference"),
              makeCase("PRJ", "PCAT-CMP-D05-PROJECT-VALUE-PIN", populated),
            ],
            sourceInventoryCount: 1,
          })
        : item,
    );
    const corpus = aggregateComparisonCorpus(contributions, populated);
    expect(corpus.resultCounts["unexplained-difference"]).toBe(1);
    expectCode(
      () => generateComparisonReport(corpus),
      "PCAT-CMP-UNEXPLAINED-DIFFERENCE",
    );
  });

  it("unexplained-or-unqueryable-nonzero refuses unqueryable/protected-reference-missing", () => {
    const contributions = makeFamilyContributions(populated).map((item) =>
      item.family === "KNW"
        ? makeContribution("KNW", populated, {
            cases: [
              makeCase(
                "KNW",
                "PCAT-CMP-D07-PROTECTED-CONSUMER-REFERENCE",
                populated,
                "ref-1",
                "unqueryable/protected-reference-missing",
              ),
            ],
            sourceInventoryCount: 1,
          })
        : item,
    );
    const corpus = aggregateComparisonCorpus(contributions, populated);
    expect(corpus.resultCounts["unqueryable/protected-reference-missing"]).toBe(1);
    expectCode(
      () => generateComparisonReport(corpus),
      "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE",
    );
  });
});

describe("aggregateComparisonCorpus green path", () => {
  it("aggregates eleven fresh families into a zero-case corpus and passing report", () => {
    const context = aggregationContext("fresh", "pre-activation", FRESH_PRE_SHA);
    const corpus = aggregateComparisonCorpus(makeFamilyContributions(context), context);
    expect(corpus.cases).toEqual([]);
    expect(corpus.sourceInventoryCount).toBe(0);
    expect(Object.keys(corpus.familyChecksums)).toEqual([...COMPARISON_FAMILIES]);
    const report = generateComparisonReport(corpus);
    expect(report.decision).toBe("passed");
    expect(report.unexplainedDifferenceCount).toBe(0);
    expect(report.unqueryableProtectedReferenceCount).toBe(0);
    expect(report.gateCoverage).toHaveLength(9);
    expect(report.gateCoverage.every((gate) => gate.caseCount === 0)).toBe(true);
    expect(report.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it("aggregates populated families covering D01-D09 with zero unexplained and unqueryable", () => {
    const context = aggregationContext("populated", "pre-activation", POP_PRE_SHA);
    const corpus = aggregateComparisonCorpus(makeFamilyContributions(context), context);
    expect(corpus.cases.length).toBeGreaterThan(0);
    const covered = new Set(corpus.cases.map((item) => item.comparisonId));
    for (const comparisonId of [
      "PCAT-CMP-D01-DEFINITION-SEMANTICS",
      "PCAT-CMP-D02-SUBJECT-IDENTITY",
      "PCAT-CMP-D03-REGISTRATION-PLACEMENT",
      "PCAT-CMP-D04-BINDING-HISTORY",
      "PCAT-CMP-D05-PROJECT-VALUE-PIN",
      "PCAT-CMP-D06-REVIEW-PROPOSAL-OBSERVATION",
      "PCAT-CMP-D07-PROTECTED-CONSUMER-REFERENCE",
      "PCAT-CMP-D08-SOURCE-WRITEBACK",
      "PCAT-CMP-D09-LEGACY-OPERATOR-OUTCOME",
    ] as const) {
      expect(covered.has(comparisonId)).toBe(true);
    }
    const report = generateComparisonReport(corpus);
    expect(report.unexplainedDifferenceCount).toBe(0);
    expect(report.unqueryableProtectedReferenceCount).toBe(0);
    expect(report.resultCounts["unexplained-difference"]).toBe(0);
    expect(report.resultCounts["unqueryable/protected-reference-missing"]).toBe(0);
  });
});
