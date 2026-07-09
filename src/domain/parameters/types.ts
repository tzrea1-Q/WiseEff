import type { ParameterValueKind } from "@/powerManagementConfig";

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
  moduleId?: string;
  modulePath?: string[];
  projectId: string;
  currentValue: string;
  recommendedValue: string;
  range: string;
  unit: string;
  risk: RiskLevel;
  valueKind: ParameterValueKind;
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
  baseVersion?: number;
  module: string;
  title: string;
  currentValue: string;
  targetValue: string;
  submitter: string;
  valueKind?: ParameterValueKind;
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
  valueKind?: ParameterValueKind;
  reason: string;
};

export type SubmissionWorkflowStageDetail = {
  key: "hardware_review" | "software_review" | "software_merge";
  stepIndex: number;
  label: string;
  assigneeName: string;
  executorName?: string;
  executorLabel: "执行人" | "当前处理";
  state: "pending" | "active" | "completed" | "skipped";
};

export type ParameterReviewDecisionRecord = {
  id: string;
  requestId: string;
  reviewerUserId: string;
  decision: "advance" | "reject";
  fromStatus: string;
  toStatus: string;
  createdAt: string;
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
  workflowTrail?: SubmissionWorkflowStageDetail[];
  items: ParameterSubmissionItem[];
};

export type ProjectInitializationStatus =
  | "not_initialized"
  | "initialization_draft"
  | "initialization_pending_review"
  | "initialization_rejected"
  | "initialized"
  | "maintenance";

export type ParameterInitializationSourceRole = "primary" | "supplement" | "library";

export type ProjectParameterInitializationSnapshotItem = {
  parameterId: string;
  sourceProjectId: string;
  sourceRole: ParameterInitializationSourceRole;
  module: string;
  risk: RiskLevel;
  recommendedValue: string;
  currentValueState: "pending_project_confirmation";
  alternativeSourceProjectIds: string[];
  needsRecommendedValueConfirmation: boolean;
  notes?: string;
};

export type ProjectParameterInitializationDraft = {
  id: string;
  projectId: string;
  projectName: string;
  projectCode: string;
  ownerUserId: string;
  sourceProjectIds: string[];
  primarySourceProjectId: string;
  supplementSourceProjectIds: string[];
  selectedModules: string[];
  selectedRisks: RiskLevel[];
  selectedParameterIds: string[];
  parameterSnapshots: ProjectParameterInitializationSnapshotItem[];
  notes: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectParameterInitializationReview = {
  id: string;
  draftId: string;
  projectId: string;
  status: "pending" | "approved" | "rejected";
  submittedBy: string;
  submittedAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  rejectionReason?: string;
};
