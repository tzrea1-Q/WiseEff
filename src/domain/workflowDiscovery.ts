export const WORKFLOW_IDS = ["parameter-management", "debugging", "log-analysis", "knowledge"] as const;

export type WorkflowId = (typeof WORKFLOW_IDS)[number];

export const NAV_GROUPS = ["平台总览", "参数管理", "调试平台", "日志分析", "知识库"] as const;

export type NavGroup = (typeof NAV_GROUPS)[number];

export const VISIBLE_WORKFLOWS: readonly WorkflowId[] = ["parameter-management", "debugging", "log-analysis", "knowledge"];

const NAV_GROUP_TO_WORKFLOW: Record<NavGroup, WorkflowId | null> = {
  平台总览: null,
  参数管理: "parameter-management",
  调试平台: "debugging",
  日志分析: "log-analysis",
  知识库: "knowledge"
};

export const WORKFLOW_OFFER_LABELS: Record<WorkflowId, string> = {
  "parameter-management": "参数管理",
  debugging: "设备调试",
  "log-analysis": "日志分析",
  knowledge: "知识库"
};

const HOMEPAGE_SCENE_WORKFLOWS: readonly WorkflowId[] = [
  "parameter-management",
  "debugging",
  "log-analysis",
  "knowledge"
];

const SCENE_COUNT_LABELS: Record<number, string> = {
  1: "一",
  2: "两",
  3: "三",
  4: "四"
};

export function isWorkflowVisible(workflowId: WorkflowId, visibleWorkflows: readonly WorkflowId[] = VISIBLE_WORKFLOWS): boolean {
  return visibleWorkflows.includes(workflowId);
}

export function workflowForGroup(group: NavGroup): WorkflowId | null {
  return NAV_GROUP_TO_WORKFLOW[group];
}

export function isDiscoveryGroupVisible(group: NavGroup, visibleWorkflows: readonly WorkflowId[] = VISIBLE_WORKFLOWS): boolean {
  const workflowId = workflowForGroup(group);
  return workflowId === null || isWorkflowVisible(workflowId, visibleWorkflows);
}

export function homepageHeroWorkflowPhrase(visibleWorkflows: readonly WorkflowId[] = VISIBLE_WORKFLOWS): string {
  return joinChineseList(visibleWorkflows.map((workflowId) => WORKFLOW_OFFER_LABELS[workflowId]));
}

export function homepageFlowTitle(visibleWorkflows: readonly WorkflowId[] = VISIBLE_WORKFLOWS): string {
  const sceneCount = HOMEPAGE_SCENE_WORKFLOWS.filter((id) => isWorkflowVisible(id, visibleWorkflows)).length;
  const countLabel = SCENE_COUNT_LABELS[sceneCount] ?? String(sceneCount);
  return `一条可审阅工作流，${countLabel}种场景接入`;
}

export function homepageFlowIntro(visibleWorkflows: readonly WorkflowId[] = VISIBLE_WORKFLOWS): string {
  return `把${homepageHeroWorkflowPhrase(visibleWorkflows)}压缩进同一个可核对视图，保留 Agent 辅助与人工确认的边界。`;
}

function joinChineseList(labels: string[]): string {
  if (labels.length === 0) {
    return "业务流程";
  }
  if (labels.length === 1) {
    return labels[0]!;
  }
  if (labels.length === 2) {
    return `${labels[0]}和${labels[1]}`;
  }
  return `${labels.slice(0, -1).join("、")}和${labels[labels.length - 1]}`;
}
