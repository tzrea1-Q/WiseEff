import type { OverviewScope, PersonalDashboardKpis, DashboardKpis } from "@/domain/parameters/dashboardTypes";
import type { WorkbenchRoleView } from "../workbench/derivePersonalWorkbench";

const PERSONAL_LABELS: Record<WorkbenchRoleView, [string, string, string, string, string]> = {
  user: ["我的变更", "我的提交", "我的草稿", "待处理事项", "风险分类"],
  committer: ["我的审阅完成", "我处理的流程", "待我审阅", "其他待办", "风险分类"],
  admin: ["我的治理操作", "我发起的导入", "待应用导入", "待复核账号", "高风险治理"],
  guest: ["我的变更", "我的提交", "我的草稿", "待处理事项", "风险分类"]
};

const PERSONAL_TREND: Record<WorkbenchRoleView, { title: string; changeSeriesName: string; workflowSeriesName: string }> = {
  user: { title: "我的变更趋势", changeSeriesName: "我的变更", workflowSeriesName: "我的提交" },
  committer: { title: "我的审阅趋势", changeSeriesName: "我的审阅完成", workflowSeriesName: "我处理的流程" },
  admin: { title: "我的治理趋势", changeSeriesName: "我的治理操作", workflowSeriesName: "我发起的导入" },
  guest: { title: "我的变更趋势", changeSeriesName: "我的变更", workflowSeriesName: "我的提交" }
};

const PERSONAL_KEYS: Array<
  "contributionCount" | "workflowCount" | "openItemCount" | "pendingTodoCount" | "highRiskTouchCount"
> = [
  "contributionCount",
  "workflowCount",
  "openItemCount",
  "pendingTodoCount",
  "highRiskTouchCount"
];

const OVERALL_KEYS: Array<
  | "totalBindings"
  | "totalDefinitions"
  | "managedProjects"
  | "changeFrequency"
  | "activeContributors"
  | "highRiskParameters"
> = [
  "totalBindings",
  "totalDefinitions",
  "managedProjects",
  "changeFrequency",
  "activeContributors",
  "highRiskParameters"
];

const OVERALL_LABELS = ["活跃 Binding", "已绑定 Definition", "管理项目", "变更频次", "活跃贡献者", "风险分类"];

function displayMetric(value: number | null | undefined) {
  return value == null ? "不可用" : value;
}

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
        value: displayMetric(kpis?.[key])
      }))
    };
  }

  const labels = PERSONAL_LABELS[roleView];
  const trend = PERSONAL_TREND[roleView];
  return {
    panelSubtitle: "我的关键指标",
    trendTitle: trend.title,
    changeSeriesName: trend.changeSeriesName,
    workflowSeriesName: trend.workflowSeriesName,
    kpiItems: PERSONAL_KEYS.map((key, index) => ({
      key,
      label: labels[index],
      value: displayMetric(personalKpis?.[key])
    }))
  };
}
