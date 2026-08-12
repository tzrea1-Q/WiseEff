import { LOG_ANALYSIS_PROMPT_VERSION, LogAnalysisProviderError, type LogAnalysisChatModel } from "../analyzer/llmAnalyzer";
import type { LogEvalExpectation } from "./expectations";

/**
 * Behavior-layer eval scenarios (glossary: Behavior-layer eval): deterministic scripted
 * fake models drive the real single-shot analyzer plus the worker degradation chain.
 * Zero API cost; runs in CI on every change.
 */
export type LogEvalScenario = {
  name: string;
  category: string;
  fileName: string;
  logContent: string;
  analysisQuestion?: string;
  logDomain?: { name: string; description?: string };
  model: LogAnalysisChatModel;
  /** Claimed-job attempt count handed to the degradation chain; maxAttempts simulates the final attempt. */
  attemptCount?: number;
  expectations: LogEvalExpectation[];
};

const chargingLog = [
  "2026-08-10T08:00:01Z INFO charge session started requested_ma=6000",
  "2026-08-10T08:00:02Z INFO battery_temp=38C pack ok",
  "2026-08-10T08:00:03Z WARN thermal foldback engaged battery_temp=52C",
  "2026-08-10T08:00:04Z ERROR charge current reduced code=E_THERMAL_FOLDBACK requested_ma=6000 charge_current_ma=2000",
  "2026-08-10T08:00:05Z INFO charge continuing at reduced rate",
  "2026-08-10T08:00:06Z INFO session heartbeat ok"
].join("\n");

function jsonModel(payload: unknown): LogAnalysisChatModel {
  return {
    async invoke() {
      return { content: JSON.stringify(payload) };
    }
  };
}

const groundedPayload = {
  conclusion: "Thermal foldback reduced the charge current after the pack overheated.",
  impact: "Charging stays slow until pack temperature recovers.",
  severity: "Warning",
  confidence: 0.9,
  suggestedActions: ["Inspect the cooling path.", "Review thermal thresholds."],
  evidence: [
    {
      lineNumbers: [3, 4],
      inference: "Foldback engaged at 52C and current dropped from 6000mA to 2000mA.",
      suggestedAction: "Correlate temperature with the current drop window."
    }
  ]
};

export const LOG_EVAL_SCENARIOS: LogEvalScenario[] = [
  {
    name: "grounded-normal-conclusion",
    category: "grounding",
    fileName: "charging.log",
    logContent: chargingLog,
    model: jsonModel(groundedPayload),
    expectations: [
      { type: "expectsAnalysisSource", source: "agent" },
      { type: "expectsNoDegradation" },
      { type: "expectsGroundedEvidence" },
      { type: "expectsPromptVersionRecorded", promptVersion: LOG_ANALYSIS_PROMPT_VERSION }
    ]
  },
  {
    name: "hallucinated-citations-rejected",
    category: "grounding",
    fileName: "charging.log",
    logContent: chargingLog,
    model: jsonModel({
      ...groundedPayload,
      conclusion: "Fabricated conclusion citing lines that do not exist.",
      evidence: [
        {
          lineNumbers: [999, 1234],
          inference: "These lines do not exist in the log.",
          suggestedAction: "Should never surface."
        }
      ]
    }),
    expectations: [
      { type: "expectsAnalysisSource", source: "rules-fallback" },
      { type: "expectsDegradedReason", reason: "token-budget-exhausted" },
      { type: "expectsEvidenceNotCitingLines", lineNumbers: [999, 1234] },
      { type: "expectsGroundedEvidence" }
    ]
  },
  {
    name: "partially-hallucinated-citations-pruned",
    category: "grounding",
    fileName: "charging.log",
    logContent: chargingLog,
    model: jsonModel({
      ...groundedPayload,
      evidence: [
        {
          lineNumbers: [4, 999],
          inference: "One real citation and one fabricated citation.",
          suggestedAction: "Keep the real line only."
        }
      ]
    }),
    expectations: [
      { type: "expectsAnalysisSource", source: "agent" },
      { type: "expectsGroundedEvidence" },
      { type: "expectsEvidenceNotCitingLines", lineNumbers: [999] }
    ]
  },
  {
    name: "provider-outage-degrades-honestly",
    category: "degradation",
    fileName: "charging.log",
    logContent: chargingLog,
    model: {
      async invoke() {
        throw new LogAnalysisProviderError("Simulated provider outage.", { modelLabel: "eval-fake" });
      }
    },
    attemptCount: Number.MAX_SAFE_INTEGER,
    expectations: [
      { type: "expectsAnalysisSource", source: "rules-fallback" },
      { type: "expectsDegradedReason", reason: "provider-unavailable" },
      { type: "expectsGroundedEvidence" },
      { type: "expectsPromptVersionRecorded", promptVersion: LOG_ANALYSIS_PROMPT_VERSION }
    ]
  },
  {
    name: "budget-exhausted-marked",
    category: "degradation",
    fileName: "charging.log",
    logContent: chargingLog,
    model: {
      async invoke() {
        return { content: "I could not finish the JSON within the budget, sorry" };
      }
    },
    expectations: [
      { type: "expectsAnalysisSource", source: "rules-fallback" },
      { type: "expectsDegradedReason", reason: "token-budget-exhausted" },
      { type: "expectsGroundedEvidence" }
    ]
  },
  {
    name: "analysis-question-injected-and-answered",
    category: "analysis-question",
    fileName: "charging.log",
    logContent: chargingLog,
    analysisQuestion: "Why did fast charging fold back?",
    logDomain: { name: "charging-power", description: "Charging and power subsystem kernel log" },
    model: jsonModel({
      ...groundedPayload,
      conclusion:
        "Answering 'Why did fast charging fold back?': the pack hit 52C and thermal foldback reduced the current."
    }),
    expectations: [
      { type: "expectsAnalysisSource", source: "agent" },
      { type: "expectsPromptContains", substrings: ["Why did fast charging fold back?", "charging-power"] },
      { type: "requiresSubstringsInConclusion", substrings: ["Why did fast charging fold back?"] },
      { type: "expectsGroundedEvidence" },
      { type: "expectsPromptVersionRecorded", promptVersion: LOG_ANALYSIS_PROMPT_VERSION }
    ]
  }
];

/** Synthetic bad results for the meta self-check: the harness itself must flag them. */
export const META_HALLUCINATED_AGENT_RESULT = {
  output: {
    confidence: 0.99,
    conclusion: "Fabricated grounded-sounding conclusion.",
    impact: "None.",
    severity: "Warning" as const,
    evidence: [
      {
        stageId: "rootcause" as const,
        lineNumbers: [4242],
        inference: "Cites a line that does not exist.",
        suggestedAction: "Nothing."
      }
    ],
    suggestedActions: ["Nothing."],
    reportContext: { lineCount: 6, entryCount: 6 },
    analysisSource: "agent" as const,
    promptVersion: LOG_ANALYSIS_PROMPT_VERSION,
    model: "eval-fake"
  },
  parsedLineNumbers: [1, 2, 3, 4, 5, 6],
  promptMessages: []
};

export const META_SILENT_DEGRADATION_RESULT = {
  output: {
    ...META_HALLUCINATED_AGENT_RESULT.output,
    evidence: [
      {
        stageId: "rootcause" as const,
        lineNumbers: [4],
        inference: "Valid line.",
        suggestedAction: "Nothing."
      }
    ],
    // A fallback report that "forgets" to mark itself degraded must fail the honesty check.
    analysisSource: "rules-fallback" as const,
    degradedReason: undefined
  },
  parsedLineNumbers: [1, 2, 3, 4, 5, 6],
  promptMessages: []
};
