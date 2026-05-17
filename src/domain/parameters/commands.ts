import { projects, roles, type PrototypeState } from "@/mockData";
import { buildAISuggestion, buildImpactItems, REVIEW_MOCK_NOW } from "@/reviewMockData";
import type { ChangeRequest, ParameterDraftItem, ParameterRecord, ParameterSubmissionItem } from "./types";

function buildRuntimeReviewFields(summary: string, module: string) {
  const suggestion = buildAISuggestion({
    recommendation: "needs-review",
    confidence: "mid",
    summary,
    reasons: ["运行时提交需要管理员复核", "AI 尚未拿到完整审阅证据", "建议结合参数历史与影响范围确认"],
    similarRequests: []
  });

  return {
    createdAtTs: REVIEW_MOCK_NOW,
    updatedAt: REVIEW_MOCK_NOW,
    waitingHours: 0,
    aiSummary: suggestion.summary,
    aiSuggestion: suggestion,
    impact: buildImpactItems(module)
  };
}

export type SubmitParameterRoundInput = { items: ParameterDraftItem[]; reason?: string };

export function submitParameterRound(state: PrototypeState, input: SubmitParameterRoundInput): PrototypeState {
  const draftItems = input.items
    .map((item) => {
      const parameter = state.parameters.find((candidate) => candidate.id === item.parameterId);
      return parameter ? { parameter, item } : null;
    })
    .filter((item): item is { parameter: ParameterRecord; item: ParameterDraftItem } => Boolean(item));

  if (draftItems.length === 0) {
    return state;
  }

  const project = projects.find((item) => item.id === draftItems[0].parameter.projectId);
  const submitter = roles.find((role) => role.id === state.activeRoleId)?.name ?? "平台用户";
  const roundId = `PRS-${2406 + state.parameterSubmissionRounds.length}`;
  const requestSeed = 8910 + state.changeRequests.length;
  const requests = draftItems.map(({ parameter, item }, index): ChangeRequest => {
    const summary = item.reason || "本轮参数修改已生成影响摘要，建议参数管理员按轮次审阅。";

    return {
      id: `PRQ-${requestSeed + index}`,
      submissionRoundId: roundId,
      projectId: parameter.projectId,
      parameterId: parameter.id,
      module: parameter.module,
      title: parameter.name,
      currentValue: parameter.currentValue,
      targetValue: item.targetValue,
      submitter,
      createdAt: "刚刚",
      status: "待审阅",
      ...buildRuntimeReviewFields(summary, parameter.module)
    };
  });
  const submissionItems = draftItems.map(({ parameter, item }, index): ParameterSubmissionItem => ({
    requestId: requests[index].id,
    parameterId: parameter.id,
    name: parameter.name,
    module: parameter.module,
    currentValue: parameter.currentValue,
    targetValue: item.targetValue,
    unit: parameter.unit,
    risk: parameter.risk,
    reason: item.reason || "本轮参数修改已生成影响摘要，建议参数管理员按轮次审阅。"
  }));

  return {
    ...state,
    changeRequests: [...requests, ...state.changeRequests],
    parameterSubmissionRounds: [
      {
        id: roundId,
        projectId: draftItems[0].parameter.projectId,
        projectName: project?.name ?? draftItems[0].parameter.projectId,
        submitter,
        createdAt: "刚刚",
        status: "待审阅",
        summary: `本轮提交包含 ${submissionItems.length} 个参数修改。`,
        items: submissionItems
      },
      ...state.parameterSubmissionRounds
    ],
    notifications: [`已提交 ${roundId}，包含 ${submissionItems.length} 个参数修改`, ...state.notifications]
  };
}
