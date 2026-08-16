import type { LogAnalysisSource } from "./types";

/**
 * Caption for the always-visible confidence percent.
 * Provenance-specific labels distinguish uncalibrated model self-estimates
 * from deterministic rules-engine scores; legacy reports keep the caller's
 * existing copy (`AI置信度` on `/logs`, `置信度` on `/log-admin`).
 */
export function confidenceCaption(
  analysisSource: LogAnalysisSource | null | undefined,
  legacyCaption: string
): string {
  if (analysisSource === "agent") {
    return "模型自估";
  }
  if (analysisSource === "rules-fallback") {
    return "规则评分";
  }
  return legacyCaption;
}
