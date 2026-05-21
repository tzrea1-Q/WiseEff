import type {
  ChangeRequest,
  ParameterDraftItem,
  ParameterRecord,
  ParameterSubmissionItem,
  ParameterSubmissionRound
} from "./types";

type RuntimeReviewFields = Pick<
  ChangeRequest,
  "createdAtTs" | "updatedAt" | "waitingHours" | "aiSummary" | "aiSuggestion" | "impact"
>;

export type BuildRuntimeReviewFields = (summary: string, module: string) => RuntimeReviewFields;

type ProjectSummary = {
  id: string;
  name: string;
};

type SubmitterRole = {
  id: string;
  name: string;
};

type ParameterRoundState = {
  parameters: ParameterRecord[];
  activeRoleId: string;
  changeRequests: ChangeRequest[];
  parameterSubmissionRounds: ParameterSubmissionRound[];
  notifications: string[];
};

export type SubmitParameterRoundInput = {
  items: ParameterDraftItem[];
  reason?: string;
  projects: ProjectSummary[];
  roles: SubmitterRole[];
  buildRuntimeReviewFields: BuildRuntimeReviewFields;
};

export function submitParameterRound<TState extends ParameterRoundState>(state: TState, input: SubmitParameterRoundInput): TState {
  const draftItems = input.items
    .map((item) => {
      const parameter = state.parameters.find((candidate) => candidate.id === item.parameterId);
      return parameter ? { parameter, item } : null;
    })
    .filter((item): item is { parameter: ParameterRecord; item: ParameterDraftItem } => Boolean(item));

  if (draftItems.length === 0) {
    return state;
  }

  const targetProjectIds = new Set(draftItems.map(({ parameter }) => parameter.projectId));
  if (targetProjectIds.size !== 1) {
    return state;
  }

  const project = input.projects.find((item) => item.id === draftItems[0].parameter.projectId);
  const submitter = input.roles.find((role) => role.id === state.activeRoleId)?.name ?? "平台用户";
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
      ...input.buildRuntimeReviewFields(summary, parameter.module)
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
  } as TState;
}
