import type {
  DtsReloadRepository,
  StartDtsReloadRunInput,
  DeployDtsReloadRunInput,
  RestoreDtsReloadBaselineInput,
  ListDtsReloadRunsInput
} from "@/application/ports/DtsReloadRepository";
import type {
  DeviceReloadConfigurationOverride,
  DtsReloadCandidate,
  DtsReloadResidue,
  DtsReloadRun,
  DtsReloadRunListItem,
  OrganisationReloadConfiguration,
  ReloadConfigurationAdminView,
  ReloadConfigurationContract
} from "@/domain/dtsReload/types";
import { createApiClient } from "./apiClient";
import { createDefaultApiClient } from "./defaultApiClient";
import { resolveWiseEffApiBaseUrl } from "./runtimeMode";

type ApiClient = ReturnType<typeof createApiClient>;
type ItemEnvelope<T> = { item: T };
type ListEnvelope<T> = { items: T[] };
type CursorListEnvelope<T> = { items: T[]; nextCursor: string | null };

type HttpDtsReloadRepositoryOptions =
  | { apiClient?: undefined; baseUrl?: string; fetchImpl?: typeof fetch }
  | { apiClient: ApiClient; baseUrl: string; fetchImpl?: typeof fetch };

function candidatesPath(projectId: string) {
  return `/api/v1/dts-reload/projects/${encodeURIComponent(projectId)}/candidates`;
}

function runsPath(projectId: string) {
  return `/api/v1/dts-reload/projects/${encodeURIComponent(projectId)}/runs`;
}

function listRunsPath(input: ListDtsReloadRunsInput) {
  const params = new URLSearchParams();
  if (input.projectId) params.set("projectId", input.projectId);
  if (input.deviceId) params.set("deviceId", input.deviceId);
  if (input.cursor) params.set("cursor", input.cursor);
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  const query = params.toString();
  return query ? `/api/v1/dts-reload/runs?${query}` : "/api/v1/dts-reload/runs";
}

function restoreBaselinePath(projectId: string) {
  return `/api/v1/dts-reload/projects/${encodeURIComponent(projectId)}/restore-baseline`;
}

function residuePath(deviceId: string) {
  return `/api/v1/dts-reload/residue?deviceId=${encodeURIComponent(deviceId)}`;
}

function runPath(runId: string) {
  return `/api/v1/dts-reload/runs/${encodeURIComponent(runId)}`;
}

function deployPath(runId: string) {
  return `${runPath(runId)}/deploy`;
}

function artifactPath(runId: string) {
  return `${runPath(runId)}/artifact`;
}

function configurationPath() {
  return "/api/v1/dts-reload/configuration";
}

function deviceConfigurationPath(deviceId: string) {
  return `${configurationPath()}/devices/${encodeURIComponent(deviceId)}`;
}

export function createHttpDtsReloadRepository(options: HttpDtsReloadRepositoryOptions = {}): DtsReloadRepository {
  const baseUrl = options.baseUrl ?? resolveWiseEffApiBaseUrl();
  const apiClient = options.apiClient ?? createDefaultApiClient({ baseUrl, fetchImpl: options.fetchImpl });

  return {
    async listCandidates(projectId: string) {
      const response = await apiClient.get<ListEnvelope<DtsReloadCandidate>>(candidatesPath(projectId));
      return { items: response.items };
    },

    async listRuns(input: ListDtsReloadRunsInput) {
      const response = await apiClient.get<CursorListEnvelope<DtsReloadRunListItem>>(listRunsPath(input));
      return { items: response.items, nextCursor: response.nextCursor ?? null };
    },

    async startRun(input: StartDtsReloadRunInput) {
      const response = await apiClient.post<ItemEnvelope<DtsReloadRun>>(runsPath(input.projectId), {
        targets: input.targets,
        ...(input.confirmationToken ? { confirmationToken: input.confirmationToken } : {})
      });
      return response.item;
    },

    async restoreBaseline(input: RestoreDtsReloadBaselineInput) {
      const response = await apiClient.post<ItemEnvelope<DtsReloadRun>>(restoreBaselinePath(input.projectId), {
        deviceId: input.deviceId,
        ...(input.confirmationToken ? { confirmationToken: input.confirmationToken } : {})
      });
      return response.item;
    },

    async getResidue(deviceId: string) {
      const response = await apiClient.get<ItemEnvelope<DtsReloadResidue | null>>(residuePath(deviceId));
      return response.item;
    },

    async deployRun(input: DeployDtsReloadRunInput) {
      const response = await apiClient.post<ItemEnvelope<DtsReloadRun>>(deployPath(input.runId), {
        deviceId: input.deviceId,
        bridgeId: input.bridgeId,
        targetRef: input.targetRef,
        protocol: input.protocol,
        confirmationTokens: input.confirmationTokens
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
    },

    async getReloadConfiguration() {
      const response = await apiClient.get<ItemEnvelope<ReloadConfigurationAdminView>>(configurationPath());
      return response.item;
    },

    async updateOrganisationReloadConfiguration(contract: ReloadConfigurationContract) {
      const response = await apiClient.put<ItemEnvelope<OrganisationReloadConfiguration>>(configurationPath(), contract);
      return response.item;
    },

    async upsertDeviceReloadConfiguration(deviceId: string, contract: ReloadConfigurationContract) {
      const response = await apiClient.put<ItemEnvelope<DeviceReloadConfigurationOverride>>(
        deviceConfigurationPath(deviceId),
        contract
      );
      return response.item;
    },

    async deleteDeviceReloadConfiguration(deviceId: string) {
      const response = await apiClient.delete<ItemEnvelope<{ deviceId: string }>>(deviceConfigurationPath(deviceId));
      return response.item;
    }
  };
}
