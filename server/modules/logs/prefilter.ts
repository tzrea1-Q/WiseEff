import type { AnalyzeLogEvidence, LogRuleHit } from "./analyzer";
import type { ParsedLogEntry } from "./parser";
import { defaultChargingRuleSet } from "./chargingSignalRules";
import { compileSignalCondition, type SignalRuleSet } from "./signalRules";

/**
 * Deterministic prefilter (glossary: Prefilter findings): the legacy rule matching
 * extracted from the rule analyzer. Its output stays the rule analyzer's evidence
 * source, becomes the fallback baseline, and bounds what the LLM kernel must read.
 */
export type PrefilterFindings = {
  evidence: AnalyzeLogEvidence[];
  ruleHits: LogRuleHit[];
  /** Candidate anomaly lines: rule-hit lines plus error-severity lines, ascending and unique. */
  anomalyLineNumbers: number[];
  errorCodeStats: Array<{ code: string; count: number; lineNumbers: number[] }>;
  severityCounts: { error: number; warn: number; info: number };
};

export function collectRuleEvidence(
  entries: ParsedLogEntry[],
  ruleSet: SignalRuleSet = defaultChargingRuleSet
): AnalyzeLogEvidence[] {
  return ruleSet.rules.flatMap((rule) => {
    const conditions = rule.anyOf.map(compileSignalCondition);
    const lineNumbers = entries
      .filter((entry) => conditions.some((matches) => matches(entry)))
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
