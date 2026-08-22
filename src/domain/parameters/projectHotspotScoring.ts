import type { DashboardHotspot, DashboardWindow, HotspotScoreBreakdown } from "./dashboardTypes";

export type BehavioralScoreInput = {
  historyEventsInWindow: number;
  changeRequestsInWindow: number;
  modifiedParamCount: number;
  totalParamCount: number;
  openRequestCount: number;
  returnedInWindow: number;
  contributorsInWindow: number;
  contributorsAllTime: number;
};

export type BehavioralWindowProfile = {
  requestWeight: number;
};

export const BEHAVIORAL_WINDOW_PROFILES: Record<DashboardWindow, BehavioralWindowProfile> = {
  "7d": { requestWeight: 1.25 },
  "30d": { requestWeight: 1 },
  "180d": { requestWeight: 0.9 }
};

const round1 = (value: number) => Math.round(value * 10) / 10;

export function scoreBehavioralHotspot(
  input: BehavioralScoreInput,
  profile: BehavioralWindowProfile
): HotspotScoreBreakdown & { score: number } {
  const modificationRate = input.modifiedParamCount / Math.max(input.totalParamCount, 1);
  const frequency = round1(input.historyEventsInWindow * 3 + input.changeRequestsInWindow * 10 * profile.requestWeight);
  const scope = round1(input.modifiedParamCount * 2 + modificationRate * 100 * 4);
  const workflow = round1(
    input.changeRequestsInWindow * 8 * profile.requestWeight + input.openRequestCount * 5 + input.returnedInWindow * 12
  );
  const collaboration = round1(input.contributorsInWindow * 15 + input.contributorsAllTime * 3);
  const score = round1(frequency + scope + workflow + collaboration);

  return { frequency, scope, workflow, collaboration, score };
}

export function mapBehavioralHotspotStatus(
  input: Pick<BehavioralScoreInput, "changeRequestsInWindow" | "openRequestCount" | "modifiedParamCount" | "totalParamCount"> & {
    score: number;
  }
): { label: string; level: "watch" | "elevated" | "normal" } {
  const modificationRate = input.modifiedParamCount / Math.max(input.totalParamCount, 1);

  if (input.score >= 180 || input.openRequestCount >= 10 || modificationRate >= 0.15) {
    return { label: "需要关注", level: "watch" };
  }
  if (input.score >= 100 || input.changeRequestsInWindow >= 5) {
    return { label: "偏高", level: "elevated" };
  }
  return { label: "正常", level: "normal" };
}

export function buildBehavioralHotspotEvidence(
  input: BehavioralScoreInput,
  kind: DashboardHotspot["kind"] = "project"
): string[] {
  const rate = Math.round((input.modifiedParamCount / Math.max(input.totalParamCount, 1)) * 100);
  const scopeLine =
    kind === "parameter"
      ? `已在 ${input.modifiedParamCount} / ${input.totalParamCount} 个项目中修改（${rate}%）`
      : `累计修改 ${input.modifiedParamCount} / ${input.totalParamCount} 个参数（${rate}%）`;

  return [
    scopeLine,
    `窗口内 ${input.historyEventsInWindow} 次参数变更`,
    `待处理流程 ${input.openRequestCount} 项 · 窗口内 ${input.changeRequestsInWindow} 项请求`
  ];
}

export function toBehavioralScoreInput(group: {
  parameterCount: number;
  relatedRequestCount: number;
  historyEventsInWindow: number;
  modifiedParamCount: number;
  openRequestCount: number;
  returnedInWindow: number;
  contributorsInWindow: number;
  contributorsAllTime: number;
}): BehavioralScoreInput {
  return {
    historyEventsInWindow: group.historyEventsInWindow,
    changeRequestsInWindow: group.relatedRequestCount,
    modifiedParamCount: group.modifiedParamCount,
    totalParamCount: group.parameterCount,
    openRequestCount: group.openRequestCount,
    returnedInWindow: group.returnedInWindow,
    contributorsInWindow: group.contributorsInWindow,
    contributorsAllTime: group.contributorsAllTime
  };
}
