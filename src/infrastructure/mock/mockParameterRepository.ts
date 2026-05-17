import type {
  ParameterListQuery,
  ParameterRepository,
  ProjectSummary,
  SubmitParameterChangesInput
} from "@/application/ports/ParameterRepository";
import { submitParameterRound, type BuildRuntimeReviewFields } from "@/domain/parameters/commands";
import type { ChangeRequest, ParameterRecord, ParameterSubmissionRound } from "@/domain/parameters/types";
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
  return {
    async listProjects(): Promise<ProjectSummary[]> {
      return [...projects];
    },
    async listParameters(query?: ParameterListQuery): Promise<ParameterRecord[]> {
      return readMockState(runtime).parameters.filter((parameter) => matchesQuery(parameter, query)).map(cloneParameterRecord);
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
    }
  };
}
