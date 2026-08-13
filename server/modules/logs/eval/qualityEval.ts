import { z } from "zod";

import type { AnalyzeLogOutput, LogAnalysisAdapter } from "../analyzer";
import { parseLogText } from "../parser";
import { analyzeWithDegradation } from "../worker";
import type { GoldenLogCase, LogEvalRootCauseCategory } from "./goldenCases";
import {
  computeJudgeHumanAgreement,
  selectJudgeReviewSample,
  type HumanReviewFile,
  type JudgeHumanAgreement
} from "./judgeCalibration";

/**
 * Quality-layer eval (glossary: Quality-layer eval): scores golden-case runs of
 * the CURRENT kernel. Deterministic metrics (evidence-line overlap, hallucination
 * rate, refusal appropriateness) are computed in-process; root-cause correctness
 * goes through a rubric-guided judge seam — an LLM in real mode, a deterministic
 * scriptable stub in offline mode. Only `realLog: true` cases count toward the
 * baseline gate; synthetic cases document format coverage.
 */

/** A conclusion at or below this confidence counts as an honest refusal / low-confidence answer. */
export const QUALITY_REFUSAL_CONFIDENCE_THRESHOLD = 0.5;

export type QualityJudgeScore = {
  /** 0..1 — how well the conclusion covers the expert root-cause points. */
  rootCauseScore: number;
  /** Whether the conclusion lands in the case's eval-only root-cause category. */
  categoryMatch: boolean;
  /** 0..1 — how well suggested actions cover the expected actions. */
  actionsScore: number;
  /** Short judge reasoning for sampled human review; never raw prompts. */
  reasoning: string;
};

export type LogAnalysisQualityJudge = {
  label: string;
  score(input: { goldenCase: GoldenLogCase; output: AnalyzeLogOutput }): Promise<QualityJudgeScore>;
};

export const qualityJudgeOutputSchema = z.object({
  rootCauseScore: z.number().min(0).max(1),
  categoryMatch: z.boolean(),
  actionsScore: z.number().min(0).max(1),
  reasoning: z.string().min(1).max(600)
});

const STOP_TOKENS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "was", "is", "are",
  "were", "be", "been", "after", "before", "during", "its", "it", "this", "that", "from"
]);

function significantTokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9_]+/g) ?? []).filter(
    (token) => token.length > 2 && !STOP_TOKENS.has(token)
  );
}

function coverageScore(targets: string[], candidateText: string): number {
  if (targets.length === 0) {
    return 0;
  }
  const candidateTokens = new Set(significantTokens(candidateText));
  let covered = 0;
  for (const target of targets) {
    const tokens = significantTokens(target);
    if (tokens.length === 0) {
      continue;
    }
    const hitRatio = tokens.filter((token) => candidateTokens.has(token)).length / tokens.length;
    if (hitRatio >= 0.4) {
      covered += 1;
    }
  }
  return covered / targets.length;
}

const categoryKeywords: Record<LogEvalRootCauseCategory, RegExp> = {
  "thermal-protection": /thermal|foldback|overheat|temperature/i,
  "communication-failure": /timeout|communication|retry|no response/i,
  "device-unavailable": /offline|unavailable|disconnect/i,
  "power-delivery-degradation": /current reduced|reduced current|charge current|power deliver/i,
  "configuration-error": /config|configuration|parameter mismatch/i,
  "hardware-fault": /hardware|component|sensor fault/i,
  "software-fault": /software|schema|error code|exception|crash/i,
  "no-fault": /nominal|no known anomaly|no fault|looks normal/i,
  "insufficient-evidence": /insufficient|inconclusive|not enough evidence/i
};

/**
 * Deterministic rubric stub for offline runs: token-coverage scoring against the
 * annotation plus a keyword bucket check. Crude by design — its job is to make
 * the quality pipeline runnable and testable at zero API cost, not to replace
 * the real judge. Tests may inject any `LogAnalysisQualityJudge` instead.
 */
export function createDeterministicQualityJudge(): LogAnalysisQualityJudge {
  return {
    label: "deterministic-rubric-stub",
    async score({ goldenCase, output }) {
      const conclusionText = [output.conclusion, output.impact, ...output.evidence.map((item) => item.inference)].join("\n");
      const actionsText = [...output.suggestedActions, ...output.evidence.map((item) => item.suggestedAction)].join("\n");
      const rootCauseScore = coverageScore(goldenCase.rootCausePoints, conclusionText);
      const actionsScore = coverageScore(goldenCase.expectedActions, actionsText);
      const categoryMatch = categoryKeywords[goldenCase.rootCauseCategory].test(conclusionText);
      return {
        rootCauseScore,
        actionsScore,
        categoryMatch,
        reasoning: `deterministic rubric: root-cause coverage ${rootCauseScore.toFixed(2)}, actions coverage ${actionsScore.toFixed(2)}, category ${categoryMatch ? "matched" : "missed"}`
      };
    }
  };
}

export type QualityEvidenceMetrics = {
  expectedLines: number[];
  citedLines: number[];
  hitLines: number[];
  missedLines: number[];
  extraLines: number[];
  recall: number;
  precision: number;
};

export type QualityCaseResult = {
  id: string;
  domain: string;
  realLog: boolean;
  expectRefusal: boolean;
  analysisSource?: string;
  degradedReason?: string;
  model?: string;
  promptVersion?: string;
  latencyMs: number;
  confidence: number;
  /** Truncated agent conclusion for the human review checklist (never raw log content). */
  conclusionSummary: string;
  /** Present for non-refusal cases only. */
  evidence: QualityEvidenceMetrics | null;
  hallucination: { citedNonexistentLines: number[]; rate: number };
  refusal: { expected: boolean; refused: boolean; appropriate: boolean | null };
  judge: QualityJudgeScore | null;
};

export type QualityAggregates = {
  caseCount: number;
  evidenceRecallMean: number | null;
  evidencePrecisionMean: number | null;
  hallucinationRate: number;
  rootCauseScoreMean: number | null;
  categoryMatchRate: number | null;
  actionsScoreMean: number | null;
  refusalAppropriateRate: number | null;
  degradedCount: number;
};

export const qualityBaselineFileSchema = z.object({
  note: z.string().optional(),
  createdAt: z.string().min(1),
  kernel: z.string().min(1),
  promptVersion: z.string().min(1),
  model: z.string().min(1),
  tolerances: z.object({
    rootCauseScoreMean: z.number().min(0).max(1),
    evidenceRecallMean: z.number().min(0).max(1)
  }),
  realCaseAggregates: z
    .object({
      caseCount: z.number().int().min(0),
      rootCauseScoreMean: z.number().min(0).max(1).nullable(),
      evidenceRecallMean: z.number().min(0).max(1).nullable()
    })
    .nullable()
});

export type QualityBaselineFile = z.infer<typeof qualityBaselineFileSchema>;

export type QualityBaselineComparison = {
  status: "not-configured" | "inactive-pending-real-cases" | "passed" | "failed";
  note: string;
  tolerances?: QualityBaselineFile["tolerances"];
  metrics?: Array<{
    metric: "rootCauseScoreMean" | "evidenceRecallMean";
    baseline: number | null;
    current: number | null;
    tolerance: number;
    pass: boolean;
  }>;
};

export type QualityEvalReport = {
  generatedAt: string;
  /** Stable id (`qe-YYYYMMDD-HHMMSS`) linking the report, sample checklist, and review files. */
  runId: string;
  kernel: "loop" | "single-shot";
  deterministic: boolean;
  modelLabel: string;
  judgeLabel: string;
  caseResults: QualityCaseResult[];
  aggregates: {
    all: QualityAggregates;
    realCases: QualityAggregates | null;
    syntheticCases: QualityAggregates | null;
  };
  baseline: QualityBaselineComparison;
  /** Judge calibration (P3b): deterministic human-review sample + judge-human agreement. */
  judgeSampling: { rate: number; sampledCaseIds: string[] };
  humanAgreement: JudgeHumanAgreement;
  problems: string[];
};

function mean(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function aggregateQualityResults(results: QualityCaseResult[]): QualityAggregates {
  const evidence = results.filter((result) => result.evidence !== null);
  const judged = results.filter((result) => result.judge !== null);
  const refusals = results.filter((result) => result.refusal.expected);
  const totalCited = results.reduce(
    (total, result) => total + (result.evidence?.citedLines.length ?? 0) + result.hallucination.citedNonexistentLines.length,
    0
  );
  const totalHallucinated = results.reduce((total, result) => total + result.hallucination.citedNonexistentLines.length, 0);

  return {
    caseCount: results.length,
    evidenceRecallMean: mean(evidence.map((result) => result.evidence!.recall)),
    evidencePrecisionMean: mean(evidence.map((result) => result.evidence!.precision)),
    hallucinationRate: totalCited === 0 ? 0 : totalHallucinated / totalCited,
    rootCauseScoreMean: mean(judged.map((result) => result.judge!.rootCauseScore)),
    categoryMatchRate: judged.length === 0 ? null : judged.filter((result) => result.judge!.categoryMatch).length / judged.length,
    actionsScoreMean: mean(judged.map((result) => result.judge!.actionsScore)),
    refusalAppropriateRate:
      refusals.length === 0 ? null : refusals.filter((result) => result.refusal.appropriate === true).length / refusals.length,
    degradedCount: results.filter((result) => result.degradedReason !== undefined).length
  };
}

/**
 * Baseline gate: with a committed baseline AND real cases in both runs, the
 * current realLog aggregates must not fall below baseline minus the stated
 * tolerance. With no real cases yet, the gate stays inactive and says so.
 */
export function compareToQualityBaseline(
  baseline: QualityBaselineFile | null,
  realCaseAggregates: QualityAggregates | null
): QualityBaselineComparison {
  if (!baseline) {
    return { status: "not-configured", note: "No baseline.json committed; run recorded without gating." };
  }
  if (!baseline.realCaseAggregates || !realCaseAggregates || realCaseAggregates.caseCount === 0) {
    return {
      status: "inactive-pending-real-cases",
      note: "quality baseline pending real cases",
      tolerances: baseline.tolerances
    };
  }

  const metrics: NonNullable<QualityBaselineComparison["metrics"]> = (
    [
      ["rootCauseScoreMean", baseline.tolerances.rootCauseScoreMean],
      ["evidenceRecallMean", baseline.tolerances.evidenceRecallMean]
    ] as const
  ).map(([metric, tolerance]) => {
    const baselineValue = baseline.realCaseAggregates![metric];
    const currentValue = realCaseAggregates[metric];
    const pass =
      baselineValue === null || currentValue === null ? true : currentValue >= baselineValue - tolerance;
    return { metric, baseline: baselineValue, current: currentValue, tolerance, pass };
  });

  const failed = metrics.some((entry) => !entry.pass);
  return {
    status: failed ? "failed" : "passed",
    note: failed
      ? "Real-case quality fell below the committed baseline minus tolerance."
      : "Real-case quality is within tolerance of the committed baseline.",
    tolerances: baseline.tolerances,
    metrics
  };
}

export function evaluateQualityCaseOutput(
  goldenCase: GoldenLogCase,
  output: AnalyzeLogOutput,
  extras: { latencyMs: number; judge: QualityJudgeScore | null; parsedLineNumbers: Set<number> }
): QualityCaseResult {
  const citedAll = [...new Set(output.evidence.flatMap((item) => item.lineNumbers))].sort((left, right) => left - right);
  const citedNonexistentLines = citedAll.filter((lineNumber) => !extras.parsedLineNumbers.has(lineNumber));
  const citedExisting = citedAll.filter((lineNumber) => extras.parsedLineNumbers.has(lineNumber));

  let evidence: QualityEvidenceMetrics | null = null;
  if (!goldenCase.expectRefusal) {
    const expected = new Set(goldenCase.keyEvidenceLines);
    const hitLines = citedExisting.filter((lineNumber) => expected.has(lineNumber));
    const missedLines = goldenCase.keyEvidenceLines.filter((lineNumber) => !citedExisting.includes(lineNumber));
    const extraLines = citedExisting.filter((lineNumber) => !expected.has(lineNumber));
    evidence = {
      expectedLines: goldenCase.keyEvidenceLines,
      citedLines: citedExisting,
      hitLines,
      missedLines,
      extraLines,
      recall: goldenCase.keyEvidenceLines.length === 0 ? 0 : hitLines.length / goldenCase.keyEvidenceLines.length,
      precision: citedExisting.length === 0 ? 0 : hitLines.length / citedExisting.length
    };
  }

  const refused = output.confidence <= QUALITY_REFUSAL_CONFIDENCE_THRESHOLD;
  const conclusion = output.conclusion.trim().replace(/\s+/g, " ");
  return {
    id: goldenCase.id,
    domain: goldenCase.domain,
    realLog: goldenCase.realLog,
    expectRefusal: goldenCase.expectRefusal,
    analysisSource: output.analysisSource,
    degradedReason: output.degradedReason,
    model: output.model,
    promptVersion: output.promptVersion,
    latencyMs: extras.latencyMs,
    confidence: output.confidence,
    conclusionSummary: conclusion.length > 300 ? `${conclusion.slice(0, 299)}…` : conclusion,
    evidence,
    hallucination: {
      citedNonexistentLines,
      rate: citedAll.length === 0 ? 0 : citedNonexistentLines.length / citedAll.length
    },
    refusal: {
      expected: goldenCase.expectRefusal,
      refused,
      appropriate: goldenCase.expectRefusal ? refused : null
    },
    judge: extras.judge
  };
}

export type RunQualityEvalOptions = {
  analyzer: LogAnalysisAdapter;
  judge: LogAnalysisQualityJudge;
  cases: GoldenLogCase[];
  problems: string[];
  kernel: "loop" | "single-shot";
  deterministic: boolean;
  modelLabel: string;
  baseline: QualityBaselineFile | null;
  /** Deterministic human-review sampling rate (LOG_ANALYSIS_JUDGE_SAMPLE_RATE, default 0.2). */
  judgeSampleRate?: number;
  /** Committed review files from eval-cases/logs/reviews; empty = "no human reviews yet". */
  humanReviews?: HumanReviewFile[];
  now?: () => number;
};

function qualityRunId(generatedAt: string): string {
  return `qe-${generatedAt.replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-")}`;
}

export async function runQualityEval(options: RunQualityEvalOptions): Promise<QualityEvalReport> {
  const now = options.now ?? (() => Date.now());
  const caseResults: QualityCaseResult[] = [];
  const problems = [...options.problems];

  for (const goldenCase of options.cases) {
    const parsed = parseLogText(
      { fileName: "log.txt", content: goldenCase.logText },
      goldenCase.formatProfile ? { profile: goldenCase.formatProfile } : {}
    );
    if (!parsed.ok) {
      problems.push(`${goldenCase.id}: log.txt failed to parse (${parsed.reason})`);
      continue;
    }

    const startedAtMs = now();
    let output: AnalyzeLogOutput;
    try {
      // attemptCount MAX_SAFE_INTEGER: a provider failure degrades immediately to
      // the honest rules fallback instead of crashing the whole eval run.
      output = await analyzeWithDegradation({
        analyzer: options.analyzer,
        analyzeInput: {
          parsed,
          analysisQuestion: goldenCase.analysisQuestion,
          logDomain: goldenCase.domain === "uncategorized" ? undefined : { name: goldenCase.domain }
        },
        job: { attemptCount: Number.MAX_SAFE_INTEGER },
        maxAttempts: 1,
        retryBaseDelayMs: 1,
        now: () => new Date(now())
      });
    } catch (error) {
      problems.push(`${goldenCase.id}: analysis threw (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    const latencyMs = Math.max(0, now() - startedAtMs);

    const judge = goldenCase.expectRefusal ? null : await options.judge.score({ goldenCase, output });
    caseResults.push(
      evaluateQualityCaseOutput(goldenCase, output, {
        latencyMs,
        judge,
        parsedLineNumbers: new Set(parsed.entries.map((entry) => entry.lineNumber))
      })
    );
  }

  const realResults = caseResults.filter((result) => result.realLog);
  const syntheticResults = caseResults.filter((result) => !result.realLog);
  const realAggregates = realResults.length > 0 ? aggregateQualityResults(realResults) : null;
  const generatedAt = new Date().toISOString();
  const judgeSampleRate = options.judgeSampleRate ?? 0.2;

  return {
    generatedAt,
    runId: qualityRunId(generatedAt),
    kernel: options.kernel,
    deterministic: options.deterministic,
    modelLabel: options.modelLabel,
    judgeLabel: options.judge.label,
    caseResults,
    aggregates: {
      all: aggregateQualityResults(caseResults),
      realCases: realAggregates,
      syntheticCases: syntheticResults.length > 0 ? aggregateQualityResults(syntheticResults) : null
    },
    baseline: compareToQualityBaseline(options.baseline, realAggregates),
    judgeSampling: {
      rate: judgeSampleRate,
      sampledCaseIds: selectJudgeReviewSample(caseResults, judgeSampleRate).map((result) => result.id)
    },
    humanAgreement: computeJudgeHumanAgreement(caseResults, options.humanReviews ?? []),
    problems
  };
}

function formatRatio(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(3);
}

export function formatQualityReportMarkdown(report: QualityEvalReport): string {
  const lines = [
    "# Log Analysis Quality Eval Report",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Run id: \`${report.runId}\``,
    `- Kernel: \`${report.kernel}\`${report.deterministic ? " (deterministic mode)" : ""}`,
    `- Model: \`${report.modelLabel}\``,
    `- Judge: \`${report.judgeLabel}\``,
    `- Cases: ${report.caseResults.length} (${report.caseResults.filter((result) => result.realLog).length} real, ${report.caseResults.filter((result) => !result.realLog).length} synthetic)`,
    "",
    "## Aggregates",
    "",
    "| Scope | Cases | Evidence recall | Evidence precision | Hallucination rate | Root-cause score | Category match | Actions score | Refusal appropriate | Degraded |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"
  ];

  const scopes: Array<[string, QualityAggregates | null]> = [
    ["all", report.aggregates.all],
    ["realLog: true", report.aggregates.realCases],
    ["realLog: false (format coverage)", report.aggregates.syntheticCases]
  ];
  for (const [label, aggregates] of scopes) {
    if (!aggregates) {
      lines.push(`| ${label} | 0 | — | — | — | — | — | — | — | — |`);
      continue;
    }
    lines.push(
      `| ${label} | ${aggregates.caseCount} | ${formatRatio(aggregates.evidenceRecallMean)} | ${formatRatio(aggregates.evidencePrecisionMean)} | ${formatRatio(aggregates.hallucinationRate)} | ${formatRatio(aggregates.rootCauseScoreMean)} | ${formatRatio(aggregates.categoryMatchRate)} | ${formatRatio(aggregates.actionsScoreMean)} | ${formatRatio(aggregates.refusalAppropriateRate)} | ${aggregates.degradedCount} |`
    );
  }

  lines.push(
    "",
    "## Baseline gate",
    "",
    `- Status: **${report.baseline.status}** — ${report.baseline.note}`
  );
  if (report.baseline.tolerances) {
    lines.push(
      `- Tolerances: root-cause score −${report.baseline.tolerances.rootCauseScoreMean}, evidence recall −${report.baseline.tolerances.evidenceRecallMean}`
    );
  }
  if (report.baseline.metrics) {
    lines.push("", "| Metric | Baseline | Current | Tolerance | Result |", "| --- | --- | --- | --- | --- |");
    for (const metric of report.baseline.metrics) {
      lines.push(
        `| ${metric.metric} | ${formatRatio(metric.baseline)} | ${formatRatio(metric.current)} | ${metric.tolerance} | ${metric.pass ? "PASS" : "FAIL"} |`
      );
    }
  }

  // Fixed judge-calibration section: sampling always reported; agreement is
  // computed when review files exist, otherwise honestly "no human reviews yet".
  lines.push(
    "",
    "## Judge calibration",
    "",
    `- Human-review sample (deterministic, rate ${report.judgeSampling.rate}): ${report.judgeSampling.sampledCaseIds.length > 0 ? report.judgeSampling.sampledCaseIds.map((id) => `\`${id}\``).join(", ") : "none (no judged cases)"} — checklist in \`docs/generated/log-analysis-judge-sample.md\``
  );
  if (report.humanAgreement.status === "no-human-reviews-yet") {
    lines.push(
      `- Judge-human agreement: **no human reviews yet** — commit \`eval-cases/logs/reviews/${report.runId}.yaml\` from the checklist template to activate this metric.`
    );
  } else {
    const agreement = report.humanAgreement;
    lines.push(
      `- Judge-human agreement (${agreement.matchedCaseCount} reviewed case(s), reviewers: ${agreement.reviewers.join(", ")}):`,
      `  - Exact agreement rate (identical scores): ${formatRatio(agreement.exactAgreementRate)}`,
      `  - Mean absolute difference: ${formatRatio(agreement.meanAbsoluteDifference)}`,
      `  - Category agreement rate: ${formatRatio(agreement.categoryAgreementRate)}`
    );
    if (agreement.unmatchedCaseIds.length > 0) {
      lines.push(`  - Reviews referencing unknown/unjudged cases (ignored): ${agreement.unmatchedCaseIds.join(", ")}`);
    }
  }

  lines.push(
    "",
    "## Case results",
    "",
    "| Case | Real | Source | Degraded | Latency (ms) | Evidence recall | Hallucination | Root-cause | Category | Refusal |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"
  );
  for (const result of report.caseResults) {
    lines.push(
      `| ${result.id} | ${result.realLog ? "yes" : "no"} | ${result.analysisSource ?? "-"} | ${result.degradedReason ?? "-"} | ${result.latencyMs} | ${result.evidence ? result.evidence.recall.toFixed(2) : "n/a"} | ${result.hallucination.rate.toFixed(2)} | ${result.judge ? result.judge.rootCauseScore.toFixed(2) : "n/a"} | ${result.judge ? (result.judge.categoryMatch ? "match" : "miss") : "n/a"} | ${result.refusal.expected ? (result.refusal.appropriate ? "appropriate" : "MISSED") : "-"} |`
    );
  }

  if (report.problems.length > 0) {
    lines.push("", "## Problems", "");
    for (const problem of report.problems) {
      lines.push(`- ${problem}`);
    }
  }

  return lines.join("\n");
}
