import type { ParsedLogEntry, ParseResult } from "./parser";

export type LogAnalysisSeverity = "Critical" | "Warning" | "Info";
export type LogAnalysisStageId = "pattern" | "rootcause";
export type LogRuleHit =
  | "thermal-foldback"
  | "charge-current-reduction"
  | "communication-timeout"
  | "device-offline"
  | "error-code";

export type AnalyzeLogInput = {
  parsed: Extract<ParseResult, { ok: true }>;
  analysisQuestion?: string;
};

export type AnalyzeLogEvidence = {
  stageId: LogAnalysisStageId;
  lineNumbers: number[];
  inference: string;
  suggestedAction: string;
  ruleHit: LogRuleHit;
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
};

export interface LogAnalysisAdapter {
  analyze(input: AnalyzeLogInput): Promise<AnalyzeLogOutput>;
}

type Rule = {
  id: LogRuleHit;
  patterns: RegExp[];
  stageId: LogAnalysisStageId;
  inference: string;
  suggestedAction: string;
  matches?: (entry: ParsedLogEntry) => boolean;
};

const rules: Rule[] = [
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

export function createRuleBasedLogAnalyzer(): LogAnalysisAdapter {
  return {
    async analyze(input) {
      const evidence = collectEvidence(input.parsed.entries);
      const ruleHits = new Set(evidence.map((item) => item.ruleHit));
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

function collectEvidence(entries: ParsedLogEntry[]): AnalyzeLogEvidence[] {
  const evidence = rules.flatMap((rule) => {
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
  for (const rule of rules) {
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
