import type { AnalyzeLogEvidence, LogRuleHit } from "./analyzer";
import type { ParsedLogEntry } from "./parser";
import { defaultChargingRuleSet } from "./chargingSignalRules";
import { checkSignalEvaluationBudget, compileSignalRules, createSignalEvaluationBudget, SignalRuleBudgetError, type SignalRuleSet } from "./signalRules";
import { createLogPatternCache } from "./adminPattern";

/**
 * Deterministic prefilter (glossary: Prefilter findings): the legacy rule matching
 * extracted from the rule analyzer. Its output stays the rule analyzer's evidence
 * source, becomes the fallback baseline, and bounds what the LLM kernel must read.
 */
export type PrefilterFindings = {
  hasErrorEvidence?: boolean;
  errorLineNumbers?: number[];
  truncated?: boolean;
  evidence: AnalyzeLogEvidence[];
  ruleHits: LogRuleHit[];
  /** Candidate anomaly lines: rule-hit lines plus error-severity lines, ascending and unique. */
  anomalyLineNumbers: number[];
  errorCodeStats: Array<{ code: string; count: number; lineNumbers: number[] }>;
  severityCounts: { error: number; warn: number; info: number };
};

/** Reference caps preserve counts; execution caps stop the stream with truncated findings. */
export function createPrefilterBudget(evaluation = createSignalEvaluationBudget()) { return { references: 32_768, codes: 8192, codeBytes: 2 * 1024 * 1024, evaluation }; }
export async function prefilterLogStream(entries: AsyncIterable<ParsedLogEntry>, ruleSet: SignalRuleSet = defaultChargingRuleSet, budget = createPrefilterBudget()): Promise<PrefilterFindings> {
  const refs = 2000;
  let evidence: Array<ReturnType<typeof compileSignalRules>[number] & { lines: number[] }> = [];
  const cache = createLogPatternCache();
  const severityCounts = { error: 0, warn: 0, info: 0 };
  const anomalyLines = new Set<number>();
  const codes = new Map<string, { count: number; lineNumbers: number[] }>();
  let hasErrorEvidence = false;
  let truncated = false;
  const errorLineNumbers: number[] = [];
  const keep = (lines: number[], line: number) => {
    if (lines.length < refs && budget.references > 0) { lines.push(line); budget.references--; }
    else truncated = true;
  };
  try {
    evidence = compileSignalRules(ruleSet, budget.evaluation, cache).map((item) => ({ ...item, lines: [] }));
    for await (const entry of entries) {
      checkSignalEvaluationBudget(budget.evaluation);
      severityCounts[entry.severity]++;
      for (const item of evidence) if (item.matches.map((matches) => matches(entry)).some(Boolean)) {
        keep(item.lines, entry.lineNumber);
        if (anomalyLines.size < refs && budget.references > 0) { anomalyLines.add(entry.lineNumber); budget.references--; }
        hasErrorEvidence ||= entry.severity === "error";
      }
      if (entry.severity !== "error") continue;
      keep(errorLineNumbers, entry.lineNumber);
      if (anomalyLines.size < refs && budget.references > 0 && !anomalyLines.has(entry.lineNumber)) { anomalyLines.add(entry.lineNumber); budget.references--; }
      const originalCode = entry.tokens.code;
      if (!originalCode) continue;
      // Copy the prefix so a sliced string cannot keep a long source line alive.
      const code = Buffer.from(originalCode.slice(0, 256)).toString() + (originalCode.length > 256 ? "… [truncated]" : "");
      if (originalCode.length > 256) truncated = true;
      if (!codes.has(code)) {
        const cost = Buffer.byteLength(code) + 128;
        if (codes.size >= 200 || budget.codes <= 0 || budget.codeBytes < cost) { truncated = true; continue; }
        budget.codes--; budget.codeBytes -= cost;
      }
      const stat = codes.get(code) ?? { count: 0, lineNumbers: [] };
      stat.count++; keep(stat.lineNumbers, entry.lineNumber);
      codes.set(code, stat);
    }
  } catch (error) {
    if (!(error instanceof SignalRuleBudgetError) && !(error && typeof error === "object" && "code" in error && error.code === "LOG_READER_TIME_CAP")) throw error;
    truncated = true;
  }
  const findings = evidence.filter((item) => item.lines.length).map(({ rule, lines }) => ({ stageId: rule.stageId,
    lineNumbers: lines, inference: rule.inference, suggestedAction: rule.suggestedAction, ruleHit: rule.id }));
  return { evidence: findings, ruleHits: findings.map((item) => item.ruleHit), anomalyLineNumbers: [...anomalyLines].sort((a, b) => a - b),
    severityCounts, hasErrorEvidence, errorLineNumbers, ...(truncated ? { truncated } : {}), errorCodeStats: [...codes].map(([code, stat]) => ({ code, ...stat })) };
}

export function collectRuleEvidence(
  entries: ParsedLogEntry[],
  ruleSet: SignalRuleSet = defaultChargingRuleSet
): AnalyzeLogEvidence[] {
  const cache = createLogPatternCache();
  return compileSignalRules(ruleSet, undefined, cache).flatMap(({ rule, matches: conditions }) => {
    const lineNumbers = entries
      .filter((entry) => conditions.map((matches) => matches(entry)).some(Boolean))
      .map((entry) => entry.lineNumber);
    if (lineNumbers.length === 0) return [];

    return [{
      stageId: rule.stageId,
      lineNumbers,
      inference: rule.inference,
      suggestedAction: rule.suggestedAction,
      ruleHit: rule.id
    }];
  });
}

export function runLogPrefilter(
  entries: ParsedLogEntry[],
  ruleSet: SignalRuleSet = defaultChargingRuleSet
): PrefilterFindings {
  const evidence = collectRuleEvidence(entries, ruleSet);
  const ruleHits = [
    ...new Set(evidence.map((item) => item.ruleHit).filter((ruleHit): ruleHit is LogRuleHit => ruleHit !== undefined))
  ];

  const anomalyLines = new Set<number>(evidence.flatMap((item) => item.lineNumbers));
  const severityCounts = { error: 0, warn: 0, info: 0 };
  const codeStats = new Map<string, { count: number; lineNumbers: number[] }>();

  for (const entry of entries) {
    severityCounts[entry.severity] += 1;
    if (entry.severity === "error") {
      anomalyLines.add(entry.lineNumber);
      const code = entry.tokens.code;
      if (typeof code === "string" && code.length > 0) {
        const stats = codeStats.get(code) ?? { count: 0, lineNumbers: [] };
        stats.count += 1;
        stats.lineNumbers.push(entry.lineNumber);
        codeStats.set(code, stats);
      }
    }
  }

  return {
    evidence,
    ruleHits,
    anomalyLineNumbers: [...anomalyLines].sort((left, right) => left - right),
    errorCodeStats: [...codeStats.entries()].map(([code, stats]) => ({ code, ...stats })),
    severityCounts
  };
}
