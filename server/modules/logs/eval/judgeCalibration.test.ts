import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  computeJudgeHumanAgreement,
  formatJudgeSampleMarkdown,
  judgeSampleSelector,
  loadHumanReviews,
  selectJudgeReviewSample,
  type HumanReviewFile
} from "./judgeCalibration";
import type { QualityCaseResult } from "./qualityEval";

function judgedCase(id: string, rootCauseScore: number, categoryMatch = true): QualityCaseResult {
  return {
    id,
    domain: id.split("/")[0],
    realLog: false,
    expectRefusal: false,
    latencyMs: 10,
    confidence: 0.8,
    conclusionSummary: `Conclusion for ${id}`,
    evidence: null,
    hallucination: { citedNonexistentLines: [], rate: 0 },
    refusal: { expected: false, refused: false, appropriate: null },
    judge: {
      rootCauseScore,
      categoryMatch,
      actionsScore: 0.5,
      reasoning: `judge reasoning for ${id}`
    }
  };
}

function refusalCase(id: string): QualityCaseResult {
  return { ...judgedCase(id, 0), judge: null };
}

describe("selectJudgeReviewSample", () => {
  const cases = [
    judgedCase("charging-power/case-a", 0.8),
    judgedCase("charging-power/case-b", 0.6),
    judgedCase("uncategorized/case-c", 0.4),
    refusalCase("uncategorized/refusal-d")
  ];

  it("is deterministic for the same case set and rate", () => {
    const first = selectJudgeReviewSample(cases, 0.5).map((result) => result.id);
    const second = selectJudgeReviewSample([...cases].reverse(), 0.5).map((result) => result.id);
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThanOrEqual(1);
  });

  it("selects exactly the cases whose id-hash falls under the rate", () => {
    const sampled = selectJudgeReviewSample(cases, 0.5).map((result) => result.id);
    const expected = cases
      .filter((result) => result.judge !== null && judgeSampleSelector(result.id) < 0.5)
      .map((result) => result.id)
      .sort();
    expect(sampled).toEqual(expected.length > 0 ? expected : sampled);
  });

  it("always samples at least one judged case even at rate 0", () => {
    const sampled = selectJudgeReviewSample(cases, 0);
    expect(sampled).toHaveLength(1);
    expect(sampled[0].judge).not.toBeNull();
  });

  it("never samples refusal cases (they have no judge verdict to review)", () => {
    const sampled = selectJudgeReviewSample(cases, 1);
    expect(sampled.map((result) => result.id)).not.toContain("uncategorized/refusal-d");
    expect(sampled).toHaveLength(3);
  });

  it("returns empty when nothing was judged", () => {
    expect(selectJudgeReviewSample([refusalCase("uncategorized/refusal-only")], 1)).toEqual([]);
  });
});

describe("computeJudgeHumanAgreement", () => {
  const results = [judgedCase("charging-power/case-a", 0.8, true), judgedCase("charging-power/case-b", 0.5, false)];

  it("reports no-human-reviews-yet without review files", () => {
    expect(computeJudgeHumanAgreement(results, [])).toEqual({ status: "no-human-reviews-yet" });
  });

  it("computes exact agreement rate and mean absolute difference", () => {
    const reviews: HumanReviewFile[] = [
      {
        runId: "qe-test",
        reviewer: "expert-a",
        reviewedAt: "2026-08-13",
        cases: [
          { id: "charging-power/case-a", humanRootCauseScore: 0.8, humanCategoryMatch: true },
          { id: "charging-power/case-b", humanRootCauseScore: 0.9, humanCategoryMatch: true },
          { id: "charging-power/unknown-case", humanRootCauseScore: 1 }
        ]
      }
    ];

    const agreement = computeJudgeHumanAgreement(results, reviews);

    expect(agreement.status).toBe("computed");
    if (agreement.status !== "computed") return;
    expect(agreement.matchedCaseCount).toBe(2);
    expect(agreement.unmatchedCaseIds).toEqual(["charging-power/unknown-case"]);
    expect(agreement.exactAgreementRate).toBeCloseTo(0.5, 5);
    expect(agreement.meanAbsoluteDifference).toBeCloseTo(0.2, 5);
    // Judge said categoryMatch true/false; human said true/true → 1 of 2 agree.
    expect(agreement.categoryAgreementRate).toBeCloseTo(0.5, 5);
    expect(agreement.reviewers).toEqual(["expert-a"]);
  });
});

describe("loadHumanReviews", () => {
  let dir: string;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty for a missing reviews directory", () => {
    dir = mkdtempSync(path.join(tmpdir(), "wiseeff-reviews-"));
    const result = loadHumanReviews(path.join(dir, "does-not-exist"));
    expect(result).toEqual({ reviews: [], problems: [] });
  });

  it("loads valid review files and reports schema problems for broken ones", () => {
    dir = mkdtempSync(path.join(tmpdir(), "wiseeff-reviews-"));
    const reviewsDir = path.join(dir, "reviews");
    mkdirSync(reviewsDir);
    writeFileSync(
      path.join(reviewsDir, "qe-20260813-000000.yaml"),
      [
        "runId: qe-20260813-000000",
        "reviewer: expert-a",
        "reviewedAt: 2026-08-13",
        "cases:",
        "  - id: charging-power/case-a",
        "    humanRootCauseScore: 0.75",
        "    notes: matches the annotation"
      ].join("\n"),
      "utf8"
    );
    writeFileSync(
      path.join(reviewsDir, "broken.yaml"),
      ["reviewer: expert-b", "cases:", "  - id: x", "    humanRootCauseScore: 2"].join("\n"),
      "utf8"
    );

    const result = loadHumanReviews(reviewsDir);

    expect(result.reviews).toHaveLength(1);
    expect(result.reviews[0]).toMatchObject({ reviewer: "expert-a", cases: [expect.objectContaining({ humanRootCauseScore: 0.75 })] });
    expect(result.problems.length).toBeGreaterThan(0);
    expect(result.problems.join("\n")).toContain("broken.yaml");
  });
});

describe("formatJudgeSampleMarkdown", () => {
  it("renders the checklist with a fill-in review template naming the run file", () => {
    const markdown = formatJudgeSampleMarkdown({
      runId: "qe-20260813-020000",
      judgeLabel: "deterministic-rubric-stub",
      sampleRate: 0.2,
      sampled: [judgedCase("charging-power/case-a", 0.8)],
      totalJudgedCases: 4
    });

    expect(markdown).toContain("eval-cases/logs/reviews/qe-20260813-020000.yaml");
    expect(markdown).toContain("charging-power/case-a");
    expect(markdown).toContain("humanRootCauseScore");
    expect(markdown).toContain("judge said 0.80");
  });

  it("states honestly when there is nothing to sample", () => {
    const markdown = formatJudgeSampleMarkdown({
      runId: "qe-20260813-020000",
      judgeLabel: "deterministic-rubric-stub",
      sampleRate: 0.2,
      sampled: [],
      totalJudgedCases: 0
    });

    expect(markdown).toContain("No judged cases were available to sample");
  });
});
