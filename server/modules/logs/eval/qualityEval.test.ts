import { describe, expect, it } from "vitest";

import { createAgentLoopLogAnalyzer } from "../analyzer/agentLoop";
import { createLogAnalyzerFromEnv } from "../analyzer/analyzerFromEnv";
import { createDeterministicLogAnalysisLoopModel } from "../analyzer/deterministicModel";
import { createScriptedLogAnalysisModel } from "../analyzer/scriptedModel";
import type { AnalyzeLogOutput, LogAnalysisAdapter } from "../analyzer";
import { emitLogTrace } from "../traceTypes";
import { defaultGoldenCasesRoot, loadGoldenLogCases, type GoldenLogCase } from "./goldenCases";
import {
  aggregateQualityResults,
  bindQualityPastConclusions,
  compareToQualityBaseline,
  createDeterministicQualityJudge,
  evaluateQualityCaseOutput,
  formatQualityComparisonMarkdown,
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
  it("credits literal Chinese report expectations and rejects different conclusions and actions", async () => {
    const judge = createDeterministicQualityJudge();
    const goldenCase = makeGoldenCase({ rootCausePoints: ["电池温度过高触发保护"], expectedActions: ["检查散热通道", "降温"] });
    const output = makeOutput({ conclusion: "电池温度过高触发保护", impact: "充电暂停", evidence: [], suggestedActions: ["检查散热通道", "降温"] });
    expect(await judge.score({ goldenCase, output })).toMatchObject({ rootCauseScore: 1, actionsScore: 1 });
    expect(await judge.score({ goldenCase, output: { ...output, conclusion: "网络异常", suggestedActions: ["检查网线"] } })).toMatchObject({ rootCauseScore: 0, actionsScore: 0 });
  });
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
  it("lets the history toggle change a trial with a confirmed case in the same domain", async () => {
    const candidate = makeGoldenCase({ id: "charging-power/current", realLog: true, deIdentified: true, scenarioTags: ["cascade"] });
    const prior = makeGoldenCase({ id: "charging-power/prior", realLog: true, deIdentified: true });
    const cases = [candidate, prior, makeGoldenCase({ id: "charging-power/unconfirmed" }),
      makeGoldenCase({ id: "other/prior", domain: "other", realLog: true, deIdentified: true })];
    for (const enabled of [false, true]) {
      const model = createScriptedLogAnalysisModel([
        { content: { action: "tool", tool: "search_past_conclusions", args: { query: "thermal foldback" } } },
        { content: { action: "tool", tool: "read_line_range", args: { startLine: 2, endLine: 3 } } },
        { content: { action: "final", conclusion: "Thermal foldback", impact: "Reduced current", severity: "Warning",
          confidence: 0.9, suggestedActions: ["Inspect cooling"], evidence: [{ lineNumbers: [2, 3], inference: "Foldback logged", suggestedAction: "Inspect cooling" }] } }
      ]);
      const analyzer = createLogAnalyzerFromEnv({ LOG_ANALYSIS_TOKEN_BUDGET: 100_000, LOG_ANALYSIS_API_TIMEOUT_MS: 1000,
        LOG_ANALYSIS_DETERMINISTIC: true, LOG_ANALYSIS_KERNEL: "loop", LOG_ANALYSIS_MAX_STEPS: 4,
        LOG_ANALYSIS_PROTOCOL: "json", LOG_ANALYSIS_PAST_CONCLUSIONS: enabled }, {
        model, bindOfflinePastConclusions: bindQualityPastConclusions(cases)
      });
      const judge = createDeterministicQualityJudge();
      let historicalRunIds: string[] | undefined;
      const report = await runQualityEval({ analyzer, judge: { ...judge, score: (input) => {
        historicalRunIds = input.output.historicalRunIds;
        return judge.score(input);
      } }, cases, tags: ["cascade"], problems: [], kernel: "loop", deterministic: true, modelLabel: "history", baseline: null });
      expect(report.problems).toEqual([]);
      expect(report.caseResults).toHaveLength(1);
      expect(historicalRunIds).toEqual(enabled ? [prior.id] : undefined);
    }
  });

  it("uses a register case's companion skill to execute and ground a decoded-event read", async () => {
    const { cases, problems } = loadGoldenLogCases(defaultGoldenCasesRoot());
    const goldenCase = cases.find((candidate) => candidate.scenarioTags.includes("register-decoding"))!;
    const line = goldenCase.rawLines.findIndex((raw) => raw.includes("rd 0x12 = 0x21")) + 1;
    expect(line).toBeGreaterThan(0);
    const model = createScriptedLogAnalysisModel([
      { content: { action: "tool", tool: "query_events", args: { extractor: "rail-status" } } },
      { content: { action: "final", conclusion: "The rail monitor latched overvoltage.", impact: "Charging stopped.",
        severity: "Warning", confidence: 0.9, suggestedActions: ["Inspect the rail"],
        evidence: [{ lineNumbers: [line], inference: "Bit 5 is set", suggestedAction: "Inspect the rail" }] } }
    ]);
    const analyzer = createAgentLoopLogAnalyzer({ model, modelLabel: "decoding", protocol: "json", maxSteps: 4, tokenBudget: 100_000 });
    const report = await runQualityEval({ analyzer, judge: createDeterministicQualityJudge(), cases: [goldenCase], problems,
      kernel: "loop", deterministic: true, modelLabel: "decoding", baseline: null });
    expect(report.problems).toEqual([]);
    expect(report.caseResults[0]).toMatchObject({ analysisSource: "agent", steps: 2, evidence: { hitLines: [line] } });
    expect(model.calls.at(-1)?.at(-1)?.content).toContain("latched_overvoltage");
  });

  it("filters cases, repeats each selected case, and aggregates quality and costs per tier and tag", async () => {
    const cases = [
      makeGoldenCase({ id: "charging-power/a", tier: "realistic", scenarioTags: ["cascade", "multi-file"] }),
      makeGoldenCase({ id: "charging-power/b", tier: "realistic", scenarioTags: ["generic-analysis", "multi-file"] }),
      makeGoldenCase({ id: "charging-power/c", tier: "realistic", scenarioTags: ["android"] }),
      makeGoldenCase({ id: "charging-power/d", tier: "synthetic", scenarioTags: ["cascade"] }),
      makeGoldenCase({ id: "charging-power/e", tier: "golden", realLog: true, deIdentified: true, scenarioTags: ["cascade"] })
    ];
    const measurements = [
      { latency: 10, tokens: 100 },
      { latency: 20, tokens: 300, convergence: "step-budget-exhausted" },
      { latency: 30, tokens: undefined },
      { latency: 100, tokens: 900, convergence: "token-budget-exhausted" }
    ] as const;
    let index = 0;
    let time = 0;
    const analyzer: LogAnalysisAdapter = {
      async analyze(input) {
        const trial = measurements[index++];
        time += trial.latency;
        await emitLogTrace(input, { kind: "model-turn", inputTokens: trial.tokens, outputTokens: 0 });
        if ("convergence" in trial) {
          await emitLogTrace(input, { kind: "early-convergence", reason: trial.convergence });
          await emitLogTrace(input, { kind: "model-turn", inputTokens: 30, outputTokens: 10 });
        }
        return makeOutput({
          degradedReason: "convergence" in trial ? trial.convergence : undefined,
          evidence: index === 2 ? [] : makeOutput().evidence
        });
      }
    };
    const report = await runQualityEval({
      analyzer, cases, trials: 2, tier: "realistic", tags: ["cascade", "generic-analysis"],
      judge: { label: "fixed", async score() {
        return { rootCauseScore: 0.8, categoryMatch: true, actionsScore: 0.7, reasoning: "fixed" };
      } },
      problems: [], kernel: "loop", deterministic: true, modelLabel: "fixed",
      baseline: {
        createdAt: "2026-08-13", kernel: "loop", promptVersion: "test.1", model: "fixed",
        realCaseAggregates: { caseCount: 1, rootCauseScoreMean: 1, evidenceRecallMean: 1 },
        tolerances: { rootCauseScoreMean: 0, evidenceRecallMean: 0 }
      },
      now: () => time, judgeSampleRate: 1
    });

    expect(report.problems).toEqual([]);
    expect(report.caseResults.map(({ id, trial, passed }) => [id, trial, passed])).toEqual([
      ["charging-power/a", 1, true], ["charging-power/a", 2, false],
      ["charging-power/b", 1, true], ["charging-power/b", 2, true]
    ]);
    expect(report.aggregates.realisticCases).toMatchObject({
      caseCount: 2, trialCount: 4, passAtK: 1, passPowerK: 0.5,
      steps: { median: 1.5, p95: 2, samples: 4 },
      tokens: { median: 340, p95: 940, samples: 3 },
      latencyMs: { median: 25, p95: 100, samples: 4 },
      degradedRate: 0.5, degradedRatesByReason: { "step-budget-exhausted": 0.25, "token-budget-exhausted": 0.25 },
      earlyConvergenceRate: 0.5
    });
    expect(report.aggregates.byTag).toMatchObject({
      cascade: { passAtK: 1, passPowerK: 0 },
      "generic-analysis": { passAtK: 1, passPowerK: 1 },
      "multi-file": { caseCount: 2, passAtK: 1, passPowerK: 0.5 }
    });
    expect(report.aggregates.realCases).toBeNull();
    expect(report.aggregates.syntheticCases).toBeNull();
    expect(report.baseline.status).toBe("not-run-filtered-golden-cases");
    expect(report.judgeSampling.sampledCaseIds).toEqual(["charging-power/a", "charging-power/b"]);

    const after = { ...report, modelLabel: "candidate" };
    const comparison = formatQualityComparisonMarkdown(report, after);
    expect(comparison).toContain("| model | fixed | candidate |");
    expect(comparison).toContain("| multi-file | 2 → 2 | 4 → 4 |");
    expect(comparison).toContain("340 / 940（n=3） → 340 / 940（n=3）");
    expect(() => formatQualityComparisonMarkdown(report, { ...after, caseResults: after.caseResults.slice(1) }))
      .toThrow("same cases and trials");
  });

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
    expect(report.caseResults).toHaveLength(cases.length);
    expect(report.aggregates.syntheticCases?.caseCount).toBeGreaterThanOrEqual(6);
    expect(report.aggregates.realisticCases?.caseCount).toBeGreaterThanOrEqual(3);
    expect(report.caseResults.find((item) => item.id === "service-jsonl/realistic-healthy-queue")?.refusal.appropriate).toBe(true);
    expect(report.caseResults.find((item) => item.id === "service-jsonl/realistic-healthy-queue")?.passed).toBe(true);
    // Grounding check keeps hallucinated citations out of the product; the metric must stay 0.
    expect(report.aggregates.all.hallucinationRate).toBe(0);
    // The nominal refusal case must be answered honestly by the deterministic kernel.
    expect(report.aggregates.syntheticCases?.refusalAppropriateRate).toBe(1);
    // The corpus has no golden cases, so the gate stays inactive and states why.
    expect(report.aggregates.realCases).toBeNull();
    expect(report.baseline.status).toBe("inactive-pending-real-cases");
    expect(report.baseline.note).toBe("quality baseline pending real cases");

    const markdown = formatQualityReportMarkdown(report);
    expect(markdown).toContain("quality baseline pending real cases");
    expect(markdown).toContain("`loop`");
    expect(markdown).toContain("## 中文摘要");
    expect(markdown).toContain(report.promptVersion);
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
    expect(report.caseResults[0].passed).toBe(false);
    expect(report.aggregates.all.rootCauseScoreMean).toBe(0.42);
    expect(report.baseline.status).toBe("not-configured");
  });

  it("scores the original files with file-aware citations and gates only golden results", async () => {
    const loaded = loadGoldenLogCases(defaultGoldenCasesRoot());
    expect(loaded.problems).toEqual([]);
    const bundle = loaded.cases.find((item) => item.id === "charging-power/realistic-thermal-foldback-bundle")!;
    const real = makeGoldenCase({ id: "charging-power/golden-case", realLog: true, deIdentified: true });
    const synthetic = makeGoldenCase();
    const analyzer: LogAnalysisAdapter = { async analyze(input) {
      if (!input.files) return makeOutput();
      expect(input.files.map((file) => file.path)).toEqual(["kernel.log", "thermal.log", "charger.log"]);
      const thermal = input.files[1].parsed!;
      expect(thermal.rawLines[7]).toContain("trip=45000");
      return makeOutput({ evidence: [
        { stageId: "rootcause", filePath: "thermal.log", lineNumbers: [8], inference: "Thermal threshold", suggestedAction: "Inspect" },
        { stageId: "rootcause", filePath: "charger.log", lineNumbers: [8], inference: "Current changed", suggestedAction: "Inspect" },
        { stageId: "rootcause", filePath: "missing.log", lineNumbers: [8], inference: "Invalid path", suggestedAction: "Inspect" }
      ] });
    } };
    const judge: LogAnalysisQualityJudge = { label: "test", async score({ goldenCase }) {
      const score = Number(goldenCase.realLog);
      return { rootCauseScore: score, categoryMatch: Boolean(score), actionsScore: score, reasoning: "test" };
    } };
    const report = await runQualityEval({ analyzer, judge, cases: [real, synthetic, bundle], problems: [], kernel: "loop", deterministic: true, modelLabel: "test",
      baseline: { createdAt: "2026-08-13", kernel: "loop", promptVersion: "test.1", model: "test",
        realCaseAggregates: { caseCount: 1, rootCauseScoreMean: 1, evidenceRecallMean: 1 },
        tolerances: { rootCauseScoreMean: 0, evidenceRecallMean: 0 } } });
    expect(report.problems).toEqual([]);
    expect(report.aggregates.realCases).toMatchObject({ caseCount: 1, rootCauseScoreMean: 1, evidenceRecallMean: 1 });
    expect(report.aggregates.realisticCases).toMatchObject({ caseCount: 1, rootCauseScoreMean: 0 });
    expect(report.aggregates.syntheticCases?.caseCount).toBe(1);
    expect(report.baseline.status).toBe("passed");
    expect(report.caseResults[2]).toMatchObject({ tier: "realistic", evidence: { hitLines: [40, 72], recall: 0.5 }, hallucination: { rate: 1 / 3 } });
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
