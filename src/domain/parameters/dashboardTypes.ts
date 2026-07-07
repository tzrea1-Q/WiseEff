export type DashboardWindow = "7d" | "30d" | "180d";
export type HotspotDimension = "overall" | "module" | "project" | "parameter";

export type DashboardKpis = {
  totalParameters: number;
  managedProjects: number;
  changeFrequency: number; // change + workflow events within window
  activeContributors: number; // distinct changed_by users within window
  highRiskParameters: number;
};

export type TrendPoint = {
  bucketStart: string; // ISO timestamp of bucket start
  label: string; // "7/1" (day) or "第3周" (week)
  changeCount: number; // parameter_history_entries in bucket
  workflowEventCount: number; // parameter_change_requests created in bucket
};

export type ProjectRiskBucket = {
  projectId: string;
  projectCode: string;
  projectName: string;
  high: number;
  medium: number;
  low: number;
  total: number;
};

export type WorkbenchSignals = {
  reviewQueue: number; // open change requests reviewable by role
  myDrafts: number; // caller's drafts
  returnedChanges: number; // caller's rejected/returned change requests
  waitingMerge: number; // change requests in software_merge
  unappliedImportBatches: number; // import batches with applied_at IS NULL
  inactiveAccounts: number; // org users with is_active = false
};

export type DashboardSummary = {
  window: DashboardWindow;
  windowLabel: string; // "近 30 天"
  projectId: string | null; // null = all projects in org
  kpis: DashboardKpis;
  trend: TrendPoint[];
  riskBuckets: ProjectRiskBucket[];
  workbenchSignals: WorkbenchSignals;
};

export type HotspotScoreBreakdown = {
  frequency: number;
  risk: number;
  impact: number;
  workflow: number;
  drift: number;
};

export type DashboardHotspot = {
  id: string; // `${kind}:${groupId}`
  kind: "module" | "project" | "parameter";
  title: string;
  projectId?: string;
  projectCode: string;
  module: string;
  statusLabel: string; // "需要关注" | "偏高" | "正常"
  statusLevel: "watch" | "elevated" | "normal";
  score: number; // sum of scoreBreakdown, rounded to 0.1
  scoreBreakdown: HotspotScoreBreakdown;
  evidence: string[];
  trendDelta: number; // integer percent vs previous equal window
  trendDirection: "up" | "down" | "flat";
  lastChangedAt?: string;
  suggestedPath: string; // deep link with context query
};
