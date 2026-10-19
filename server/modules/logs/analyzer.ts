import type { ParsedLogEntry, ParseResult } from "./parser";
import { collectRuleEvidence } from "./prefilter";
import { defaultChargingRuleSet } from "./chargingSignalRules";
import type { SignalRuleSet } from "./signalRules";
import type { RelatedParameterRunSnapshot } from "./relatedParameter";

export type LogAnalysisSeverity = "Critical" | "Warning" | "Info";
export type LogAnalysisStageId = "pattern" | "rootcause";
export type LogRuleHit = string;

/** Analyzer provenance for the additive output contract: degraded analysis never impersonates a full agent analysis. */
export type LogAnalysisSource = "agent" | "rules-fallback";
export type LogAnalysisDegradedReason = "provider-unavailable" | "token-budget-exhausted";

export type AnalyzeLogInput = {
  decoding?: { spec: import("./parsing/spec").ParsingSpec; events: import("./parsing/spec").DecodedEvent[]; counts: import("./parsing/spec").DecodeCounts };
  files?: Array<import("./filesRepository").LogFileDto & { parsed?: Extract<ParseResult, { ok: true }> }>;
  filePath?: string;
  signalRules?: SignalRuleSet;
  parsed: Extract<ParseResult, { ok: true }>;
  analysisQuestion?: string;
  logDomain?: {
    name: string;
    description?: string;
    /** Per-domain model-name override (P3b); endpoint/key/budget stay global. */
    modelOverride?: string;
  };
  /**
   * P2 loop-kernel run context (internal input, not part of the output contract):
   * lets the kernel bind organization-scoped tool backends and map loop steps onto
   * the `rootcause` stage progress range. All optional — the single-shot kernel and
   * offline eval runs ignore them.
   */
  organizationId?: string;
  logDomainId?: string;
  relatedParameterId?: string;
  /** Immutable canonical context frozen when this specific run was accepted. */
  relatedParameterSnapshot?: RelatedParameterRunSnapshot;
  onProgress?: (progress: { step: number; maxSteps: number }) => void | Promise<void>;
};

export type AnalyzeLogEvidence = {
  decodedFields?: import("./parsing/spec").DecodedEvent[];
  filePath?: string | null;
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

export function createRuleBasedLogAnalyzer(ruleSet: SignalRuleSet = defaultChargingRuleSet): LogAnalysisAdapter {
  return {
    async analyze(input) {
      const activeRules = input.signalRules ?? ruleSet;
      const evidence = input.files
        ? input.files.flatMap((file) => file.parsed ? collectRuleEvidence(file.parsed.entries, activeRules).map((item) => ({ ...item, filePath: file.path })) : [])
        : collectRuleEvidence(input.parsed.entries, activeRules).map((item) => ({ ...item, filePath: input.filePath }));
      const ruleHits = new Set(
        evidence.map((item) => item.ruleHit).filter((ruleHit): ruleHit is LogRuleHit => ruleHit !== undefined)
      );
      const hasErrorEvidence = input.files ? input.files.some((file) => file.parsed?.entries.some((entry) => entry.severity === "error" && evidenceLineHit(evidence.filter((item) => item.filePath === file.path), entry)))
        : input.parsed.entries.some((entry) => entry.severity === "error" && evidenceLineHit(evidence, entry));

      const matchedRules = activeRules.rules.filter((rule) => ruleHits.has(rule.id));
      const defaults = matchedRules.length === 0 ? activeRules.noHit : activeRules.hitDefaults;
      const eligible = <T extends { priority: number; requiresErrorEvidence?: boolean }>(items: T[]) =>
        items.filter((item) => !item.requiresErrorEvidence || hasErrorEvidence)
          .sort((left, right) => left.priority - right.priority);
      const choose = <T>(outputs: Array<{ value: T; priority: number; requiresErrorEvidence?: boolean } | undefined>, fallback: T): T =>
        eligible(outputs.filter((output) => output !== undefined))[0]?.value ?? fallback;
      const actions = eligible(matchedRules.flatMap((rule) => rule.analysis.suggestedActions));

      return {
        confidence: choose(matchedRules.map((rule) => rule.analysis.confidence), defaults.confidence),
        conclusion: choose(matchedRules.map((rule) => rule.analysis.conclusion), defaults.conclusion),
        impact: choose(matchedRules.map((rule) => rule.analysis.impact), defaults.impact),
        severity: choose(matchedRules.map((rule) => rule.analysis.severity), defaults.severity),
        evidence,
        suggestedActions: [...new Set([...defaults.suggestedActions, ...actions.map((action) => action.value)])],
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
