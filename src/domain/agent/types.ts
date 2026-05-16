import type { PageKey } from "@/appConfig";

export type AgentToolName =
  | "parameter.scanOrphans"
  | "parameter.draftCleanupPlan"
  | "parameter.summarizeReviewQueue"
  | "parameter.submitChangeDraft"
  | "log.explainRootCause"
  | "log.generateChecklist"
  | "debugging.recommendTargetValues"
  | "debugging.prepareRollback"
  | "audit.summarizeRecentEvents";

export type AgentContext = {
  app: PageKey;
  projectId?: string;
  userId?: string;
  roleId?: string;
  selectedIds?: string[];
  metadata?: Record<string, unknown>;
};

export type AgentMessage = {
  id: string;
  role: "user" | "agent" | "system" | "tool";
  content: string;
  createdAt: string;
};

export type AgentToolCall = {
  id: string;
  name: AgentToolName;
  arguments: Record<string, unknown>;
  status: "pending" | "running" | "succeeded" | "failed";
  result?: unknown;
  error?: string;
};

export type AgentApproval = {
  id: string;
  toolCallId: string;
  status: "requested" | "approved" | "rejected";
  requestedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  note?: string;
};

export type AgentSession = {
  id: string;
  context: AgentContext;
  startedAt: string;
  updatedAt: string;
  messages: AgentMessage[];
  toolCalls: AgentToolCall[];
  approvals: AgentApproval[];
};

export type AgentTurn = {
  id: string;
  sessionId: string;
  input: AgentMessage;
  response?: AgentMessage;
  toolCalls: AgentToolCall[];
  approvals: AgentApproval[];
  createdAt: string;
};
