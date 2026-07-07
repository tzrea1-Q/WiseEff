import type {
  DashboardHotspot,
  DashboardSummary,
  DashboardWindow,
  HotspotDimension,
  HotspotScoreBreakdown,
  ProjectRiskBucket,
  TrendPoint,
  WorkbenchSignals
} from "@/domain/parameters/dashboardTypes";

export type DashboardSummaryDto = DashboardSummary;
export type DashboardHotspotDto = DashboardHotspot;

export function dashboardSummaryFromDto(dto: DashboardSummaryDto): DashboardSummary {
  return dto;
}

export function dashboardHotspotFromDto(dto: DashboardHotspotDto): DashboardHotspot {
  return dto;
}

export type {
  DashboardWindow,
  HotspotDimension,
  HotspotScoreBreakdown,
  ProjectRiskBucket,
  TrendPoint,
  WorkbenchSignals
};
