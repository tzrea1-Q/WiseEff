import type {
  AddConfigSetFileInput,
  CreateBaselineInput,
  CreateConfigSetInput,
  DtsCompareBaselineResult,
  DtsConfigSet,
  DtsConfigSetFile,
  DtsExportConfigSetResult,
  DtsReleaseBaseline,
  DtsReleaseBaselineResult,
  DtsRollbackBaselineResult,
  DtsSearchQuery,
  DtsSearchResult,
  DtsStructureResult,
  DtsStructuredRepository
} from "@/application/ports/DtsStructuredRepository";
import { createApiClient } from "./apiClient";
import { createDefaultApiClient } from "./defaultApiClient";

type ItemsEnvelope<T> = { items: T[] };
type ItemEnvelope<T> = { item: T };
type ReleaseEnvelope = { item: DtsReleaseBaseline; gate: DtsReleaseBaselineResult["gate"] };
type ApiClient = ReturnType<typeof createApiClient>;

function routeProject(projectId: string) {
  return `/api/v1/projects/${encodeURIComponent(projectId)}`;
}

function routeStructure(projectId: string, fileId: string, versionId: string) {
  return `${routeProject(projectId)}/parameter-files/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(versionId)}/structure`;
}

function routeSearch(projectId: string, query: DtsSearchQuery) {
  const params = new URLSearchParams();
  params.set("q", query.q);
  if (query.by) {
    params.set("by", query.by);
  }
  return `${routeProject(projectId)}/dts-search?${params.toString()}`;
}

function routeConfigSets(projectId: string) {
  return `${routeProject(projectId)}/config-sets`;
}

function routeConfigSetFiles(projectId: string, configSetId: string) {
  return `${routeConfigSets(projectId)}/${encodeURIComponent(configSetId)}/files`;
}

function routeConfigSetFile(projectId: string, configSetId: string, fileId: string) {
  return `${routeConfigSetFiles(projectId, configSetId)}/${encodeURIComponent(fileId)}`;
}

function routeBaselines(projectId: string, configSetId: string) {
  return `${routeConfigSets(projectId)}/${encodeURIComponent(configSetId)}/baselines`;
}

function routeBaselineCompare(projectId: string, baselineId: string) {
  return `${routeProject(projectId)}/baselines/${encodeURIComponent(baselineId)}/compare`;
}

function routeBaselineRollback(projectId: string, baselineId: string) {
  return `${routeProject(projectId)}/baselines/${encodeURIComponent(baselineId)}/rollback`;
}

function routeBaselineRelease(projectId: string, baselineId: string) {
  return `${routeProject(projectId)}/baselines/${encodeURIComponent(baselineId)}/release`;
}

function routeExport(projectId: string, configSetId: string) {
  return `${routeConfigSets(projectId)}/${encodeURIComponent(configSetId)}/export`;
}

export function createDtsStructuredClient(client: ApiClient = createDefaultApiClient()): DtsStructuredRepository {
  return {
    async getStructure(projectId, fileId, versionId) {
      return client.get<DtsStructureResult>(routeStructure(projectId, fileId, versionId));
    },
    async search(projectId, query) {
      const response = await client.get<DtsSearchResult>(routeSearch(projectId, query));
      return { hits: response.hits };
    },
    async listConfigSets(projectId) {
      const response = await client.get<ItemsEnvelope<DtsConfigSet>>(routeConfigSets(projectId));
      return response.items;
    },
    async createConfigSet(projectId, input: CreateConfigSetInput) {
      const response = await client.post<ItemEnvelope<DtsConfigSet>>(routeConfigSets(projectId), input);
      return response.item;
    },
    async addConfigSetFile(projectId, configSetId, input: AddConfigSetFileInput) {
      const response = await client.post<ItemEnvelope<DtsConfigSetFile>>(routeConfigSetFiles(projectId, configSetId), input);
      return response.item;
    },
    async removeConfigSetFile(projectId, configSetId, fileId) {
      await client.delete(routeConfigSetFile(projectId, configSetId, fileId));
    },
    async listBaselines(projectId, configSetId) {
      const response = await client.get<ItemsEnvelope<DtsReleaseBaseline>>(routeBaselines(projectId, configSetId));
      return response.items;
    },
    async createBaseline(projectId, configSetId, input: CreateBaselineInput) {
      const response = await client.post<ItemEnvelope<DtsReleaseBaseline>>(routeBaselines(projectId, configSetId), input);
      return response.item;
    },
    async compareBaseline(projectId, baselineId) {
      const response = await client.get<ItemEnvelope<DtsCompareBaselineResult>>(routeBaselineCompare(projectId, baselineId));
      return response.item;
    },
    async rollbackBaseline(projectId, baselineId) {
      const response = await client.post<ItemEnvelope<DtsRollbackBaselineResult>>(routeBaselineRollback(projectId, baselineId), {});
      return response.item;
    },
    async releaseBaseline(projectId, baselineId) {
      const response = await client.post<ReleaseEnvelope>(routeBaselineRelease(projectId, baselineId), {});
      return { item: response.item, gate: response.gate };
    },
    async exportConfigSet(projectId, configSetId) {
      return client.get<DtsExportConfigSetResult>(routeExport(projectId, configSetId));
    }
  };
}

export type DtsStructuredClient = ReturnType<typeof createDtsStructuredClient>;
