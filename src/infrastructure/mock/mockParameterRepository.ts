import type {
  ParameterListQuery,
  ParameterRepository,
  SubmitParameterChangesInput
} from "@/application/ports/ParameterRepository";
import { appReducer } from "@/App";
import type { ChangeRequest, ParameterRecord, ParameterSubmissionRound } from "@/domain/parameters/types";
import { projects } from "@/mockData";
import type { Project } from "@/mockData";
import type { MockRuntimeState } from "./mockState";
import { readMockState, writeMockState } from "./mockState";

function matchesQuery(parameter: ParameterRecord, query?: ParameterListQuery) {
  if (!query) return true;
  if (query.projectId && parameter.projectId !== query.projectId) return false;
  if (query.module && parameter.module !== query.module) return false;
  if (query.risk && query.risk.length > 0 && !query.risk.includes(parameter.risk)) return false;
  return true;
}

export function createMockParameterRepository(runtime: MockRuntimeState): ParameterRepository {
  return {
    async listProjects(): Promise<Project[]> { return [...projects]; },
    async listParameters(query?: ParameterListQuery): Promise<ParameterRecord[]> {
      return readMockState(runtime).parameters.filter((parameter) => matchesQuery(parameter, query));
    },
    async listChangeRequests(): Promise<ChangeRequest[]> { return [...readMockState(runtime).changeRequests]; },
    async listSubmissionRounds(): Promise<ParameterSubmissionRound[]> { return [...readMockState(runtime).parameterSubmissionRounds]; },
    async submitParameterChanges(input: SubmitParameterChangesInput): Promise<ParameterSubmissionRound> {
      const before = readMockState(runtime);
      const next = appReducer(before, { type: "ADD_PARAMETER_SUBMISSION_ROUND", items: input.items, reason: input.reason });
      writeMockState(runtime, next);
      return next.parameterSubmissionRounds[0];
    }
  };
}
