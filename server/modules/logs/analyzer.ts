import type { ParsedLogEntry, ParseResult } from "./parser";
import { collectRuleEvidence } from "./prefilter";
import { defaultChargingRuleSet } from "./chargingSignalRules";
import type { SignalRuleSet } from "./signalRules";
import type { RelatedParameterRunSnapshot } from "./relatedParameter";
import { extractLogSignals, type LogSignalSummary } from "./genericSignals";

export type LogAnalysisSeverity = "Critical" | "Warning" | "Info";
export type LogAnalysisStageId = "pattern" | "rootcause";
export type LogRuleHit = string;

/** Analyzer provenance for the additive output contract: degraded analysis never impersonates a full agent analysis. */
export type LogAnalysisSource = "agent" | "rules-fallback";
export type LogAnalysisDegradedReason = "provider-unavailable" | "token-budget-exhausted";

export type AnalyzeLogInput = {
  signal?: AbortSignal;
  signalSummary?: LogSignalSummary;
  /** Untrusted diagnostic guidance from this run's immutable skill revision. */
  procedure?: string;
  decoding?: { spec: import("./parsing/spec").ParsingSpec; events: import("./parsing/spec").DecodedEvent[]; counts: import("./parsing/spec").DecodeCounts };
  /** Pinned revision's source availability at worker execution; source tools bind this scope later. */
  sourceSnapshot?: { id: string; versionLabel?: string; status: "queued" | "indexing" | "ready" | "failed" | "archived" } | null;
  files?: Array<import("./filesRepository").LogFileDto & { parsed?: Extract<ParseResult, { ok: true }>; reader?: import("./fileReader").LogFileReader; prefilter?: import("./prefilter").PrefilterFindings }>;
  stats?: { lineCount: number; entryCount: number };
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
  sourceLocation?: { snapshotId: string; path: string; line: number };
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

/** Pinned skills without rules must not inherit charging-specific rules. */
export const genericSignalRuleSet: SignalRuleSet = {
  rules: [],
  noHit: { confidence: 0.35, conclusion: "未发现通用异常信号", impact: "请结合日志上下文进一步检查。", severity: "Info", suggestedActions: ["检查日志上下文。"] },
  hitDefaults: { confidence: 0.55, conclusion: "发现通用异常信号，请核对根因", impact: "异常可能影响设备或应用运行。", severity: "Warning", suggestedActions: ["检查信号附近的日志并确认根因。"] }
};

export function createRuleBasedLogAnalyzer(ruleSet: SignalRuleSet = defaultChargingRuleSet): LogAnalysisAdapter {
  return {
    async analyze(input) {
      const activeRules = input.signalRules ?? ruleSet;
      const evidence = input.files
        ? input.files.flatMap((file) => (file.prefilter?.evidence ?? (file.parsed ? collectRuleEvidence(file.parsed.entries, activeRules) : [])).map((item) => ({ ...item, filePath: file.path })))
        : collectRuleEvidence(input.parsed.entries, activeRules).map((item) => ({ ...item, filePath: input.filePath }));
      const ruleHits = new Set(evidence.map((item) => item.ruleHit));
      const hasErrorEvidence = input.files ? input.files.some((file) => file.prefilter?.hasErrorEvidence
        || file.prefilter?.errorLineNumbers?.some((line) => evidence.some((item) => item.filePath === file.path && item.lineNumbers.includes(line)))
        || file.parsed?.entries.some((entry) => entry.severity === "error" && evidenceLineHit(evidence.filter((item) => item.filePath === file.path), entry)))
        : input.parsed.entries.some((entry) => entry.severity === "error" && evidenceLineHit(evidence, entry));
      const summary = input.signalSummary ?? extractLogSignals(input.files ?? [{ path: input.filePath ?? "log", parsed: input.parsed }], input.signalRules);
      const generic = summary.signals.filter((signal) => signal.source === "generic");
      for (const signal of generic) {
        for (const filePath of new Set(signal.anchors.map((anchor) => anchor.file))) evidence.push({
          stageId: "pattern", filePath, lineNumbers: signal.anchors.filter((anchor) => anchor.file === filePath).map((anchor) => anchor.line),
          inference: signal.title, suggestedAction: "检查信号附近的日志并确认根因。", ruleHit: `generic:${signal.kind}`
        });
      }
      const matchedRules = activeRules.rules.filter((rule) => ruleHits.has(rule.id));
      const defaults = matchedRules.length === 0 ? (generic.length ? genericSignalRuleSet.hitDefaults : activeRules.noHit) : activeRules.hitDefaults;
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
        severity: choose(matchedRules.map((rule) => rule.analysis.severity), matchedRules.length === 0 && generic.some((signal) => signal.severity === "Critical") ? "Critical" : defaults.severity),
        evidence,
        suggestedActions: [...new Set([...defaults.suggestedActions, ...actions.map((action) => action.value)])],
        reportContext: {
          analysisQuestion: input.analysisQuestion,
          lineCount: input.stats?.lineCount ?? input.parsed.rawLines.length,
          entryCount: input.stats?.entryCount ?? input.parsed.entries.length
        }
      };
    }
  };
}

function evidenceLineHit(evidence: AnalyzeLogEvidence[], entry: ParsedLogEntry): boolean {
  return evidence.some((item) => item.lineNumbers.includes(entry.lineNumber));
}
