import type { AnalyzeLogEvidence, LogAnalysisStageId, LogRuleHit } from "./analyzer";
import type { ParsedLogEntry } from "./parser";

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

type Rule = {
  id: LogRuleHit;
  patterns: RegExp[];
  stageId: LogAnalysisStageId;
  inference: string;
  suggestedAction: string;
  matches?: (entry: ParsedLogEntry) => boolean;
};

export const prefilterRules: Rule[] = [
  {
    id: "thermal-foldback",
    patterns: [/thermal/i, /battery_temp/i, /foldback/i, /E_THERMAL_FOLDBACK/i],
    stageId: "rootcause",
    inference: "Thermal protection reduced charging output.",
    suggestedAction: "Inspect pack temperature, cooling path, and BMS thermal thresholds before resuming fast charge."
  },
  {
    id: "charge-current-reduction",
    patterns: [/current reduced/i, /reduced current/i, /charge current reduced/i],
    stageId: "pattern",
    inference: "Requested charge current was reduced by the controller.",
    suggestedAction: "Compare requested and delivered current around the event window.",
    matches: matchesChargeCurrentReduction
  },
  {
    id: "communication-timeout",
    patterns: [/timeout/i, /retry/i, /E_TIMEOUT/i],
    stageId: "pattern",
    inference: "Controller communication showed timeout or retry behavior.",
    suggestedAction: "Check network latency, controller availability, and retry counts."
  },
  {
    id: "device-offline",
    patterns: [/offline/i, /disconnect/i, /DEVICE_UNAVAILABLE/i],
    stageId: "rootcause",
    inference: "The device became unavailable or disconnected.",
    suggestedAction: "Verify device power, link status, and reconnect behavior."
  }
];

export function collectRuleEvidence(entries: ParsedLogEntry[]): AnalyzeLogEvidence[] {
  const evidence = prefilterRules.flatMap((rule) => {
    const lineNumbers = entries.filter((entry) => matchesRule(rule, entry)).map((entry) => entry.lineNumber);
    if (lineNumbers.length === 0) {
      return [];
    }

    return [
      {
        stageId: rule.stageId,
        lineNumbers,
        inference: rule.inference,
        suggestedAction: rule.suggestedAction,
        ruleHit: rule.id
      }
    ];
  });

  const errorCodeLines = entries
    .filter((entry) => entry.severity === "error" && typeof entry.tokens.code === "string" && entry.tokens.code.length > 0)
    .map((entry) => entry.lineNumber);

  if (errorCodeLines.length > 0) {
    evidence.push({
      stageId: "pattern",
      lineNumbers: errorCodeLines,
      inference: "Error lines include explicit machine-readable error codes.",
      suggestedAction: "Use the error code to correlate firmware diagnostics and incident history.",
      ruleHit: "error-code"
    });
  }

  return evidence;
}

export function runLogPrefilter(entries: ParsedLogEntry[]): PrefilterFindings {
  const evidence = collectRuleEvidence(entries);
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

function matchesRule(rule: Rule, entry: ParsedLogEntry): boolean {
  const searchable = `${entry.message} ${Object.entries(entry.tokens)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ")}`;

  return rule.patterns.some((pattern) => pattern.test(searchable)) || rule.matches?.(entry) === true;
}

function matchesChargeCurrentReduction(entry: ParsedLogEntry): boolean {
  const requestedCurrent = parseNumericToken(entry.tokens.requested_ma);
  const deliveredCurrent = parseNumericToken(entry.tokens.charge_current_ma ?? entry.tokens.current_ma);

  return requestedCurrent !== undefined && deliveredCurrent !== undefined && deliveredCurrent < requestedCurrent;
}

function parseNumericToken(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : undefined;
}
