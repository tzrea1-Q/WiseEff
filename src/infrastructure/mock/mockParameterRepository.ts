import type {
  ApplyParameterImportBatchInput,
  ParameterDraftDto,
  ParameterImportBatchDto,
  ParameterImportPreviewInput,
  ParameterImportSourceItem,
  ParameterListQuery,
  ParameterRepository,
  ProjectSummary,
  ReviewParameterChangeInput,
  SaveParameterDraftInput,
  SubmitParameterChangesInput
} from "@/application/ports/ParameterRepository";
import { submitParameterRound, type BuildRuntimeReviewFields } from "@/domain/parameters/commands";
import type { ChangeRequest, ParameterHistoryEntry, ParameterRecord, ParameterSubmissionRound } from "@/domain/parameters/types";
import { canPerform } from "@/app/permissions";
import { roleSupportsWorkflowSlot } from "@/domain/users/types";
import { projects, roles, type PrototypeState } from "@/mockData";
import { buildAISuggestion, buildImpactItems, REVIEW_MOCK_NOW } from "@/reviewMockData";
import { type MockRuntimeState, readMockState, writeMockState } from "./mockState";

function matchesQuery(parameter: ParameterRecord, query?: ParameterListQuery) {
  if (!query) return true;
  if (query.projectId && parameter.projectId !== query.projectId) return false;
  if (query.module && parameter.module !== query.module) return false;
  if (query.risk && query.risk.length > 0 && !query.risk.includes(parameter.risk)) return false;
  return true;
}

function cloneParameterRecord(parameter: ParameterRecord): ParameterRecord {
  return {
    ...parameter,
    history: parameter.history.map((entry) => ({ ...entry }))
  };
}

function cloneChangeRequest(request: ChangeRequest): ChangeRequest {
  return {
    ...request,
    aiSuggestion: {
      ...request.aiSuggestion,
      reasons: [...request.aiSuggestion.reasons],
      similarRequests: [...request.aiSuggestion.similarRequests]
    },
    impact: request.impact.map((item) => ({ ...item }))
  };
}

function cloneSubmissionRound(round: ParameterSubmissionRound): ParameterSubmissionRound {
  return {
    ...round,
    items: round.items.map((item) => ({ ...item }))
  };
}

const MOCK_CONTRACT_NOW = "2026-05-25T00:00:00.000Z";

type MockParameterRepositoryRuntimeState = MockRuntimeState & {
  parameterDrafts?: ParameterDraftDto[];
};

function slugForId(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildImportBatch(input: { projectId: string; sourceName: string; items: ParameterImportSourceItem[] }, status: ParameterImportBatchDto["status"]): ParameterImportBatchDto {
  const highRisk = input.items.filter((item) => item.risk === "High").length;
  const batchId = `import-${input.projectId}-${slugForId(input.sourceName)}`;

  return {
    id: batchId,
    projectId: input.projectId,
    sourceName: input.sourceName,
    status,
    createdAt: MOCK_CONTRACT_NOW,
    appliedAt: status === "applied" ? MOCK_CONTRACT_NOW : undefined,
    summary: {
      added: input.items.length,
      updated: 0,
      unchanged: 0,
      conflict: 0,
      highRisk
    },
    items: input.items.map((item, index) => ({
      ...item,
      id: `${batchId}-item-${index + 1}`
    }))
  };
}

function cloneImportBatch(batch: ParameterImportBatchDto): ParameterImportBatchDto {
  return {
    ...batch,
    summary: { ...batch.summary },
    items: batch.items.map((item) => ({ ...item }))
  };
}

function readDrafts(runtime: MockParameterRepositoryRuntimeState) {
  return runtime.parameterDrafts ?? [];
}

function writeDrafts(runtime: MockParameterRepositoryRuntimeState, drafts: ParameterDraftDto[]) {
  runtime.parameterDrafts = drafts;
}

function cloneDraft(draft: ParameterDraftDto): ParameterDraftDto {
  return { ...draft };
}

function getNextReviewStep(request: ChangeRequest): Pick<ChangeRequest, "status" | "assignedTo"> {
  switch (request.status) {
    case "硬件Committer检视":
    case "待审阅":
      return {
        status: "软件Committer检视",
        assignedTo: request.workflowAssignees?.softwareCommitterId ?? request.assignedTo
      };
    case "软件Committer检视":
    case "自动检查通过":
      return {
        status: "软件User合入",
        assignedTo: request.workflowAssignees?.softwareUserId ?? request.assignedTo
      };
    default:
      return {
        status: "已合入",
        assignedTo: request.assignedTo
      };
  }
}

function updateRoundStatusAfterRequest(rounds: ParameterSubmissionRound[], request: ChangeRequest, status: ChangeRequest["status"]) {
  if (!request.submissionRoundId) {
    return rounds;
  }

  return rounds.map((round) => (round.id === request.submissionRoundId ? { ...round, status } : round));
}

function canAdvanceReviewRequest(activeRoleId: string, request: ChangeRequest) {
  if (request.status === "软件User合入") {
    return roleSupportsWorkflowSlot(activeRoleId, "softwareUser");
  }

  return canPerform(activeRoleId, "parameter.review");
}

function applyReviewChange(state: PrototypeState, input: ReviewParameterChangeInput): PrototypeState {
  const target = state.changeRequests.find((request) => request.id === input.requestId);
  if (!target) {
    throw new Error(`Change request not found: ${input.requestId}`);
  }

  if (input.decision === "reject") {
    if (!canPerform(state.activeRoleId, "parameter.review")) return state;
    return {
      ...state,
      changeRequests: state.changeRequests.map((request) =>
        request.id === input.requestId
          ? {
              ...request,
              status: "已打回",
              rejectReason: input.note,
              updatedAt: new Date().toISOString()
            }
          : request
      ),
      parameterSubmissionRounds: updateRoundStatusAfterRequest(state.parameterSubmissionRounds, target, "已打回")
    };
  }

  if (!canAdvanceReviewRequest(state.activeRoleId, target)) return state;
  const nextStep = getNextReviewStep(target);

  return {
    ...state,
    changeRequests: state.changeRequests.map((request) =>
      request.id === input.requestId
        ? {
            ...request,
            ...nextStep,
            reviewerNote: input.note ?? request.reviewerNote,
            updatedAt: new Date().toISOString()
          }
        : request
    ),
    parameterSubmissionRounds: updateRoundStatusAfterRequest(state.parameterSubmissionRounds, target, nextStep.status)
  };
}

const buildRuntimeReviewFields: BuildRuntimeReviewFields = (summary, module) => {
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
};

export function createMockParameterRepository(runtime: MockRuntimeState): ParameterRepository {
  const repositoryRuntime = runtime as MockParameterRepositoryRuntimeState;
  const importBatches = new Map<string, ParameterImportBatchDto>();

  return {
    async listProjects(): Promise<ProjectSummary[]> {
      return [...projects];
    },
    async listParameters(query?: ParameterListQuery): Promise<ParameterRecord[]> {
      return readMockState(runtime).parameters.filter((parameter) => matchesQuery(parameter, query)).map(cloneParameterRecord);
    },
    async getParameter(parameterId: string): Promise<ParameterRecord> {
      const parameter = readMockState(runtime).parameters.find((row) => row.id === parameterId);
      if (!parameter) throw new Error(`Parameter not found: ${parameterId}`);
      return cloneParameterRecord(parameter);
    },
    async listParameterHistory(parameterId: string): Promise<ParameterHistoryEntry[]> {
      const parameter = readMockState(runtime).parameters.find((row) => row.id === parameterId);
      if (!parameter) throw new Error(`Parameter not found: ${parameterId}`);
      return parameter.history.map((entry) => ({ ...entry }));
    },
    async listDrafts(projectId?: string): Promise<ParameterDraftDto[]> {
      return readDrafts(repositoryRuntime)
        .filter((draft) => !projectId || draft.projectId === projectId)
        .map(cloneDraft);
    },
    async saveDraft(input: SaveParameterDraftInput): Promise<ParameterDraftDto> {
      const draft = {
        id: `draft-${input.projectId}-${input.parameterId}`,
        projectId: input.projectId,
        parameterId: input.parameterId,
        targetValue: input.targetValue,
        reason: input.reason,
        updatedAt: MOCK_CONTRACT_NOW
      };
      writeDrafts(repositoryRuntime, [
        draft,
        ...readDrafts(repositoryRuntime).filter((item) => item.id !== draft.id && !(item.projectId === input.projectId && item.parameterId === input.parameterId))
      ]);
      return cloneDraft(draft);
    },
    async deleteDraft(draftId: string): Promise<void> {
      writeDrafts(
        repositoryRuntime,
        readDrafts(repositoryRuntime).filter((draft) => draft.id !== draftId)
      );
    },
    async listChangeRequests(): Promise<ChangeRequest[]> {
      return readMockState(runtime).changeRequests.map(cloneChangeRequest);
    },
    async listSubmissionRounds(): Promise<ParameterSubmissionRound[]> {
      return readMockState(runtime).parameterSubmissionRounds.map(cloneSubmissionRound);
    },
    async submitParameterChanges(input: SubmitParameterChangesInput): Promise<ParameterSubmissionRound> {
      const before = readMockState(runtime);
      const next = submitParameterRound(before, { ...input, projects, roles, buildRuntimeReviewFields });
      writeMockState(runtime, next);
      return cloneSubmissionRound(next.parameterSubmissionRounds[0]);
    },
    async reviewChange(input: ReviewParameterChangeInput): Promise<ChangeRequest> {
      const next = applyReviewChange(readMockState(runtime), input);
      writeMockState(runtime, next);
      const request = readMockState(runtime).changeRequests.find((row) => row.id === input.requestId);
      if (!request) throw new Error(`Change request not found: ${input.requestId}`);
      return cloneChangeRequest(request);
    },
    async createImportPreview(input: ParameterImportPreviewInput): Promise<ParameterImportBatchDto> {
      const batch = buildImportBatch(input, "previewed");
      importBatches.set(batch.id, cloneImportBatch(batch));
      return cloneImportBatch(batch);
    },
    async applyImportBatch(input: ApplyParameterImportBatchInput): Promise<ParameterImportBatchDto> {
      const batch = importBatches.get(input.batchId);
      if (!batch) throw new Error(`Import batch not found: ${input.batchId}`);
      const applied = {
        ...batch,
        status: "applied" as const,
        appliedAt: MOCK_CONTRACT_NOW,
        summary: { ...batch.summary },
        items: batch.items.map((item) => ({ ...item }))
      };
      importBatches.set(input.batchId, cloneImportBatch(applied));
      return cloneImportBatch(applied);
    }
  };
}
