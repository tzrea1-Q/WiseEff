import type { LogAnalysisSource, LogDegradedReason } from "./types";

export type AnalysisDegradation = {
  kind: "rules-fallback" | "early-convergence";
  label: string;
  reason: string;
};

const fallbackReasonSentences: Record<LogDegradedReason, string> = {
  "provider-unavailable": "AI 分析服务不可用，本结论由规则引擎回退生成",
  "token-budget-exhausted": "预算内未能得到有效接地结论，本结论由规则引擎回退生成"
};

/**
 * Classifies how an analysis was degraded, with its label and reason sentence.
 * Rules-fallback means the rules engine produced the conclusion; an agent
 * analysis carrying a degraded reason converged early on an exhausted budget
 * (P2 loop kernel) — still degraded, never presented as a full analysis.
 * Returns null for full agent analyses and legacy reports.
 *
 * The server keeps a copy in `server/modules/knowledge/distillation.ts`.
 */
export function classifyAnalysisDegradation(analysis: {
  analysisSource?: LogAnalysisSource | null;
  degradedReason?: LogDegradedReason;
}): AnalysisDegradation | null {
  if (analysis.analysisSource === "rules-fallback") {
    return {
      kind: "rules-fallback",
      label: "降级分析 · 规则回退",
      reason: analysis.degradedReason ? fallbackReasonSentences[analysis.degradedReason] : "本结论由规则引擎回退生成"
    };
  }
  if (analysis.analysisSource === "agent" && analysis.degradedReason !== undefined) {
    return {
      kind: "early-convergence",
      label: "降级分析 · 提前收敛",
      reason: "分析步数或 token 预算耗尽，Agent 基于已读证据提前收敛为低置信结论"
    };
  }
  return null;
}
