import type {
  DashboardHotspot,
  DashboardSummary,
  DashboardWindow,
  HotspotDimension
} from "@/domain/parameters/dashboardTypes";

export interface ParameterDashboardRepository {
  listDashboardSummary(input: { projectId?: string; window: DashboardWindow }): Promise<DashboardSummary>;
  listDashboardHotspots(input: {
    projectId?: string;
    window: DashboardWindow;
    dimension: HotspotDimension;
  }): Promise<DashboardHotspot[]>;
}
