import { z } from "zod";
import { compileSkillFiles } from "../../../../src/domain/logs/fileApplicability";

import type { AnalyzeLogInput, AnalyzeLogOutput, LogAnalysisAdapter } from "../analyzer";
import { LOG_ANALYSIS_LOOP_PROMPT_VERSION } from "../analyzer/agentLoop";
import { LOG_ANALYSIS_PROMPT_VERSION } from "../analyzer/llmAnalyzer";
import type { CreateLogAnalyzerFromEnvOptions } from "../analyzer/analyzerFromEnv";
import { parseLogText } from "../parser";
import { decodeLogFilesCooperatively } from "../parsing/workerDecoding";
import type { LogAnalysisTraceStep } from "../traceTypes";
import { analyzeWithDegradation } from "../worker";
import { resolveLogEvalCaseMetadata, type GoldenLogCase, type LogEvalRootCauseCategory } from "./goldenCases";
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
 * scriptable stub in offline mode. Only golden cases count toward the baseline gate.
 */

/** A conclusion at or below this confidence counts as an honest refusal / low-confidence answer. */
export const QUALITY_REFUSAL_CONFIDENCE_THRESHOLD = 0.5;
export const QUALITY_CASE_PASS_THRESHOLD = 0.8;

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

/**
 * Action-scoring canonical forms: verbs plus thermal/charge nouns. Applied only
 * on the stub's `actionsScore` path so root-cause overlap stays strict.
 */
const ACTION_TOKEN_CANONICAL: Record<string, string> = {
  inspect: "inspect",
  inspecting: "inspect",
  check: "inspect",
  checking: "inspect",
  examine: "inspect",
  examining: "inspect",
  path: "path",
  paths: "path",
  loop: "path",
  loops: "path",
  cooling: "cool",
  cool: "cool",
  thermal: "cool",
  charge: "charge",
  charging: "charge",
  charged: "charge"
};

function lightStem(token: string): string {
  if (token.endsWith("ing") && token.length > 6) {
    return token.slice(0, -3);
  }
  if (token.endsWith("ed") && token.length > 5) {
    return token.slice(0, -2);
  }
  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 4) {
    return token.slice(0, -1);
  }
  return token;
}

function canonicalizeActionToken(token: string): string {
  return ACTION_TOKEN_CANONICAL[token] ?? lightStem(token);
}

function coverageScore(
  targets: string[],
  candidateText: string,
  canonicalize: (token: string) => string = (token) => token
): number {
  if (targets.length === 0) {
    return 0;
  }
  const candidateTokens = new Set(significantTokens(candidateText).map(canonicalize));
  const literalCandidate = candidateText.toLowerCase();
  let covered = 0;
  for (const target of targets) {
    // Keep literal expectations usable for reports in scripts without ASCII word boundaries.
    if (/[^\p{ASCII}]/u.test(target) && literalCandidate.includes(target.toLowerCase())) {
      covered += 1;
      continue;
    }
    const tokens = significantTokens(target).map(canonicalize);
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
 * annotation plus a keyword bucket check. Action coverage keeps the 0.4 hit-ratio
 * threshold but canonicalizes a small verb/thermal/charge synonym table (plus a
 * light stem) so reasonable restatements are not scored as misses. Root-cause
 * overlap stays literal. Crude by design — its job is to make the quality
 * pipeline runnable and testable at zero API cost, not to replace the real
 * judge. Tests may inject any `LogAnalysisQualityJudge` instead.
 */
export function createDeterministicQualityJudge(): LogAnalysisQualityJudge {
  return {
    label: "deterministic-rubric-stub",
    async score({ goldenCase, output }) {
      const conclusionText = [output.conclusion, output.impact, ...output.evidence.map((item) => item.inference)].join("\n");
      const actionsText = [...output.suggestedActions, ...output.evidence.map((item) => item.suggestedAction)].join("\n");
      const rootCauseScore = coverageScore(goldenCase.rootCausePoints, conclusionText);
      const actionsScore = coverageScore(goldenCase.expectedActions, actionsText, canonicalizeActionToken);
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

type CaseMetadata = ReturnType<typeof resolveLogEvalCaseMetadata>;

export type QualityEvalSelection = {
  trials: number;
  tier: CaseMetadata["tier"] | "all";
  tags: CaseMetadata["scenarioTags"];
};

type QualityTrialResult = QualityCaseResult & CaseMetadata & {
  trial: number;
  passed: boolean;
  steps: number;
  tokens: number | null;
  earlyConverged: boolean;
};

type CostDistribution = { median: number | null; p95: number | null; samples: number };

type QualityTrialAggregates = QualityAggregates & {
  trialCount: number;
  passAtK: number | null;
  passPowerK: number | null;
  steps: CostDistribution;
  tokens: CostDistribution;
  latencyMs: CostDistribution;
  degradedRate: number | null;
  degradedRatesByReason: Record<string, number>;
  earlyConvergenceRate: number | null;
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
  status: "not-configured" | "inactive-pending-real-cases" | "not-run-filtered-golden-cases" | "passed" | "failed";
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
  promptVersion: string;
  judgeLabel: string;
  selection: QualityEvalSelection;
  caseResults: QualityTrialResult[];
  aggregates: {
    all: QualityTrialAggregates;
    realCases: QualityTrialAggregates | null;
    realisticCases: QualityTrialAggregates | null;
    syntheticCases: QualityTrialAggregates | null;
    byTag: Partial<Record<CaseMetadata["scenarioTags"][number], QualityTrialAggregates>>;
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

function costDistribution(values: number[]): CostDistribution {
  values.sort((left, right) => left - right);
  const samples = values.length;
  if (samples === 0) return { median: null, p95: null, samples };
  const middle = (samples - 1) / 2;
  return {
    median: (values[Math.floor(middle)] + values[Math.ceil(middle)]) / 2,
    p95: values[Math.ceil(0.95 * samples) - 1],
    samples
  };
}

function aggregateQualityTrials(results: QualityTrialResult[], trials: number): QualityTrialAggregates {
  const quality = aggregateQualityResults(results);
  const passes = new Map<string, number>();
  const degradedCounts = new Map<string, number>();
  for (const result of results) {
    passes.set(result.id, (passes.get(result.id) ?? 0) + Number(result.passed));
    if (result.degradedReason) {
      degradedCounts.set(result.degradedReason, (degradedCounts.get(result.degradedReason) ?? 0) + 1);
    }
  }
  const passCounts = [...passes.values()];
  const trialCount = results.length;
  return {
    ...quality,
    caseCount: passes.size,
    trialCount,
    passAtK: mean(passCounts.map((count) => Number(count > 0))),
    passPowerK: mean(passCounts.map((count) => Number(count === trials))),
    steps: costDistribution(results.map((result) => result.steps)),
    tokens: costDistribution(results.flatMap((result) => result.tokens ?? [])),
    latencyMs: costDistribution(results.map((result) => result.latencyMs)),
    degradedRate: trialCount === 0 ? null : quality.degradedCount / trialCount,
    degradedRatesByReason: Object.fromEntries([...degradedCounts].sort().map(([reason, count]) => [reason, count / trialCount])),
    earlyConvergenceRate: mean(results.map((result) => Number(result.earlyConverged)))
  };
}

/**
 * Baseline gate: with a committed baseline AND real cases in both runs, the
 * current golden aggregates must not fall below baseline minus the stated
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
  extras: { latencyMs: number; judge: QualityJudgeScore | null } & (
    { parsedLineNumbers: Set<number>; projectCitation?: never }
    | { projectCitation: (filePath: string | null | undefined, line: number) => number | undefined }
  )
): QualityCaseResult {
  const existing = new Set<number>();
  const nonexistent = new Map<string, number>();
  for (const item of output.evidence) {
    for (const line of item.lineNumbers) {
      const projected = extras.projectCitation ? extras.projectCitation(item.filePath, line)
        : extras.parsedLineNumbers.has(line) ? line : undefined;
      if (projected !== undefined) existing.add(projected);
      else nonexistent.set(JSON.stringify([extras.projectCitation ? item.filePath : null, line]), line);
    }
  }
  const citedExisting = [...existing].sort((left, right) => left - right);
  const citedNonexistentLines = [...nonexistent.values()].sort((left, right) => left - right);
  const citationCount = existing.size + nonexistent.size;

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
      rate: citationCount === 0 ? 0 : nonexistent.size / citationCount
    },
    refusal: {
      expected: goldenCase.expectRefusal,
      refused,
      appropriate: goldenCase.expectRefusal
        ? refused || (goldenCase.rootCauseCategory === "no-fault" && extras.judge?.categoryMatch === true) : null
    },
    judge: extras.judge
  };
}

export type RunQualityEvalOptions = Partial<QualityEvalSelection> & {
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

export function bindQualityPastConclusions(cases: GoldenLogCase[]): NonNullable<CreateLogAnalyzerFromEnvOptions["bindOfflinePastConclusions"]> {
  const confirmed = cases.filter((item) => item.realLog && item.deIdentified && !item.expectRefusal);
  return (input) => {
    const scope = input.pastConclusionScope;
    if (!scope || !input.logDomainId) return undefined;
    const history = confirmed.filter((item) => item.domain === input.logDomainId && item.id !== scope.runId);
    if (!history.length) return undefined;
    return async ({ query, offset, limit }) => {
      const terms = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [query.toLowerCase()];
      const matches = history.map((item) => ({ runId: item.id, createdAt: "1970-01-01T00:00:00.000Z",
        summary: item.rootCausePoints.join(" ").slice(0, 800), rootCauseCategory: item.rootCauseCategory, evidenceTemplates: [] }))
        .filter(({ summary, rootCauseCategory }) => terms.every((term) => `${summary} ${rootCauseCategory}`.toLowerCase().includes(term)));
      return { retrievalMode: "fts_only", items: matches.slice(offset, offset + limit), hasMore: matches.length > offset + limit };
    };
  };
}

async function prepareQualityCase(goldenCase: GoldenLogCase) {
  const { skill } = goldenCase;
  const profile = goldenCase.formatProfile ?? skill?.formatProfile;
  const assignFile = compileSkillFiles(skill?.files);
  const parse = (fileName: string, content: string, skillMatched: boolean) => {
    const parsed = parseLogText({ fileName, content }, { profile: skillMatched ? profile : undefined });
    if (!parsed.ok) throw new Error(`${fileName} failed to parse (${parsed.reason})`);
    return parsed;
  };
  const decode = async (files: Parameters<typeof decodeLogFilesCooperatively>[1]) => {
    if (skill?.parsing?.extractors.length) return { spec: skill.parsing, ...await decodeLogFilesCooperatively(skill.parsing, files) };
  };
  if (!goldenCase.bundle) {
    const filePath = "log.txt";
    const { skillMatched } = assignFile(filePath);
    const parsed = parse(filePath, goldenCase.logText, skillMatched);
    const decoding = await decode(skillMatched ? [{ file: filePath, lines: parsed.rawLines }] : []);
    return {
      input: { parsed, ...(decoding ? { decoding, filePath } : {}) },
      scoring: { parsedLineNumbers: new Set(parsed.entries.map((entry) => entry.lineNumber)) }
    };
  }

  const offsets = new Map<string, { start: number; lines: string[] }>();
  let lineCount = 0;
  const files = goldenCase.bundle.map(({ logText, ...file }) => {
    const assignment = skill ? assignFile(file.path) : { skillMatched: file.skillMatched ?? true, role: file.role ?? null };
    const parsed = parse(file.path, logText, assignment.skillMatched);
    offsets.set(file.path, { start: lineCount, lines: parsed.rawLines });
    lineCount += parsed.rawLines.length;
    return { ...file, ...assignment, parsed };
  });
  const [first] = files;
  const input: Pick<AnalyzeLogInput, "parsed" | "files" | "filePath" | "stats" | "decoding"> = {
    parsed: first.parsed, files, filePath: first.path,
    decoding: await decode(files.filter(({ skillMatched }) => skillMatched).map(({ path, parsed }) => ({ file: path, lines: parsed.rawLines }))),
    stats: { lineCount, entryCount: files.reduce((total, file) => total + file.parsed.entries.length, 0) }
  };
  return {
    input,
    scoring: {
      projectCitation(filePath: string | null | undefined, line: number) {
        const file = offsets.get(filePath ?? first.path);
        return file?.lines[line - 1]?.trim() ? file.start + line : undefined;
      }
    }
  };
}

export async function runQualityEval(options: RunQualityEvalOptions): Promise<QualityEvalReport> {
  const now = options.now ?? (() => Date.now());
  const { trials = 1, tier = "all", tags = [] } = options;
  if (!Number.isSafeInteger(trials) || trials < 1) throw new Error("trials must be a positive integer");
  const caseResults: QualityEvalReport["caseResults"] = [];
  const problems = [...options.problems];
  const selectedCases = options.cases.map((goldenCase) => ({ goldenCase, metadata: resolveLogEvalCaseMetadata(goldenCase) }))
    .filter(({ metadata }) => (tier === "all" || tier === metadata.tier)
      && (tags.length === 0 || tags.some((tag) => metadata.scenarioTags.includes(tag))));

  for (const { goldenCase, metadata } of selectedCases) {
    let prepared: Awaited<ReturnType<typeof prepareQualityCase>>;
    try {
      prepared = await prepareQualityCase(goldenCase);
    } catch (error) {
      problems.push(`${goldenCase.id}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    for (let trial = 1; trial <= trials; trial += 1) {
      try {
        caseResults.push({ ...await runQualityTrial(options, goldenCase, prepared, now), ...metadata, trial });
      } catch (error) {
        problems.push(`${goldenCase.id} (trial ${trial}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const aggregateTier = (caseTier: CaseMetadata["tier"]) => {
    const results = caseResults.filter((result) => result.tier === caseTier);
    return results.length > 0 ? aggregateQualityTrials(results, trials) : null;
  };
  const realAggregates = aggregateTier("golden");
  const scenarioTags = [...new Set(caseResults.flatMap((result) => result.scenarioTags))].sort();
  const totalGoldenCases = options.cases.filter((item) => resolveLogEvalCaseMetadata(item).tier === "golden").length;
  const selectedGoldenCases = selectedCases.filter(({ metadata }) => metadata.tier === "golden").length;
  const baseline: QualityBaselineComparison = options.baseline?.realCaseAggregates && selectedGoldenCases < totalGoldenCases
    ? { status: "not-run-filtered-golden-cases", note: "The selection excludes part or all of the golden corpus." }
    : compareToQualityBaseline(options.baseline, realAggregates);
  const generatedAt = new Date().toISOString();
  const judgeSampleRate = options.judgeSampleRate ?? 0.2;
  const calibrationResults = caseResults.filter((result) => result.trial === 1);

  return {
    generatedAt,
    runId: qualityRunId(generatedAt),
    kernel: options.kernel,
    deterministic: options.deterministic,
    modelLabel: options.modelLabel,
    promptVersion: options.kernel === "loop" ? LOG_ANALYSIS_LOOP_PROMPT_VERSION : LOG_ANALYSIS_PROMPT_VERSION,
    judgeLabel: options.judge.label,
    selection: { trials, tier, tags },
    caseResults,
    aggregates: {
      all: aggregateQualityTrials(caseResults, trials),
      realCases: realAggregates,
      realisticCases: aggregateTier("realistic"),
      syntheticCases: aggregateTier("synthetic"),
      byTag: Object.fromEntries(scenarioTags.map((tag) => [
        tag, aggregateQualityTrials(caseResults.filter((result) => result.scenarioTags.includes(tag)), trials)
      ]))
    },
    baseline,
    judgeSampling: {
      rate: judgeSampleRate,
      sampledCaseIds: selectJudgeReviewSample(calibrationResults, judgeSampleRate).map((result) => result.id)
    },
    humanAgreement: computeJudgeHumanAgreement(calibrationResults, options.humanReviews ?? []),
    problems
  };
}

async function runQualityTrial(
  { analyzer, judge: rubric }: RunQualityEvalOptions,
  goldenCase: GoldenLogCase,
  prepared: Awaited<ReturnType<typeof prepareQualityCase>>,
  now: () => number
) {
  const trace: LogAnalysisTraceStep[] = [];
  const startedAtMs = now();
  // A provider failure degrades immediately to the production rules fallback.
  const output = await analyzeWithDegradation({
    analyzer,
    analyzeInput: {
      ...prepared.input,
      analysisQuestion: goldenCase.analysisQuestion,
      logDomain: goldenCase.domain === "uncategorized" ? undefined : { name: goldenCase.domain },
      ...(goldenCase.domain !== "uncategorized" ? {
        logDomainId: goldenCase.domain, pastConclusionScope: { runId: goldenCase.id, projectId: null }
      } : {}),
      onTrace: (step) => { trace.push(step); }
    },
    job: { attemptCount: Number.MAX_SAFE_INTEGER },
    maxAttempts: 1,
    retryBaseDelayMs: 1,
    now: () => new Date(now())
  });
  const latencyMs = Math.max(0, now() - startedAtMs);
  // A no-fault case is also answered by a confident "no fault" report, which only the judge can recognize.
  const judged = !goldenCase.expectRefusal || goldenCase.rootCauseCategory === "no-fault";
  const judge = !judged ? null : await rubric.score({ goldenCase, output }).catch(() => {
    throw new Error(`The ${rubric.label} judge failed to score the output.`);
  });
  const result = evaluateQualityCaseOutput(goldenCase, output, { latencyMs, judge, ...prepared.scoring });
  const turns = trace.filter((step) => step.kind === "model-turn");
  const tokens = turns.reduce<number | null>((sum, { inputTokens, outputTokens }) =>
    sum === null || inputTokens === undefined || outputTokens === undefined ? null : sum + inputTokens + outputTokens, 0);

  return {
    ...result,
    passed: result.expectRefusal ? result.refusal.appropriate === true
      : (result.judge?.rootCauseScore ?? 0) >= QUALITY_CASE_PASS_THRESHOLD
        && (result.evidence?.recall ?? 0) >= QUALITY_CASE_PASS_THRESHOLD,
    steps: turns.filter((step) => step.reason !== "protocol-unsupported" && !step.reason?.startsWith("verification")).length,
    tokens,
    earlyConverged: trace.some((step) => step.kind === "early-convergence")
  };
}

function formatRatio(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(3);
}

function qualityScopes(report: QualityEvalReport) {
  return new Map<string, QualityTrialAggregates | null>([
    ["all", report.aggregates.all],
    ["golden", report.aggregates.realCases],
    ["realistic", report.aggregates.realisticCases],
    ["synthetic", report.aggregates.syntheticCases],
    ...Object.entries(report.aggregates.byTag)
  ]);
}

const trialSummaryColumns = [
  "范围", "用例", "试验", "根因均分", "证据平均召回", "pass@k", "pass^k", "步数",
  "token", "时延（ms）", "降级率（按原因）", "早收敛率"
];

function markdownRow(cells: Array<string | number>) {
  return `| ${cells.map((cell) => String(cell).replace(/\|/g, "\\|").replace(/\s+/g, " ")).join(" | ")} |`;
}

function trialSummaryCells(aggregates: QualityTrialAggregates | null) {
  if (!aggregates) return [0, 0, ...trialSummaryColumns.slice(3).map(() => "—")];
  const cost = ({ median, p95 }: CostDistribution) => median === null ? "n/a" : `${median} / ${p95}`;
  const reasons = Object.entries(aggregates.degradedRatesByReason)
    .map(([reason, rate]) => `${reason} ${formatRatio(rate)}`);
  const tokenSamples = aggregates.tokens.samples === aggregates.trialCount ? "" : `（n=${aggregates.tokens.samples}）`;
  return [
    aggregates.caseCount, aggregates.trialCount, formatRatio(aggregates.rootCauseScoreMean),
    formatRatio(aggregates.evidenceRecallMean), formatRatio(aggregates.passAtK), formatRatio(aggregates.passPowerK),
    cost(aggregates.steps), `${cost(aggregates.tokens)}${tokenSamples}`, cost(aggregates.latencyMs),
    `${formatRatio(aggregates.degradedRate)}${reasons.length ? `（${reasons.join("，")}）` : ""}`,
    formatRatio(aggregates.earlyConvergenceRate)
  ];
}

export function formatQualityComparisonMarkdown(before: QualityEvalReport, after: QualityEvalReport): string {
  const trialKeys = (report: QualityEvalReport) => JSON.stringify(report.caseResults.map((result) =>
    JSON.stringify([result.id, result.trial, result.tier, [...result.scenarioTags].sort()])).sort());
  if (before.problems.length || after.problems.length || before.selection.trials !== after.selection.trials
      || trialKeys(before) !== trialKeys(after)) {
    throw new Error("Compare two complete reports with the same cases and trials (including tiers and tags).");
  }

  const beforeScopes = qualityScopes(before);
  const afterScopes = qualityScopes(after);
  const row = (label: string, left: QualityTrialAggregates | null, right: QualityTrialAggregates | null) => {
    const afterCells = trialSummaryCells(right);
    return markdownRow([label, ...trialSummaryCells(left).map((value, index) => `${value} → ${afterCells[index]}`)]);
  };
  return [
    "# 日志分析质量评测对比",
    "",
    `每个用例运行 ${before.selection.trials} 次。指标按「改动前 → 改动后」显示，成本为「中位数 / p95」。`,
    "",
    "| 配置 | 改动前 | 改动后 |",
    "| --- | --- | --- |",
    markdownRow(["run", before.runId, after.runId]),
    markdownRow(["model", before.modelLabel, after.modelLabel]),
    markdownRow(["kernel", before.kernel, after.kernel]),
    markdownRow(["promptVersion", before.promptVersion, after.promptVersion]),
    markdownRow(["judge", before.judgeLabel, after.judgeLabel]),
    "",
    markdownRow(trialSummaryColumns),
    markdownRow(trialSummaryColumns.map(() => "---")),
    ...[...beforeScopes].map(([label, left]) => row(label, left, afterScopes.get(label) ?? null))
  ].join("\n");
}

export function formatQualityReportMarkdown(report: QualityEvalReport): string {
  const lines = [
    "# Log Analysis Quality Eval Report",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Run id: \`${report.runId}\``,
    `- Kernel: \`${report.kernel}\`${report.deterministic ? " (deterministic mode)" : ""}`,
    `- Model: \`${report.modelLabel}\``,
    `- Prompt version: \`${report.promptVersion}\``,
    `- Judge: \`${report.judgeLabel}\``,
    "",
    "## 中文摘要",
    "",
    `共 ${report.aggregates.all.caseCount} 个用例、${report.aggregates.all.trialCount} 次试验。每个用例计划运行 ${report.selection.trials} 次，层级为 ${report.selection.tier}，标签筛选为 ${report.selection.tags.join("、") || "全部"}。`,
    ...(report.deterministic ? ["", "本次使用确定性模型和评分器，仅用于验证评测流程。"] : []),
    "",
    "pass@k 表示至少一次通过的用例比例，pass^k 表示每次都通过的用例比例。成本为「中位数 / p95」，缺少完整 token 用量的试验不计入 token 统计。",
    "",
    markdownRow(trialSummaryColumns),
    markdownRow(trialSummaryColumns.map(() => "---")),
    ...[...qualityScopes(report)]
      .map(([label, aggregate]) => markdownRow([label, ...trialSummaryCells(aggregate)])),
    "",
    "## Aggregates",
    "",
    "| Scope | Cases | Evidence recall | Evidence precision | Hallucination rate | Root-cause score | Category match | Actions score | Refusal appropriate | Degraded |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"
  ];

  for (const [label, aggregates] of qualityScopes(report)) {
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
    "| Case | Tier | Trial | Pass | Source | Degraded | Early convergence | Steps | Tokens | Latency (ms) | Evidence recall | Hallucination | Root-cause | Category | Refusal |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"
  );
  for (const result of report.caseResults) {
    lines.push(
      `| ${result.id} | ${result.tier} | ${result.trial} | ${result.passed ? "PASS" : "FAIL"} | ${result.analysisSource ?? "-"} | ${result.degradedReason ?? "-"} | ${result.earlyConverged ? "yes" : "-"} | ${result.steps} | ${result.tokens ?? "n/a"} | ${result.latencyMs} | ${result.evidence ? result.evidence.recall.toFixed(2) : "n/a"} | ${result.hallucination.rate.toFixed(2)} | ${result.judge ? result.judge.rootCauseScore.toFixed(2) : "n/a"} | ${result.judge ? (result.judge.categoryMatch ? "match" : "miss") : "n/a"} | ${result.refusal.expected ? (result.refusal.appropriate ? "appropriate" : "MISSED") : "-"} |`
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
