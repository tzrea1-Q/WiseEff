import type { BackendPermission } from "../auth/types";

export type AgentToolName =
  | "parameter.scanOrphans"
  | "parameter.draftCleanupPlan"
  | "parameter.summarizeReviewQueue"
  | "parameter.submitChangeDraft"
  | "log.explainRootCause"
  | "log.generateChecklist"
  | "debugging.recommendTargetValues"
  | "debugging.prepareRollback"
  | "audit.summarizeRecentEvents"
  | "perception.getProjectOverview"
  | "perception.searchParameters"
  | "perception.getNodeSnapshot"
  | "perception.getRecentLogConclusions";

export type AgentContext = {
  path: string;
  pageKey: string;
  projectId?: string;
  roleId?: string;
};

export type AgentCitation = {
  type: "parameter" | "log" | "audit" | "debugging";
  id: string;
  label: string;
  href?: string;
  snippet?: string;
  confidence?: number;
};

export type AgentToolStatus = "requested" | "pending_approval" | "running" | "succeeded" | "failed" | "rejected";
export type AgentApprovalStatus = "pending" | "approved" | "rejected";
export type AgentToolKind = "read" | "preparation" | "mutating";

export type AgentMessageDto = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations?: AgentCitation[];
  confidence?: number;
  createdAt: string;
};

export type AgentToolResult = {
  summary: string;
  data: Record<string, unknown>;
  citations: AgentCitation[];
};

export type AgentToolCallDto = {
  id: string;
  name: AgentToolName;
  label: string;
  payload: Record<string, unknown>;
  requiresApproval: boolean;
  status: AgentToolStatus;
  result?: AgentToolResult;
  error?: string;
  approvalId?: string;
  auditEventId?: string;
  createdAt?: string;
  completedAt?: string;
};

export type AgentApprovalDto = {
  id: string;
  toolCallId: string;
  title: string;
  message: string;
  status: AgentApprovalStatus;
  createdAt?: string;
  decidedAt?: string;
  decidedByUserId?: string;
  reason?: string;
};

export type AgentSessionDto = {
  id: string;
  context: AgentContext;
  messages: AgentMessageDto[];
};

export type AgentTurnDto = {
  session: AgentSessionDto;
  messages: AgentMessageDto[];
  toolCalls: AgentToolCallDto[];
  approvals: AgentApprovalDto[];
};

export type AgentToolDefinition = {
  name: AgentToolName;
  label: string;
  kind: AgentToolKind;
  permission: BackendPermission;
  requiresApproval: boolean;
};
