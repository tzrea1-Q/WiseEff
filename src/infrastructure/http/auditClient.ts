import type { AuditEventListResponse, ListAuditEventsParams } from "@/domain/audit/types";
import { createApiClient } from "./apiClient";
import { createDefaultApiClient, type DefaultApiClientOptions } from "./defaultApiClient";

type ApiClient = ReturnType<typeof createApiClient>;

export const createDefaultAuditApiClient = (options: DefaultApiClientOptions = {}) => createDefaultApiClient(options);

function buildQuery(params: ListAuditEventsParams = {}) {
  const search = new URLSearchParams();
  if (params.projectId) search.set("projectId", params.projectId);
  if (params.app) search.set("app", params.app);
  if (params.apps?.length) search.set("apps", params.apps.join(","));
  if (params.kind) search.set("kind", params.kind);
  if (params.severity) search.set("severity", params.severity);
  if (params.targetType) search.set("targetType", params.targetType);
  if (params.targetId) search.set("targetId", params.targetId);
  if (params.traceId) search.set("traceId", params.traceId);
  if (params.from) search.set("from", params.from);
  if (params.to) search.set("to", params.to);
  if (params.cursor) search.set("cursor", params.cursor);
  if (params.limit) search.set("limit", String(params.limit));
  const query = search.toString();
  return query ? `?${query}` : "";
}

export function createAuditClient(apiClient: ApiClient = createDefaultAuditApiClient()) {
  return {
    async listAuditEvents(params: ListAuditEventsParams = {}) {
      return apiClient.get<AuditEventListResponse>(`/api/v1/audit-events${buildQuery(params)}`);
    }
  };
}
