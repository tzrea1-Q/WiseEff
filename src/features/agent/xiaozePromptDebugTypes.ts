export const XIAOZE_PROMPT_DEBUG_EVENT = "xiaoze_prompt_debug";

export type XiaozePromptDebugTool = {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  requiresApproval?: boolean;
};

export type XiaozePromptDebugSnapshot = {
  threadId: string;
  userMessage: string;
  context: {
    projectId?: string;
    pageKey?: string;
  };
  system: {
    policy: string;
    toolCatalog: string;
  };
  llmMessages: unknown[];
  tools: XiaozePromptDebugTool[];
  model?: string;
};

export type XiaozePromptDebugPayload = {
  runId: string;
  messageId: string;
  snapshot: XiaozePromptDebugSnapshot;
};
