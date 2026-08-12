import { LOG_ANALYSIS_LOOP_PROMPT_VERSION } from "../analyzer/agentLoop";
import { LOG_ANALYSIS_PROMPT_VERSION, LogAnalysisProviderError, type LogAnalysisChatModel } from "../analyzer/llmAnalyzer";
import type { ScriptedModelResponse } from "../analyzer/scriptedModel";
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

/**
 * P2 loop scenarios: scripted "tool-call sequence + final conclusion" responses
 * drive the real bounded agent-loop kernel. Same CI gate, still zero API cost.
 */
export type LogLoopEvalScenario = {
  name: string;
  category: string;
  fileName: string;
  logContent: string;
  analysisQuestion?: string;
  logDomain?: { name: string; description?: string };
  script: ScriptedModelResponse[];
  maxSteps?: number;
  tokenBudget?: number;
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

const loopFinalPayload = {
  action: "final",
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

const nominalLog = [
  "2026-08-10T09:00:01Z INFO agentd heartbeat ok seq=1",
  "2026-08-10T09:00:31Z INFO agentd heartbeat ok seq=2",
  "2026-08-10T09:01:01Z INFO agentd heartbeat ok seq=3",
  "2026-08-10T09:01:31Z INFO agentd config checksum stable checksum=9f31aa"
].join("\n");

export const LOG_LOOP_EVAL_SCENARIOS: LogLoopEvalScenario[] = [
  {
    name: "loop-in-budget-convergence",
    category: "loop-convergence",
    fileName: "charging.log",
    logContent: chargingLog,
    script: [
      { content: { action: "tool", tool: "get_prefilter_findings", args: {} } },
      { content: { action: "tool", tool: "read_line_range", args: { startLine: 2, endLine: 5 } } },
      { content: loopFinalPayload }
    ],
    expectations: [
      { type: "expectsAnalysisSource", source: "agent" },
      { type: "expectsNoDegradation" },
      { type: "expectsGroundedEvidence" },
      { type: "expectsModelCallCount", count: 3 },
      { type: "expectsPromptVersionRecorded", promptVersion: LOG_ANALYSIS_LOOP_PROMPT_VERSION }
    ]
  },
  {
    name: "loop-illegal-tool-name-rejected-and-corrected",
    category: "loop-tool-legality",
    fileName: "charging.log",
    logContent: chargingLog,
    script: [
      { content: { action: "tool", tool: "write_device_parameter", args: { value: 42 } } },
      { content: loopFinalPayload }
    ],
    expectations: [
      { type: "expectsAnalysisSource", source: "agent" },
      { type: "expectsNoDegradation" },
      { type: "expectsPromptContains", substrings: ["Tool call rejected", 'Unknown tool "write_device_parameter"'] },
      { type: "expectsGroundedEvidence" }
    ]
  },
  {
    name: "loop-illegal-tool-args-rejected-and-corrected",
    category: "loop-tool-legality",
    fileName: "charging.log",
    logContent: chargingLog,
    script: [
      { content: { action: "tool", tool: "read_line_range", args: { startLine: 0, endLine: -5 } } },
      { content: loopFinalPayload }
    ],
    expectations: [
      { type: "expectsAnalysisSource", source: "agent" },
      { type: "expectsPromptContains", substrings: ['Invalid arguments for tool "read_line_range"'] },
      { type: "expectsGroundedEvidence" }
    ]
  },
  {
    name: "loop-persistent-illegal-calls-degrade-honestly",
    category: "loop-tool-legality",
    fileName: "charging.log",
    logContent: chargingLog,
    script: [
      { content: { action: "tool", tool: "bogus_one", args: {} } },
      { content: { action: "tool", tool: "bogus_two", args: {} } },
      { content: { action: "tool", tool: "bogus_three", args: {} } }
    ],
    expectations: [
      { type: "expectsAnalysisSource", source: "rules-fallback" },
      { type: "expectsDegradedReason", reason: "token-budget-exhausted" },
      { type: "expectsGroundedEvidence" }
    ]
  },
  {
    name: "loop-step-limit-early-convergence",
    category: "loop-convergence",
    fileName: "charging.log",
    logContent: chargingLog,
    maxSteps: 2,
    script: [
      { content: { action: "tool", tool: "get_prefilter_findings", args: {} } },
      { content: { action: "tool", tool: "read_line_range", args: { startLine: 1, endLine: 6 } } },
      { content: { ...loopFinalPayload, confidence: 0.95 } }
    ],
    expectations: [
      { type: "expectsAnalysisSource", source: "agent" },
      { type: "expectsDegradedReason", reason: "token-budget-exhausted" },
      { type: "expectsConfidenceAtMost", value: 0.5 },
      { type: "expectsGroundedEvidence" },
      { type: "expectsPromptContains", substrings: ["Budget exhausted"] }
    ]
  },
  {
    name: "loop-token-budget-early-convergence",
    category: "loop-convergence",
    fileName: "charging.log",
    logContent: chargingLog,
    tokenBudget: 500,
    script: [
      {
        content: { action: "tool", tool: "get_prefilter_findings", args: {} },
        usage: { inputTokens: 600, outputTokens: 40 }
      },
      { content: { ...loopFinalPayload, confidence: 0.9 } }
    ],
    expectations: [
      { type: "expectsAnalysisSource", source: "agent" },
      { type: "expectsDegradedReason", reason: "token-budget-exhausted" },
      { type: "expectsConfidenceAtMost", value: 0.5 },
      { type: "expectsModelCallCount", count: 2 },
      { type: "expectsGroundedEvidence" }
    ]
  },
  {
    name: "loop-honest-refusal-on-insufficient-evidence",
    category: "loop-honesty",
    fileName: "nominal.log",
    logContent: nominalLog,
    analysisQuestion: "Is anything failing on this node?",
    script: [
      { content: { action: "tool", tool: "get_prefilter_findings", args: {} } },
      { content: { action: "tool", tool: "read_line_range", args: { startLine: 1, endLine: 4 } } },
      {
        content: {
          action: "final",
          conclusion:
            "The evidence is insufficient for a failure diagnosis: all reviewed lines show nominal heartbeats and a stable config checksum.",
          impact: "No operational impact was identified in the reviewed window.",
          severity: "Info",
          confidence: 0.3,
          suggestedActions: ["Collect a longer capture if symptoms persist."],
          evidence: [
            {
              lineNumbers: [1, 4],
              inference: "Heartbeats stay nominal and the config checksum is stable.",
              suggestedAction: "No action required unless symptoms recur."
            }
          ]
        }
      }
    ],
    expectations: [
      { type: "expectsAnalysisSource", source: "agent" },
      { type: "expectsNoDegradation" },
      { type: "expectsConfidenceAtMost", value: 0.5 },
      { type: "expectsGroundedEvidence" },
      { type: "requiresSubstringsInConclusion", substrings: ["insufficient"] }
    ]
  },
  {
    name: "loop-multi-step-grounding-enforced",
    category: "loop-grounding",
    fileName: "charging.log",
    logContent: chargingLog,
    script: [
      { content: { action: "tool", tool: "search_log_lines", args: { pattern: "thermal" } } },
      {
        content: {
          ...loopFinalPayload,
          evidence: [{ lineNumbers: [999, 1234], inference: "Fabricated after tools.", suggestedAction: "None." }]
        }
      },
      { content: loopFinalPayload }
    ],
    expectations: [
      { type: "expectsAnalysisSource", source: "agent" },
      { type: "expectsPromptContains", substrings: ["Grounding violation"] },
      { type: "expectsGroundedEvidence" },
      { type: "expectsEvidenceNotCitingLines", lineNumbers: [999, 1234] }
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

/** A loop kernel that converges early but keeps high confidence must fail the honesty check. */
export const META_OVERCONFIDENT_CONVERGENCE_RESULT = {
  output: {
    ...META_SILENT_DEGRADATION_RESULT.output,
    analysisSource: "agent" as const,
    degradedReason: "token-budget-exhausted" as const,
    confidence: 0.95,
    promptVersion: LOG_ANALYSIS_LOOP_PROMPT_VERSION
  },
  parsedLineNumbers: [1, 2, 3, 4, 5, 6],
  promptMessages: []
};

/** A loop kernel that silently accepts an illegal tool never emits the corrective message. */
export const META_SILENT_ILLEGAL_TOOL_RESULT = {
  output: META_SILENT_DEGRADATION_RESULT.output,
  parsedLineNumbers: [1, 2, 3, 4, 5, 6],
  promptMessages: [
    { role: "system" as const, content: "loop system prompt" },
    { role: "assistant" as const, content: '{"action":"tool","tool":"write_device_parameter","args":{}}' },
    { role: "user" as const, content: "Tool result for write_device_parameter:\n{\"ok\":true}" }
  ]
};
