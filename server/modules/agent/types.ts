export type { AgentToolName } from "./toolMetadata";
import type { AgentToolName } from "./toolMetadata";

export type AgentToolRequest = {
  name: AgentToolName;
  label: string;
  payload: Record<string, unknown>;
};

export type AgentContext = {
  path: string;
  pageKey: string;
  projectId?: string;
  roleId?: string;
};

export type { XiaozeCitation as AgentCitation } from "@wiseeff/xiaoze-protocol";
import type { XiaozeCitation as AgentCitation } from "@wiseeff/xiaoze-protocol";

export type AgentToolStatus = "requested" | "pending_approval" | "running" | "succeeded" | "failed" | "rejected";
export type AgentApprovalStatus = "pending" | "approved" | "rejected";
export type { AgentToolKind } from "./toolMetadata";

export type AgentMessageDto = {
  id: string;
  role: "user" | "assistant" | "system" | "reasoning";
  content: string;
  citations?: AgentCitation[];
  confidence?: number;
  metadata?: Record<string, unknown>;
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
  decidedByUserId?: string | null;
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
