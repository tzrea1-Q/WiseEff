import type { DtsReloadCandidate, DtsReloadRun } from "@/domain/dtsReload/types";

export type StartDtsReloadRunInput = {
  projectId: string;
  bindingId: string;
  debugValue: string;
};

export interface DtsReloadRepository {
  listCandidates(projectId: string): Promise<{ items: DtsReloadCandidate[] }>;
  startRun(input: StartDtsReloadRunInput): Promise<DtsReloadRun>;
  getRun(runId: string): Promise<DtsReloadRun>;
  downloadArtifact(runId: string): Promise<Blob>;
}
