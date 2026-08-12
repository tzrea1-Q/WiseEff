import type { ParsedLogEntry, ParseResult } from "./parser";
import { collectRuleEvidence, prefilterRules } from "./prefilter";

export type LogAnalysisSeverity = "Critical" | "Warning" | "Info";
export type LogAnalysisStageId = "pattern" | "rootcause";
export type LogRuleHit =
  | "thermal-foldback"
  | "charge-current-reduction"
  | "communication-timeout"
  | "device-offline"
  | "error-code";

/** Analyzer provenance for the additive output contract: degraded analysis never impersonates a full agent analysis. */
export type LogAnalysisSource = "agent" | "rules-fallback";
export type LogAnalysisDegradedReason = "provider-unavailable" | "token-budget-exhausted";

export type AnalyzeLogInput = {
  parsed: Extract<ParseResult, { ok: true }>;
  analysisQuestion?: string;
  logDomain?: {
    name: string;
    description?: string;
  };
};

export type AnalyzeLogEvidence = {
  stageId: LogAnalysisStageId;
  lineNumbers: number[];
  inference: string;
  suggestedAction: string;
  /** Absent for agent-generated evidence; set when the deterministic prefilter rules produced the item. */
  ruleHit?: LogRuleHit;
};

export type AnalyzeLogOutput = {
  confidence: number;
  conclusion: string;
  impact: string;
  severity: LogAnalysisSeverity;
  evidence: AnalyzeLogEvidence[];
  suggestedActions: string[];
  reportContext: {
    analysisQuestion?: string;
    lineCount: number;
    entryCount: number;
  };
  /** Absent on legacy rule-analyzer output; "agent" or "rules-fallback" once the LLM kernel is in play. */
  analysisSource?: LogAnalysisSource;
  degradedReason?: LogAnalysisDegradedReason;
  promptVersion?: string;
  model?: string;
};

export interface LogAnalysisAdapter {
  analyze(input: AnalyzeLogInput): Promise<AnalyzeLogOutput>;
}

export function createRuleBasedLogAnalyzer(): LogAnalysisAdapter {
  return {
    async analyze(input) {
      const evidence = collectRuleEvidence(input.parsed.entries);
      const ruleHits = new Set(
        evidence.map((item) => item.ruleHit).filter((ruleHit): ruleHit is LogRuleHit => ruleHit !== undefined)
      );
      const hasErrorEvidence = input.parsed.entries.some((entry) => entry.severity === "error" && evidenceLineHit(evidence, entry));

      return {
        confidence: calculateConfidence(ruleHits, hasErrorEvidence),
        conclusion: buildConclusion(ruleHits),
        impact: buildImpact(ruleHits),
        severity: calculateSeverity(ruleHits, hasErrorEvidence),
        evidence,
        suggestedActions: buildSuggestedActions(ruleHits),
        reportContext: {
          analysisQuestion: input.analysisQuestion,
          lineCount: input.parsed.rawLines.length,
          entryCount: input.parsed.entries.length
        }
      };
    }
  };
}

function evidenceLineHit(evidence: AnalyzeLogEvidence[], entry: ParsedLogEntry): boolean {
  return evidence.some((item) => item.lineNumbers.includes(entry.lineNumber));
}

function calculateConfidence(ruleHits: Set<LogRuleHit>, hasErrorEvidence: boolean): number {
  if ((ruleHits.has("thermal-foldback") || ruleHits.has("device-offline")) && hasErrorEvidence) {
    return 0.85;
  }
  if (ruleHits.has("communication-timeout")) {
    return 0.72;
  }
  if (ruleHits.size === 0) {
    return 0.42;
  }

  return 0.64;
}

function calculateSeverity(ruleHits: Set<LogRuleHit>, hasErrorEvidence: boolean): LogAnalysisSeverity {
  if (ruleHits.has("device-offline") && hasErrorEvidence) {
    return "Critical";
  }
  if (ruleHits.has("thermal-foldback") || ruleHits.has("communication-timeout") || ruleHits.has("charge-current-reduction")) {
    return "Warning";
  }
  if (ruleHits.has("error-code")) {
    return "Warning";
  }

  return "Info";
}

function buildConclusion(ruleHits: Set<LogRuleHit>): string {
  if (ruleHits.has("thermal-foldback")) {
    return "Charging behavior is consistent with thermal foldback protection.";
  }
  if (ruleHits.has("device-offline")) {
    return "The log indicates the device went offline or became unavailable.";
  }
  if (ruleHits.has("communication-timeout")) {
    return "The log indicates communication timeout or retry behavior.";
  }
  if (ruleHits.has("charge-current-reduction")) {
    return "The log indicates charge current reduction without a confirmed root cause.";
  }
  if (ruleHits.has("error-code")) {
    return "The log contains explicit error codes that need follow-up.";
  }

  return "No rule-based log findings were detected.";
}

function buildImpact(ruleHits: Set<LogRuleHit>): string {
  if (ruleHits.has("device-offline")) {
    return "Device availability may block reads, writes, or continued charging diagnostics.";
  }
  if (ruleHits.has("thermal-foldback")) {
    return "Charging throughput may be reduced until pack temperature returns to the safe operating range.";
  }
  if (ruleHits.has("communication-timeout")) {
    return "Intermittent communication may delay diagnostics or hide the underlying device state.";
  }
  if (ruleHits.size > 0) {
    return "The finding may require operator review before closing the incident.";
  }

  return "No immediate operational impact was identified from the provided lines.";
}

function buildSuggestedActions(ruleHits: Set<LogRuleHit>): string[] {
  if (ruleHits.size === 0) {
    return ["Collect more context from the device and adjacent logs before escalating."];
  }

  const actions = new Set<string>();
  for (const rule of prefilterRules) {
    if (ruleHits.has(rule.id)) {
      actions.add(rule.suggestedAction);
    }
  }
  if (ruleHits.has("error-code")) {
    actions.add("Correlate the error code with firmware diagnostics and recent parameter changes.");
  }
  if (ruleHits.has("thermal-foldback")) {
    actions.add("Review ambient conditions and recent charge current requests for thermal stress.");
  }

  return [...actions];
}
