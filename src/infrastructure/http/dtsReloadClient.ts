import type { DtsReloadRepository, StartDtsReloadRunInput } from "@/application/ports/DtsReloadRepository";
import type { DtsReloadCandidate, DtsReloadRun } from "@/domain/dtsReload/types";
import { createApiClient } from "./apiClient";
import { createDefaultApiClient } from "./defaultApiClient";
import { resolveWiseEffApiBaseUrl } from "./runtimeMode";

type ApiClient = ReturnType<typeof createApiClient>;
type ItemEnvelope<T> = { item: T };
type ListEnvelope<T> = { items: T[] };

type HttpDtsReloadRepositoryOptions =
  | { apiClient?: undefined; baseUrl?: string; fetchImpl?: typeof fetch }
  | { apiClient: ApiClient; baseUrl: string; fetchImpl?: typeof fetch };

function candidatesPath(projectId: string) {
  return `/api/v1/dts-reload/projects/${encodeURIComponent(projectId)}/candidates`;
}

function runsPath(projectId: string) {
  return `/api/v1/dts-reload/projects/${encodeURIComponent(projectId)}/runs`;
}

function runPath(runId: string) {
  return `/api/v1/dts-reload/runs/${encodeURIComponent(runId)}`;
}

function artifactPath(runId: string) {
  return `${runPath(runId)}/artifact`;
}

export function createHttpDtsReloadRepository(options: HttpDtsReloadRepositoryOptions = {}): DtsReloadRepository {
  const baseUrl = options.baseUrl ?? resolveWiseEffApiBaseUrl();
  const apiClient = options.apiClient ?? createDefaultApiClient({ baseUrl, fetchImpl: options.fetchImpl });

  return {
    async listCandidates(projectId: string) {
      const response = await apiClient.get<ListEnvelope<DtsReloadCandidate>>(candidatesPath(projectId));
      return { items: response.items };
    },

    async startRun(input: StartDtsReloadRunInput) {
      const response = await apiClient.post<ItemEnvelope<DtsReloadRun>>(runsPath(input.projectId), {
        bindingId: input.bindingId,
        debugValue: input.debugValue
      });
      return response.item;
    },

    async getRun(runId: string) {
      const response = await apiClient.get<ItemEnvelope<DtsReloadRun>>(runPath(runId));
      return response.item;
    },

    async downloadArtifact(runId: string) {
      const response = await apiClient.raw(artifactPath(runId), {
        method: "GET",
        headers: { Accept: "application/octet-stream" }
      });
      return response.blob();
    }
  };
}
