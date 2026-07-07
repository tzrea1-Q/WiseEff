import type { HotspotScoreBreakdown } from "../../../../src/domain/parameters/dashboardTypes";

export type WindowProfile = {
  requestWeight: number;
  parameterWeight: number;
  logWeight: number;
};

export const WINDOW_PROFILES: Record<"7d" | "30d" | "180d", WindowProfile> = {
  "7d": { requestWeight: 1.25, parameterWeight: 0.75, logWeight: 0.65 },
  "30d": { requestWeight: 1, parameterWeight: 1, logWeight: 1 },
  "180d": { requestWeight: 0.9, parameterWeight: 1.15, logWeight: 1.2 }
};

export type ScoreInput = {
  parameterCount: number;
  relatedRequestCount: number;
  definitionCount: number;
  logSignalCount: number;
  highRiskCount: number;
  riskWeightSum: number;
  driftSum: number;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export function scoreHotspotGroup(input: ScoreInput, profile: WindowProfile): HotspotScoreBreakdown & { score: number } {
  const frequency = round1(input.parameterCount * 4 * profile.parameterWeight + input.relatedRequestCount * 10 * profile.requestWeight);
  const risk = input.riskWeightSum * 6;
  const impact = round1(input.definitionCount * 5 + input.logSignalCount * 8 * profile.logWeight);
  const workflow = round1(input.relatedRequestCount * 14 * profile.requestWeight + input.highRiskCount * 3);
  const drift = round1(input.driftSum);
  const score = round1(frequency + risk + impact + workflow + drift);
  return { frequency, risk, impact, workflow, drift, score };
}

export function mapStatus(highRiskCount: number, score: number): { label: string; level: "watch" | "elevated" | "normal" } {
  if (highRiskCount > 0 && score >= 200) return { label: "需要关注", level: "watch" };
  if (score >= 140) return { label: "偏高", level: "elevated" };
  return { label: "正常", level: "normal" };
}
