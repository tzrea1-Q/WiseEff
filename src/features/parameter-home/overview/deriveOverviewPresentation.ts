import type { OverviewScope, PersonalDashboardKpis, DashboardKpis } from "@/domain/parameters/dashboardTypes";
import type { WorkbenchRoleView } from "../workbench/derivePersonalWorkbench";

const PERSONAL_LABELS: Record<WorkbenchRoleView, [string, string, string, string, string]> = {
  user: ["我的变更", "我的提交", "我的草稿", "待处理事项", "高风险经手"],
  committer: ["我的审阅完成", "我处理的流程", "待我审阅", "队列高风险", "高风险审阅"],
  admin: ["我的治理操作", "我发起的导入", "待应用导入", "待复核账号", "高风险治理"],
  guest: ["我的变更", "我的提交", "我的草稿", "待处理事项", "高风险经手"]
};

const PERSONAL_KEYS: Array<keyof PersonalDashboardKpis> = [
  "contributionCount",
  "workflowCount",
  "openItemCount",
  "pendingTodoCount",
  "highRiskTouchCount"
];

const OVERALL_KEYS: Array<keyof DashboardKpis> = [
  "totalParameters",
  "managedProjects",
  "changeFrequency",
  "activeContributors",
  "highRiskParameters"
];

const OVERALL_LABELS = ["参数总量", "管理项目", "变更频次", "活跃贡献者", "高风险参数"];

export function deriveOverviewPresentation(
  roleView: WorkbenchRoleView,
  scope: OverviewScope,
  kpis?: DashboardKpis | null,
  personalKpis?: PersonalDashboardKpis | null
) {
  if (scope === "overall") {
    return {
      panelSubtitle: "参数库关键指标",
      trendTitle: "参数更新趋势",
      changeSeriesName: "参数变更",
      workflowSeriesName: "流程事件",
      kpiItems: OVERALL_KEYS.map((key, index) => ({
        key,
        label: OVERALL_LABELS[index],
        value: kpis?.[key] ?? 0
      }))
    };
  }

  const labels = PERSONAL_LABELS[roleView];
  return {
    panelSubtitle: "我的关键指标",
    trendTitle: "我的变更趋势",
    changeSeriesName: "我的变更",
    workflowSeriesName: "我的流程",
    kpiItems: PERSONAL_KEYS.map((key, index) => ({
      key,
      label: labels[index],
      value: personalKpis?.[key] ?? 0
    }))
  };
}
