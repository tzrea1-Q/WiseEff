import type { ParameterDashboardRepository } from "@/application/ports/ParameterDashboardRepository";
import type { DashboardWindow, HotspotDimension } from "@/domain/parameters/dashboardTypes";
import { createApiClient } from "./apiClient";
import { createDefaultApiClient } from "./defaultApiClient";
import { parseContractDto } from "./parseContractDto";
import {
  parameterDashboardHotspotsResponseSchema,
  parameterDashboardSummaryResponseSchema
} from "@wiseeff/dto-schemas";
import {
  dashboardSummaryFromDto,
  dashboardHotspotFromDto
} from "./parameterDashboardDtos";

type ApiClient = ReturnType<typeof createApiClient>;

function summaryPath(input: { projectId?: string; window: DashboardWindow; perspectiveRoleId?: string }) {
  const params = new URLSearchParams();
  if (input.projectId) params.set("projectId", input.projectId);
  params.set("window", input.window);
  if (input.perspectiveRoleId) params.set("perspectiveRoleId", input.perspectiveRoleId);
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
      const response = parseContractDto(
        parameterDashboardSummaryResponseSchema,
        await apiClient.get<unknown>(summaryPath(input)),
        "ParameterDashboardSummaryResponse"
      );
      return dashboardSummaryFromDto(response.item);
    },
    async listDashboardHotspots(input) {
      const response = parseContractDto(
        parameterDashboardHotspotsResponseSchema,
        await apiClient.get<unknown>(hotspotsPath(input)),
        "ParameterDashboardHotspotsResponse"
      );
      return response.items.map(dashboardHotspotFromDto);
    }
  };
}
