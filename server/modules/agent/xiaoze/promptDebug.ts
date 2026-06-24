import type { PerceptionAgentContext, PerceptionToolDescriptor } from "./perceptionAgent";
import { formatToolCatalogForSystemPrompt } from "./toolCatalog";

export const XIAOZE_PROMPT_DEBUG_EVENT = "xiaoze_prompt_debug";

export type XiaozePromptDebugSnapshot = {
  threadId: string;
  userMessage: string;
  context: PerceptionAgentContext;
  system: {
    policy: string;
    toolCatalog: string;
  };
  llmMessages: unknown[];
  tools: PerceptionToolDescriptor[];
  model?: string;
};

export function buildXiaozePromptDebugSnapshot(options: {
  threadId: string;
  message: string;
  context: PerceptionAgentContext;
  llmMessages: unknown[];
  tools: PerceptionToolDescriptor[];
  systemPolicy: string;
  model?: string;
}): XiaozePromptDebugSnapshot {
  return {
    threadId: options.threadId,
    userMessage: options.message,
    context: options.context,
    system: {
      policy: options.systemPolicy,
      toolCatalog: formatToolCatalogForSystemPrompt(options.tools)
    },
    llmMessages: options.llmMessages,
    tools: options.tools,
    ...(options.model ? { model: options.model } : {})
  };
}
