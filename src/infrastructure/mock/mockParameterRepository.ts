import type {
  ApplyParameterImportBatchInput,
  ParameterDraftDto,
  ParameterImportBatchDto,
  ParameterImportPreviewInput,
  ParameterImportSourceItem,
  ChangeRequestListQuery,
  ParameterListQuery,
  ParameterRepository,
  ProjectSummary,
  ReviewParameterChangeInput,
  SaveParameterDraftInput,
  SubmissionRoundListQuery,
  SubmitParameterChangesInput
} from "@/application/ports/ParameterRepository";
import { submitParameterRound, type BuildRuntimeReviewFields } from "@/domain/parameters/commands";
import type { ChangeRequest, ParameterHistoryEntry, ParameterRecord, ParameterSubmissionRound } from "@/domain/parameters/types";
import { requestStatusToBackend } from "@/domain/parameters/submissionWorkflowTrail";
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

function matchesChangeRequestQuery(request: ChangeRequest, query?: ChangeRequestListQuery) {
  if (!query) return true;
  if (query.projectId && request.projectId !== query.projectId) return false;
  if (query.assignedTo && request.assignedTo !== query.assignedTo) return false;
  if (query.status && query.status.length > 0 && !query.status.includes(request.status)) return false;
  return true;
}

function matchesSubmissionRoundQuery(round: ParameterSubmissionRound, query?: SubmissionRoundListQuery) {
  if (!query) return true;
  if (query.projectId && round.projectId !== query.projectId) return false;
  if (query.status && query.status.length > 0 && !query.status.includes(round.status)) return false;
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
  const items = input.items.map((item, index) => {
    const hintedItem = item as ParameterImportSourceItem & Partial<Pick<ParameterImportBatchDto["items"][number], "classification" | "riskFlag">>;
    return {
      ...item,
      id: `${batchId}-item-${index + 1}`,
      classification: hintedItem.classification ?? ("added" as const),
      riskFlag: hintedItem.riskFlag ?? item.risk === "High"
    };
  });

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
    items
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

function importParameterId(projectId: string, name: string) {
  return `${projectId}-${slugForId(name)}`;
}

function importItemToParameterRecord(projectId: string, item: ParameterImportBatchDto["items"][number]): ParameterRecord {
  const currentValue = item.currentValue ?? item.recommendedValue ?? "";
  const recommendedValue = item.recommendedValue ?? item.currentValue ?? "";
  return {
    id: importParameterId(projectId, item.name),
    name: item.name,
    description: item.description ?? `${item.name} imported from mock parameter batch.`,
    explanation: item.explanation ?? "",
    configFormat: item.configFormat ?? "",
    module: item.module,
    projectId,
    currentValue,
    recommendedValue,
    range: item.range,
    unit: item.unit,
    risk: item.risk,
    valueKind: "scalar",
    updatedAt: MOCK_CONTRACT_NOW,
    updatedAtTs: MOCK_CONTRACT_NOW,
    history: [
      {
        version: "mock-import",
        value: currentValue,
        changedAt: MOCK_CONTRACT_NOW,
        changedBy: "Mock import"
      }
    ]
  };
}

function applyImportItemsToState(state: PrototypeState, batch: ParameterImportBatchDto, selectedItemIds?: string[]): PrototypeState {
  const selectedIds = selectedItemIds ? new Set(selectedItemIds) : null;
  const selectedItems = batch.items.filter((item) =>
    selectedIds
      ? selectedIds.has(item.id) && (item.classification === "added" || item.classification === "updated")
      : item.classification === "added" || item.classification === "updated"
  );

  if (selectedItems.length === 0) {
    return state;
  }

  const parameters = [...state.parameters];
  const configParameterLibrary = [...state.configDraft.parameterLibrary];

  for (const item of selectedItems) {
    const existingIndex = parameters.findIndex((parameter) => parameter.projectId === batch.projectId && parameter.name === item.name);
    const existing = existingIndex >= 0 ? parameters[existingIndex] : undefined;
    const imported = importItemToParameterRecord(batch.projectId, item);
    const nextParameter = existing
      ? {
          ...existing,
          description: item.description ?? existing.description,
          explanation: item.explanation ?? existing.explanation,
          configFormat: item.configFormat ?? existing.configFormat,
          module: item.module,
          currentValue: item.currentValue ?? existing.currentValue,
          recommendedValue: item.recommendedValue ?? existing.recommendedValue,
          range: item.range,
          unit: item.unit,
          risk: item.risk,
          updatedAt: MOCK_CONTRACT_NOW,
          updatedAtTs: MOCK_CONTRACT_NOW
        }
      : imported;

    if (existingIndex >= 0) {
      parameters[existingIndex] = nextParameter;
    } else {
      parameters.push(nextParameter);
    }

    const libraryId = existing?.id.startsWith(`${batch.projectId}-`) ? existing.id.slice(batch.projectId.length + 1) : slugForId(item.name);
    const libraryIndex = configParameterLibrary.findIndex((parameter) => parameter.id === libraryId);
    const existingLibrary = libraryIndex >= 0 ? configParameterLibrary[libraryIndex] : undefined;
    const currentValue = item.currentValue ?? existing?.currentValue ?? item.recommendedValue ?? "";
    const recommendedValue = item.recommendedValue ?? existing?.recommendedValue ?? item.currentValue ?? "";
    const valueKind = existing?.valueKind ?? existingLibrary?.valueKind ?? "scalar";
    const nextLibrary = {
      id: libraryId,
      name: item.name,
      description: item.description ?? existingLibrary?.description ?? nextParameter.description,
      explanation: item.explanation ?? existingLibrary?.explanation ?? nextParameter.explanation,
      configFormat: item.configFormat ?? existingLibrary?.configFormat ?? nextParameter.configFormat,
      module: item.module,
      range: item.range,
      unit: item.unit,
      risk: item.risk,
      valueKind,
      values: {
        ...(existingLibrary?.values ?? {}),
        [batch.projectId]: {
          currentValue,
          recommendedValue,
          updatedAt: MOCK_CONTRACT_NOW
        }
      }
    };

    if (libraryIndex >= 0) {
      configParameterLibrary[libraryIndex] = nextLibrary;
    } else {
      configParameterLibrary.push(nextLibrary);
    }
  }

  return {
    ...state,
    parameters,
    configDraft: {
      ...state.configDraft,
      parameterLibrary: configParameterLibrary
    }
  };
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
    const fromStatus = requestStatusToBackend(target.status);
    return {
      ...state,
      changeRequests: state.changeRequests.map((request) =>
        request.id === input.requestId
          ? {
              ...request,
              status: "已打回",
              rejectReason: input.note,
              updatedAt: MOCK_CONTRACT_NOW
            }
          : request
      ),
      parameterSubmissionRounds: updateRoundStatusAfterRequest(state.parameterSubmissionRounds, target, "已打回"),
      parameterReviewDecisions:
        fromStatus
          ? [
              ...state.parameterReviewDecisions,
              {
                id: `prd-${input.requestId}-${state.parameterReviewDecisions.length + 1}`,
                requestId: input.requestId,
                reviewerUserId: state.currentUserId,
                decision: "reject",
                fromStatus,
                toStatus: "rejected",
                createdAt: MOCK_CONTRACT_NOW
              }
            ]
          : state.parameterReviewDecisions
    };
  }

  if (!canAdvanceReviewRequest(state.activeRoleId, target)) return state;
  const nextStep = getNextReviewStep(target);
  const fromStatus = requestStatusToBackend(target.status);
  const toStatus = requestStatusToBackend(nextStep.status);

  return {
    ...state,
    changeRequests: state.changeRequests.map((request) =>
      request.id === input.requestId
        ? {
            ...request,
            ...nextStep,
            reviewerNote: input.note ?? request.reviewerNote,
            updatedAt: MOCK_CONTRACT_NOW
          }
        : request
    ),
    parameterSubmissionRounds: updateRoundStatusAfterRequest(state.parameterSubmissionRounds, target, nextStep.status),
    parameterReviewDecisions:
      fromStatus && toStatus
        ? [
            ...state.parameterReviewDecisions,
            {
              id: `prd-${input.requestId}-${state.parameterReviewDecisions.length + 1}`,
              requestId: input.requestId,
              reviewerUserId: state.currentUserId,
              decision: "advance",
              fromStatus,
              toStatus,
              createdAt: MOCK_CONTRACT_NOW
            }
          ]
        : state.parameterReviewDecisions
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
    async listChangeRequests(query?: ChangeRequestListQuery): Promise<ChangeRequest[]> {
      return readMockState(runtime).changeRequests.filter((request) => matchesChangeRequestQuery(request, query)).map(cloneChangeRequest);
    },
    async listSubmissionRounds(query?: SubmissionRoundListQuery): Promise<ParameterSubmissionRound[]> {
      return readMockState(runtime).parameterSubmissionRounds.filter((round) => matchesSubmissionRoundQuery(round, query)).map(cloneSubmissionRound);
    },
    async submitParameterChanges(input: SubmitParameterChangesInput): Promise<ParameterSubmissionRound> {
      const before = readMockState(runtime);
      const next = submitParameterRound(before, { ...input, projects, roles, buildRuntimeReviewFields });
      writeMockState(runtime, next);
      return cloneSubmissionRound(next.parameterSubmissionRounds[0]);
    },
    async withdrawSubmissionRound(roundId: string): Promise<ParameterSubmissionRound> {
      const state = readMockState(runtime);
      const round = state.parameterSubmissionRounds.find((item) => item.id === roundId);
      if (!round) {
        throw new Error(`Submission round not found: ${roundId}`);
      }

      const next = {
        ...state,
        parameterSubmissionRounds: state.parameterSubmissionRounds.map((item) =>
          item.id === roundId
            ? { ...item, status: "已撤回" as const, summary: `${item.summary} 已由提交人撤回。` }
            : item
        ),
        changeRequests: state.changeRequests.map((request) =>
          request.submissionRoundId === roundId && request.status !== "已合入"
            ? { ...request, status: "已打回" as const, rejectReason: "提交人已撤回本轮提交。" }
            : request
        )
      };
      writeMockState(runtime, next);
      const updated = next.parameterSubmissionRounds.find((item) => item.id === roundId);
      if (!updated) {
        throw new Error(`Submission round not found after withdraw: ${roundId}`);
      }
      return cloneSubmissionRound(updated);
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
      if (batch.status === "applied") throw new Error(`Import batch already applied: ${input.batchId}`);
      if (input.selectedItemIds && input.selectedItemIds.length === 0) {
        throw new Error("At least one import item must be selected.");
      }
      const selectedItemIds = input.selectedItemIds;
      const selectedIdsForValidation = selectedItemIds ?? batch.items.map((item) => item.id);
      const unknownSelectedIds = selectedIdsForValidation.filter((itemId) => !batch.items.some((item) => item.id === itemId));
      if (unknownSelectedIds.length > 0) {
        throw new Error(`Unknown selected import item ids: ${unknownSelectedIds.join(", ")}`);
      }
      const conflictItem = selectedItemIds
        ? batch.items.find((item) => selectedItemIds.includes(item.id) && item.classification === "conflict")
        : undefined;
      if (conflictItem) {
        throw new Error("Cannot apply import items with open change requests.");
      }
      const eligibleSelectedItems = batch.items.filter((item) =>
        selectedItemIds
          ? selectedItemIds.includes(item.id) && (item.classification === "added" || item.classification === "updated")
          : item.classification === "added" || item.classification === "updated"
      );
      if (eligibleSelectedItems.length === 0) {
        throw new Error("At least one eligible import item must be selected.");
      }
      const applied = {
        ...batch,
        status: "applied" as const,
        appliedAt: MOCK_CONTRACT_NOW,
        summary: { ...batch.summary },
        items: batch.items.map((item) => ({ ...item }))
      };
      writeMockState(runtime, applyImportItemsToState(readMockState(runtime), batch, selectedItemIds));
      importBatches.set(input.batchId, cloneImportBatch(applied));
      return cloneImportBatch(applied);
    }
  };
}
