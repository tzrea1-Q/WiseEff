import type { ParameterDashboardRepository } from "@/application/ports/ParameterDashboardRepository";
import type { DashboardWindow, HotspotDimension } from "@/domain/parameters/dashboardTypes";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import type { DashboardAction } from "./dashboardState";

export const dashboardFailureNotification = "参数看板数据加载失败，请稍后重试。";

type Options = {
  repository: ParameterDashboardRepository;
  dispatch: (action: DashboardAction) => void;
};

function formatError(error: unknown): string {
  if (error instanceof WiseEffApiError && (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN")) {
    return "当前账号无权查看参数看板，请重新登录或切换角色。";
  }
  return dashboardFailureNotification;
}

export function createParameterDashboardRuntime({ repository, dispatch }: Options) {
  let summaryGeneration = 0;
  let hotspotsGeneration = 0;

  return {
    async loadSummary(input: { projectId?: string; window: DashboardWindow; perspectiveRoleId?: string }) {
      const generation = ++summaryGeneration;
      dispatch({ type: "DASHBOARD_SUMMARY_LOADING" });
      try {
        const data = await repository.listDashboardSummary(input);
        if (generation !== summaryGeneration) return;
        dispatch({ type: "DASHBOARD_SUMMARY_READY", data });
      } catch (error) {
        if (generation !== summaryGeneration) return;
        dispatch({ type: "DASHBOARD_SUMMARY_ERROR", error: formatError(error) });
      }
    },
    async loadHotspots(input: { projectId?: string; window: DashboardWindow; dimension: HotspotDimension }) {
      const generation = ++hotspotsGeneration;
      dispatch({ type: "DASHBOARD_HOTSPOTS_LOADING" });
      try {
        const data = await repository.listDashboardHotspots(input);
        if (generation !== hotspotsGeneration) return;
        dispatch({ type: "DASHBOARD_HOTSPOTS_READY", data });
      } catch (error) {
        if (generation !== hotspotsGeneration) return;
        dispatch({ type: "DASHBOARD_HOTSPOTS_ERROR", error: formatError(error) });
      }
    }
  };
}
