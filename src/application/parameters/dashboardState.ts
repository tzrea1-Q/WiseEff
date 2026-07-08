import type {
  DashboardSummary,
  DashboardHotspot,
  DashboardWindow,
  HotspotDimension,
  OverviewScope
} from "@/domain/parameters/dashboardTypes";

export type SectionStatus = "idle" | "loading" | "ready" | "empty" | "error";

export type DashboardState = {
  window: DashboardWindow;
  dimension: HotspotDimension;
  overviewScope: OverviewScope;
  projectScope: string | null;
  summary: { status: SectionStatus; data: DashboardSummary | null; error: string | null };
  hotspots: { status: SectionStatus; data: DashboardHotspot[]; error: string | null };
};

export const initialDashboardState: DashboardState = {
  window: "30d",
  dimension: "overall",
  overviewScope: "personal",
  projectScope: null,
  summary: { status: "idle", data: null, error: null },
  hotspots: { status: "idle", data: [], error: null }
};

export type DashboardAction =
  | { type: "DASHBOARD_SET_WINDOW"; window: DashboardWindow }
  | { type: "DASHBOARD_SET_DIMENSION"; dimension: HotspotDimension }
  | { type: "DASHBOARD_SET_OVERVIEW_SCOPE"; scope: OverviewScope }
  | { type: "DASHBOARD_SET_PROJECT"; projectId: string | null }
  | { type: "DASHBOARD_SUMMARY_LOADING" }
  | { type: "DASHBOARD_SUMMARY_READY"; data: DashboardSummary }
  | { type: "DASHBOARD_SUMMARY_ERROR"; error: string }
  | { type: "DASHBOARD_HOTSPOTS_LOADING" }
  | { type: "DASHBOARD_HOTSPOTS_READY"; data: DashboardHotspot[] }
  | { type: "DASHBOARD_HOTSPOTS_ERROR"; error: string };

export function dashboardReducer(state: DashboardState, action: DashboardAction): DashboardState {
  switch (action.type) {
    case "DASHBOARD_SET_WINDOW":
      return { ...state, window: action.window };
    case "DASHBOARD_SET_DIMENSION":
      return { ...state, dimension: action.dimension };
    case "DASHBOARD_SET_OVERVIEW_SCOPE":
      return { ...state, overviewScope: action.scope };
    case "DASHBOARD_SET_PROJECT":
      return { ...state, projectScope: action.projectId };
    case "DASHBOARD_SUMMARY_LOADING":
      return { ...state, summary: { ...state.summary, status: "loading", error: null } };
    case "DASHBOARD_SUMMARY_READY": {
      const isTrendEmpty = (point: { changeCount: number; workflowEventCount: number }) =>
        point.changeCount === 0 && point.workflowEventCount === 0;
      const empty =
        state.overviewScope === "personal"
          ? Object.values(action.data.personalKpis).every((value) => value === 0) &&
            action.data.personalTrend.every(isTrendEmpty)
          : action.data.kpis.totalParameters === 0 && action.data.trend.every(isTrendEmpty);
      return { ...state, summary: { status: empty ? "empty" : "ready", data: action.data, error: null } };
    }
    case "DASHBOARD_SUMMARY_ERROR":
      return { ...state, summary: { ...state.summary, status: "error", error: action.error } };
    case "DASHBOARD_HOTSPOTS_LOADING":
      return { ...state, hotspots: { ...state.hotspots, status: "loading", error: null } };
    case "DASHBOARD_HOTSPOTS_READY":
      return {
        ...state,
        hotspots: {
          status: action.data.length === 0 ? "empty" : "ready",
          data: action.data,
          error: null
        }
      };
    case "DASHBOARD_HOTSPOTS_ERROR":
      return { ...state, hotspots: { ...state.hotspots, status: "error", error: action.error } };
    default:
      return state;
  }
}
