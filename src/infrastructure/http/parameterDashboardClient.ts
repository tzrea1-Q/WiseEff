import type { ParameterDashboardRepository } from "@/application/ports/ParameterDashboardRepository";
import type { DashboardWindow, HotspotDimension } from "@/domain/parameters/dashboardTypes";
import { createApiClient } from "./apiClient";
import { createDefaultApiClient } from "./defaultApiClient";
import {
  dashboardSummaryFromDto,
  dashboardHotspotFromDto,
  type DashboardSummaryDto,
  type DashboardHotspotDto
} from "./parameterDashboardDtos";

type ApiClient = ReturnType<typeof createApiClient>;
type ItemEnvelope<T> = { item: T };
type ItemsEnvelope<T> = { items: T[] };

function summaryPath(input: { projectId?: string; window: DashboardWindow }) {
  const params = new URLSearchParams();
  if (input.projectId) params.set("projectId", input.projectId);
  params.set("window", input.window);
  return `/api/v1/parameters/dashboard/summary?${params.toString()}`;
}

function hotspotsPath(input: { projectId?: string; window: DashboardWindow; dimension: HotspotDimension }) {
  const params = new URLSearchParams();
  if (input.projectId) params.set("projectId", input.projectId);
  params.set("window", input.window);
  params.set("dimension", input.dimension);
  return `/api/v1/parameters/dashboard/hotspots?${params.toString()}`;
}

export function createHttpParameterDashboardRepository(apiClient: ApiClient = createDefaultApiClient()): ParameterDashboardRepository {
  return {
    async listDashboardSummary(input) {
      const response = await apiClient.get<ItemEnvelope<DashboardSummaryDto>>(summaryPath(input));
      return dashboardSummaryFromDto(response.item);
    },
    async listDashboardHotspots(input) {
      const response = await apiClient.get<ItemsEnvelope<DashboardHotspotDto>>(hotspotsPath(input));
      return response.items.map(dashboardHotspotFromDto);
    }
  };
}
