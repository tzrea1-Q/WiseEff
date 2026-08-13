import { formatToolCatalogForSystemPrompt } from "./toolCatalog";
import type { PerceptionAgentContext, PerceptionToolDescriptor, XiaozePromptDebugSnapshot } from "./modelTypes";

export { XIAOZE_PROMPT_DEBUG_EVENT } from "@wiseeff/xiaoze-protocol";

export function buildXiaozePromptDebugSnapshot(options: {
  threadId: string;
  message: string;
  context: PerceptionAgentContext;
  llmMessages: unknown[];
  tools: PerceptionToolDescriptor[];
  systemPolicy: string;
  model?: string;
  promptVersion?: string;
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
    ...(options.model ? { model: options.model } : {}),
    ...(options.promptVersion ? { promptVersion: options.promptVersion } : {})
  };
}
