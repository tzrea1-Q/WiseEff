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
  path: string;
  pageKey: string;
  projectId?: string;
  roleId?: string;
};

export type AgentMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
};

export type AgentToolCall = {
  id: string;
  name: AgentToolName;
  label: string;
  payload: Record<string, unknown>;
  requiresApproval: boolean;
};

export type AgentApproval = {
  id: string;
  toolCallId: string;
  title: string;
  message: string;
};

export type AgentSession = {
  id: string;
  context: AgentContext;
  messages: AgentMessage[];
};

export type AgentTurn = {
  session: AgentSession;
  messages: AgentMessage[];
  toolCalls: AgentToolCall[];
  approvals: AgentApproval[];
};
