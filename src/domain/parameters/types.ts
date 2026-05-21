export type RiskLevel = "High" | "Medium" | "Low";

export type ParameterHistoryEntry = {
  version: string;
  value: string;
  changedAt: string;
  changedBy: string;
  requestId?: string;
};

export type ParameterRecord = {
  id: string;
  name: string;
  description: string;
  explanation: string;
  configFormat: string;
  module: string;
  projectId: string;
  currentValue: string;
  recommendedValue: string;
  range: string;
  unit: string;
  risk: RiskLevel;
  updatedAt: string;
  updatedAtTs: string;
  history: ParameterHistoryEntry[];
};

export type RequestStatus =
  | "硬件Committer检视"
  | "软件Committer检视"
  | "软件User合入"
  | "待审阅"
  | "自动检查通过"
  | "等待合入"
  | "已合入"
  | "已打回";

export type ParameterWorkflowAssignees = {
  hardwareCommitterId: string;
  softwareCommitterId: string;
  softwareUserId: string;
};

export type ParameterDraftItem = {
  parameterId: string;
  targetValue: string;
  reason: string;
};

export type AIConfidence = "high" | "mid" | "low";

export type AIRecommendation = "advance" | "needs-review" | "reject";

export type AIReviewSuggestion = {
  recommendation: AIRecommendation;
  confidence: AIConfidence;
  summary: string;
  reasons: string[];
  similarRequests: string[];
};

export type ImpactItem = {
  kind: "module" | "test" | "parameter";
  name: string;
  note: string;
  risk: RiskLevel;
};

export type ChangeRequest = {
  id: string;
  submissionRoundId?: string;
  projectId?: string;
  parameterId: string;
  module: string;
  title: string;
  currentValue: string;
  targetValue: string;
  submitter: string;
  createdAt: string;
  createdAtTs: string;
  updatedAt: string;
  status: RequestStatus;
  aiSummary: string;
  rejectReason?: string;
  waitingHours: number;
  aiSuggestion: AIReviewSuggestion;
  impact: ImpactItem[];
  assignedTo?: string;
  workflowAssignees?: ParameterWorkflowAssignees;
  fastTrack?: boolean;
  reviewerNote?: string;
};

export type ParameterSubmissionItem = {
  requestId: string;
  parameterId: string;
  name: string;
  module: string;
  currentValue: string;
  targetValue: string;
  unit: string;
  risk: RiskLevel;
  reason: string;
};

export type ParameterSubmissionRound = {
  id: string;
  projectId: string;
  projectName: string;
  submitter: string;
  createdAt: string;
  status: RequestStatus | "已撤回" | "已暂存";
  summary: string;
  workflowAssignees?: ParameterWorkflowAssignees;
  items: ParameterSubmissionItem[];
};
