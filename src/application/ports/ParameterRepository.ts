import type { ChangeRequest, ParameterRecord, ParameterSubmissionRound } from "@/domain/parameters/types";
import type { Project } from "@/mockData";

export type ParameterListQuery = {
  projectId?: string;
  module?: string;
  risk?: Array<ParameterRecord["risk"]>;
};

export type SubmitParameterChangesInput = {
  items: Array<{ parameterId: string; targetValue: string; reason: string }>;
  reason?: string;
};

export interface ParameterRepository {
  listProjects(): Promise<Project[]>;
  listParameters(query?: ParameterListQuery): Promise<ParameterRecord[]>;
  listChangeRequests(): Promise<ChangeRequest[]>;
  listSubmissionRounds(): Promise<ParameterSubmissionRound[]>;
  submitParameterChanges(input: SubmitParameterChangesInput): Promise<ParameterSubmissionRound>;
}
