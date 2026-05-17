import type {
  ParameterListQuery,
  ParameterRepository,
  SubmitParameterChangesInput
} from "@/application/ports/ParameterRepository";
import { appReducer } from "@/App";
import type { ChangeRequest, ParameterRecord, ParameterSubmissionRound } from "@/domain/parameters/types";
import { projects, type Project } from "@/mockData";
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

export function createMockParameterRepository(runtime: MockRuntimeState): ParameterRepository {
  return {
    async listProjects(): Promise<Project[]> {
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
      const next = appReducer(before, { type: "ADD_PARAMETER_SUBMISSION_ROUND", items: input.items, reason: input.reason });
      writeMockState(runtime, next);
      return cloneSubmissionRound(next.parameterSubmissionRounds[0]);
    }
  };
}
