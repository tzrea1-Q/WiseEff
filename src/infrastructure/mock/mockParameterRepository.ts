import type {
  ApplyParameterImportBatchInput,
  ParameterDraftDto,
  ParameterImportBatchDto,
  ParameterImportPreviewInput,
  ParameterListQuery,
  ParameterRepository,
  ProjectSummary,
  ReviewParameterChangeInput,
  SaveParameterDraftInput,
  SubmitParameterChangesInput
} from "@/application/ports/ParameterRepository";
import { submitParameterRound, type BuildRuntimeReviewFields } from "@/domain/parameters/commands";
import type { ChangeRequest, ParameterHistoryEntry, ParameterRecord, ParameterSubmissionRound } from "@/domain/parameters/types";
import { projects, roles } from "@/mockData";
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

function slugForId(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildImportBatch(input: { projectId: string; sourceName: string; items: ParameterImportBatchDto["items"] }, status: ParameterImportBatchDto["status"]): ParameterImportBatchDto {
  const highRisk = input.items.filter((item) => item.risk === "High").length;

  return {
    id: `import-${input.projectId}-${slugForId(input.sourceName)}`,
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
    items: input.items.map((item) => ({ ...item }))
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
    async listDrafts(): Promise<ParameterDraftDto[]> {
      return [];
    },
    async saveDraft(input: SaveParameterDraftInput): Promise<ParameterDraftDto> {
      return {
        id: `draft-${input.projectId}-${input.parameterId}`,
        projectId: input.projectId,
        parameterId: input.parameterId,
        targetValue: input.targetValue,
        reason: input.reason,
        updatedAt: MOCK_CONTRACT_NOW
      };
    },
    async deleteDraft(): Promise<void> {
      return undefined;
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
      const request = readMockState(runtime).changeRequests.find((row) => row.id === input.requestId);
      if (!request) throw new Error(`Change request not found: ${input.requestId}`);
      return cloneChangeRequest(request);
    },
    async createImportPreview(input: ParameterImportPreviewInput): Promise<ParameterImportBatchDto> {
      const batch = buildImportBatch(input, "previewed");
      importBatches.set(batch.id, batch);
      return batch;
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
      importBatches.set(input.batchId, applied);
      return applied;
    }
  };
}
