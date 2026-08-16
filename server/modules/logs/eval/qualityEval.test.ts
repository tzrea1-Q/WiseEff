import { describe, expect, it } from "vitest";

import { createAgentLoopLogAnalyzer } from "../analyzer/agentLoop";
import { createDeterministicLogAnalysisLoopModel } from "../analyzer/deterministicModel";
import type { AnalyzeLogOutput } from "../analyzer";
import { defaultGoldenCasesRoot, loadGoldenLogCases, type GoldenLogCase } from "./goldenCases";
import {
  aggregateQualityResults,
  compareToQualityBaseline,
  createDeterministicQualityJudge,
  evaluateQualityCaseOutput,
  formatQualityReportMarkdown,
  runQualityEval,
  type LogAnalysisQualityJudge,
  type QualityAggregates,
  type QualityBaselineFile
} from "./qualityEval";

function makeGoldenCase(overrides: Partial<GoldenLogCase> = {}): GoldenLogCase {
  const logText = [
    "2026-08-10T08:00:01Z INFO session start",
    "2026-08-10T08:00:02Z WARN thermal foldback engaged battery_temp=52C",
    "2026-08-10T08:00:03Z ERROR charge current reduced code=E_THERMAL_FOLDBACK",
    "2026-08-10T08:00:04Z INFO recovering"
  ].join("\n");
  return {
    id: "charging-power/test-case",
    caseDir: "/tmp/test-case",
    domain: "charging-power",
    summary: "test",
    realLog: false,
    deIdentified: undefined,
    rootCauseCategory: "thermal-protection",
    rootCausePoints: ["Thermal foldback reduced the charge current after the pack overheated."],
    keyEvidenceLines: [2, 3],
    expectedActions: ["Inspect the cooling path."],
    expectRefusal: false,
    analysisQuestion: undefined,
    logText,
    rawLines: logText.split("\n"),
    ...overrides
  };
}

function makeOutput(overrides: Partial<AnalyzeLogOutput> = {}): AnalyzeLogOutput {
  return {
    confidence: 0.85,
    conclusion: "Thermal foldback protection reduced charge output after the pack overheated.",
    impact: "Charging stays slow until the pack cools.",
    severity: "Warning",
    evidence: [
      {
        stageId: "rootcause",
        lineNumbers: [2, 3],
        inference: "Foldback engaged and current dropped.",
        suggestedAction: "Inspect the cooling path."
      }
    ],
    suggestedActions: ["Inspect the cooling path and thermal thresholds."],
    reportContext: { lineCount: 4, entryCount: 4 },
    analysisSource: "agent",
    promptVersion: "test.1",
    model: "test-model",
    ...overrides
  };
}

describe("evaluateQualityCaseOutput", () => {
  it("computes evidence overlap (hits, misses, extras) deterministically", () => {
    const result = evaluateQualityCaseOutput(
      makeGoldenCase(),
      makeOutput({
        evidence: [
          { stageId: "rootcause", lineNumbers: [2, 4], inference: "x", suggestedAction: "y" }
        ]
      }),
      { latencyMs: 5, judge: null, parsedLineNumbers: new Set([1, 2, 3, 4]) }
    );

    expect(result.evidence).toMatchObject({
      hitLines: [2],
      missedLines: [3],
      extraLines: [4],
      recall: 0.5,
      precision: 0.5
    });
    expect(result.hallucination.rate).toBe(0);
  });

  it("counts citations of nonexistent lines as hallucinations", () => {
    const result = evaluateQualityCaseOutput(
      makeGoldenCase(),
      makeOutput({
        evidence: [{ stageId: "rootcause", lineNumbers: [2, 999], inference: "x", suggestedAction: "y" }]
      }),
      { latencyMs: 5, judge: null, parsedLineNumbers: new Set([1, 2, 3, 4]) }
    );

    expect(result.hallucination.citedNonexistentLines).toEqual([999]);
    expect(result.hallucination.rate).toBe(0.5);
  });

  it("marks refusal appropriateness on expectRefusal cases via the confidence threshold", () => {
    const refusalCase = makeGoldenCase({
      expectRefusal: true,
      rootCausePoints: [],
      keyEvidenceLines: [],
      expectedActions: [],
      rootCauseCategory: "no-fault"
    });

    const honest = evaluateQualityCaseOutput(refusalCase, makeOutput({ confidence: 0.4 }), {
      latencyMs: 5,
      judge: null,
      parsedLineNumbers: new Set([1, 2, 3, 4])
    });
    expect(honest.refusal).toEqual({ expected: true, refused: true, appropriate: true });
    expect(honest.evidence).toBeNull();

    const fabricated = evaluateQualityCaseOutput(refusalCase, makeOutput({ confidence: 0.95 }), {
      latencyMs: 5,
      judge: null,
      parsedLineNumbers: new Set([1, 2, 3, 4])
    });
    expect(fabricated.refusal.appropriate).toBe(false);
  });
});

describe("deterministic rubric judge", () => {
  it("scores covered root causes and matched categories above missed ones", async () => {
    const judge = createDeterministicQualityJudge();
    const goldenCase = makeGoldenCase();

    const good = await judge.score({ goldenCase, output: makeOutput() });
    expect(good.rootCauseScore).toBe(1);
    expect(good.categoryMatch).toBe(true);

    const bad = await judge.score({
      goldenCase,
      output: makeOutput({
        conclusion: "The network switch dropped packets.",
        impact: "Unrelated.",
        evidence: [{ stageId: "rootcause", lineNumbers: [2], inference: "packet loss", suggestedAction: "check switch" }],
        suggestedActions: ["Replace the switch."]
      })
    });
    expect(bad.rootCauseScore).toBe(0);
    expect(bad.categoryMatch).toBe(false);
  });

  it("scores synonym restatements of expected actions as covered", async () => {
    const judge = createDeterministicQualityJudge();
    const goldenCase = makeGoldenCase({ expectedActions: ["Inspect the cooling path."] });
    const scored = await judge.score({
      goldenCase,
      output: makeOutput({
        suggestedActions: ["Check the thermal cooling loop."],
        evidence: [
          {
            stageId: "rootcause",
            lineNumbers: [2, 3],
            inference: "Foldback engaged and current dropped.",
            suggestedAction: "Check the thermal cooling loop."
          }
        ]
      })
    });

    expect(scored.actionsScore).toBe(1);
  });

  it("does not credit unrelated actions against a cooling-path expected action", async () => {
    const judge = createDeterministicQualityJudge();
    const goldenCase = makeGoldenCase({ expectedActions: ["Inspect the cooling path."] });
    const scored = await judge.score({
      goldenCase,
      output: makeOutput({
        suggestedActions: ["Replace the switch."],
        evidence: [
          {
            stageId: "rootcause",
            lineNumbers: [2],
            inference: "packet loss",
            suggestedAction: "Replace the switch."
          }
        ]
      })
    });

    expect(scored.actionsScore).toBe(0);
  });
});

describe("compareToQualityBaseline", () => {
  const baseAggregates: QualityAggregates = {
    caseCount: 10,
    evidenceRecallMean: 0.8,
    evidencePrecisionMean: 0.7,
    hallucinationRate: 0,
    rootCauseScoreMean: 0.75,
    categoryMatchRate: 0.9,
    actionsScoreMean: 0.6,
    refusalAppropriateRate: 1,
    degradedCount: 0
  };
  const baseline: QualityBaselineFile = {
    createdAt: "2026-08-13T00:00:00.000Z",
    kernel: "loop",
    promptVersion: "test.1",
    model: "test",
    tolerances: { rootCauseScoreMean: 0.02, evidenceRecallMean: 0.05 },
    realCaseAggregates: { caseCount: 10, rootCauseScoreMean: 0.75, evidenceRecallMean: 0.8 }
  };

  it("is not-configured without a baseline file", () => {
    expect(compareToQualityBaseline(null, baseAggregates).status).toBe("not-configured");
  });

  it("stays inactive and states 'pending real cases' while no real cases exist", () => {
    const pendingBaseline: QualityBaselineFile = { ...baseline, realCaseAggregates: null };
    const comparison = compareToQualityBaseline(pendingBaseline, null);
    expect(comparison.status).toBe("inactive-pending-real-cases");
    expect(comparison.note).toBe("quality baseline pending real cases");
  });

  it("passes when current real-case scores sit within tolerance", () => {
    const comparison = compareToQualityBaseline(baseline, {
      ...baseAggregates,
      rootCauseScoreMean: 0.74,
      evidenceRecallMean: 0.76
    });
    expect(comparison.status).toBe("passed");
    expect(comparison.metrics?.every((metric) => metric.pass)).toBe(true);
  });

  it("fails when a real-case score drops below baseline minus tolerance", () => {
    const comparison = compareToQualityBaseline(baseline, {
      ...baseAggregates,
      rootCauseScoreMean: 0.7
    });
    expect(comparison.status).toBe("failed");
    expect(comparison.metrics?.find((metric) => metric.metric === "rootCauseScoreMean")?.pass).toBe(false);
  });
});

describe("runQualityEval (deterministic end-to-end)", () => {
  it("runs the committed seed set with the deterministic loop kernel and zero hallucinations", async () => {
    const { cases, problems } = loadGoldenLogCases(defaultGoldenCasesRoot());
    const analyzer = createAgentLoopLogAnalyzer({
      model: createDeterministicLogAnalysisLoopModel(),
      modelLabel: "deterministic",
      tokenBudget: 100_000,
      maxSteps: 6
    });

    const report = await runQualityEval({
      analyzer,
      judge: createDeterministicQualityJudge(),
      cases,
      problems,
      kernel: "loop",
      deterministic: true,
      modelLabel: "deterministic",
      baseline: {
        createdAt: "2026-08-13T00:00:00.000Z",
        kernel: "loop",
        promptVersion: "test.1",
        model: "deterministic",
        tolerances: { rootCauseScoreMean: 0.02, evidenceRecallMean: 0.05 },
        realCaseAggregates: null
      }
    });

    expect(report.problems).toEqual([]);
    expect(report.caseResults.length).toBeGreaterThanOrEqual(6);
    // Grounding check keeps hallucinated citations out of the product; the metric must stay 0.
    expect(report.aggregates.all.hallucinationRate).toBe(0);
    // The nominal refusal case must be answered honestly by the deterministic kernel.
    expect(report.aggregates.all.refusalAppropriateRate).toBe(1);
    // Seed set is synthetic-only, so the gate stays inactive and states why.
    expect(report.aggregates.realCases).toBeNull();
    expect(report.baseline.status).toBe("inactive-pending-real-cases");
    expect(report.baseline.note).toBe("quality baseline pending real cases");

    const markdown = formatQualityReportMarkdown(report);
    expect(markdown).toContain("quality baseline pending real cases");
    expect(markdown).toContain("`loop`");
  });

  it("pipes a scriptable judge stub's scores into the report", async () => {
    const scriptedJudge: LogAnalysisQualityJudge = {
      label: "scripted-judge-stub",
      score: async () => ({ rootCauseScore: 0.42, categoryMatch: true, actionsScore: 0.24, reasoning: "scripted" })
    };
    const goldenCase = makeGoldenCase();
    const analyzer = createAgentLoopLogAnalyzer({
      model: createDeterministicLogAnalysisLoopModel(),
      modelLabel: "deterministic",
      tokenBudget: 100_000,
      maxSteps: 6
    });

    const report = await runQualityEval({
      analyzer,
      judge: scriptedJudge,
      cases: [goldenCase],
      problems: [],
      kernel: "loop",
      deterministic: true,
      modelLabel: "deterministic",
      baseline: null
    });

    expect(report.judgeLabel).toBe("scripted-judge-stub");
    expect(report.caseResults[0].judge).toMatchObject({ rootCauseScore: 0.42, actionsScore: 0.24 });
    expect(report.aggregates.all.rootCauseScoreMean).toBe(0.42);
    expect(report.baseline.status).toBe("not-configured");
  });

  it("aggregates real and synthetic cases separately", () => {
    const realResult = evaluateQualityCaseOutput(makeGoldenCase({ realLog: true, deIdentified: true }), makeOutput(), {
      latencyMs: 1,
      judge: { rootCauseScore: 1, categoryMatch: true, actionsScore: 1, reasoning: "r" },
      parsedLineNumbers: new Set([1, 2, 3, 4])
    });
    const aggregates = aggregateQualityResults([realResult]);
    expect(aggregates.caseCount).toBe(1);
    expect(aggregates.rootCauseScoreMean).toBe(1);
    expect(aggregates.refusalAppropriateRate).toBeNull();
  });
});
