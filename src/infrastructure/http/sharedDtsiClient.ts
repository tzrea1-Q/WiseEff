import type { ApiClient } from "./apiClient";
import { sharedDtsiDraftSchema, sharedDtsiListSchema, sharedDtsiResourceDetailSchema, sharedDtsiVersionSchema, sharedDtsiVersionsSchema, sharedDtsiPreviewSchema,
  sharedDtsiRecognitionSchema,sharedDtsiComparisonSchema,sharedDtsiUsagesSchema,type SharedDtsiDraftInput,type SharedDtsiLifecycleInput } from "@wiseeff/dto-schemas";

export function createSharedDtsiClient(api: ApiClient) {
  const base = "/api/v2/shared-dtsi";
  const resource = (id: string) => `${base}/${encodeURIComponent(id)}`;
  return {
    async list(input: { q?: string; offset?: number; limit?: number } = {}) {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(input)) if (value !== undefined) query.set(key, String(value));
      return sharedDtsiListSchema.parse(await api.get(`${base}?${query}`));
    },
    async get(id: string) {
      const result = await api.get<{ item: unknown }>(resource(id));
      return sharedDtsiDraftSchema.parse(result.item);
    },
    async create(input: SharedDtsiDraftInput) {
      const result = await api.post<{ item: unknown }>(base, input);
      return sharedDtsiDraftSchema.parse(result.item);
    },
    async importProject(projectId: string, configSetId: string, input: {name:string;configRevisionId:string;fileId:string;fileVersionId:string}) {
      const result = await api.post<{item:unknown}>(`/api/v2/projects/${encodeURIComponent(projectId)}/config-sets/${encodeURIComponent(configSetId)}/shared-dtsi`,input);
      return sharedDtsiDraftSchema.parse(result.item);
    },
    async save(id: string, input: SharedDtsiDraftInput & { expectedRevision: number }) {
      const result = await api.put<{ item: unknown }>(`${resource(id)}/draft`, input);
      return sharedDtsiDraftSchema.parse(result.item);
    },
    async discard(id: string, expectedRevision: number) {
      await api.delete(`${resource(id)}/draft`, { expectedRevision });
    },
    async detail(id: string) {
      const result=await api.get<{item:unknown}>(`${resource(id)}/detail`);
      return sharedDtsiResourceDetailSchema.parse(result.item);
    },
    async lifecycle(id:string,input:SharedDtsiLifecycleInput) {
      const result=await api.post<{item:unknown}>(`${resource(id)}/lifecycle`,input);
      return sharedDtsiResourceDetailSchema.parse(result.item);
    },
    async versions(id: string,offset=0) {
      return sharedDtsiVersionsSchema.parse(await api.get(`${resource(id)}/versions?offset=${offset}&limit=20`));
    },
    async usages(id:string,offset=0) {
      return sharedDtsiUsagesSchema.parse(await api.get(`${resource(id)}/usages?offset=${offset}&limit=20`));
    },
    async compare(id:string,before:string,after:string) {
      const result=await api.get<{item:unknown}>(`${resource(id)}/comparison?${new URLSearchParams({before,after})}`);
      return sharedDtsiComparisonSchema.parse(result.item);
    },
    async version(id: string,versionId: string) {
      const result=await api.get<{item:unknown}>(`${resource(id)}/versions/${encodeURIComponent(versionId)}`);
      return sharedDtsiVersionSchema.parse(result.item);
    },
    async recognition(id: string,versionId: string) {
      return sharedDtsiRecognitionSchema.parse(await api.get(`${resource(id)}/versions/${encodeURIComponent(versionId)}/recognition`));
    },
    async newVersionDraft(id: string,baseVersionId: string) {
      const result=await api.post<{item:unknown}>(`${resource(id)}/draft`,{baseVersionId});
      return sharedDtsiDraftSchema.parse(result.item);
    },
    async preview(id: string,expectedRevision: number) {
      const result=await api.post<{item:unknown}>(`${resource(id)}/publication-preview`,{expectedRevision});
      return sharedDtsiPreviewSchema.parse(result.item);
    },
    async publish(id: string,previewId: string,idempotencyKey: string) {
      const result=await api.post<{item:unknown}>(`${resource(id)}/publications`,{previewId,idempotencyKey});
      return sharedDtsiVersionSchema.parse(result.item);
    }
  };
}
