import type { ApiClient } from "./apiClient";
import { sharedDtsiDraftSchema, sharedDtsiListSchema,
  type SharedDtsiDraftInput } from "@wiseeff/dto-schemas";

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
    async save(id: string, input: SharedDtsiDraftInput & { expectedRevision: number }) {
      const result = await api.put<{ item: unknown }>(`${resource(id)}/draft`, input);
      return sharedDtsiDraftSchema.parse(result.item);
    },
    async discard(id: string, expectedRevision: number) {
      await api.delete(`${resource(id)}/draft`, { expectedRevision });
    }
  };
}
