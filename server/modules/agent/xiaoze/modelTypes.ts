import type { AgentToolResult } from "../types";
import type { XiaozePromptDebugSnapshot, XiaozeRunStep } from "@wiseeff/xiaoze-protocol";

export type { XiaozePromptDebugSnapshot } from "@wiseeff/xiaoze-protocol";

/**
 * Shared model/agent shape vocabulary for the Xiaoze planning pipeline.
 * Pure types with no implementation imports, so the planning graph, the
 * model wrappers, the prompt-debug builder, and the endpoint can share one
 * vocabulary without import cycles.
 */

export type PerceptionToolDescriptor = {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  requiresApproval?: boolean;
};

export type PerceptionAgentContext = {
  projectId?: string;
  pageKey?: string;
};

export type PerceptionAgentRunInput = {
  message: string;
  context: PerceptionAgentContext;
  threadId?: string;
  includePromptDebug?: boolean;
};

export type PerceptionAgentRunResult = {
  text: string;
  reasoning?: string;
  citations: AgentToolResult["citations"];
  promptDebug?: XiaozePromptDebugSnapshot;
  runSteps?: XiaozeRunStep[];
  interrupt?: {
    toolName: string;
    payload: Record<string, unknown>;
    citations: AgentToolResult["citations"];
  };
};

export type PerceptionModelToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type PerceptionModelResponse = {
  content?: string;
  reasoning?: string;
  toolCalls?: PerceptionModelToolCall[];
};

export type PerceptionModelStreamChunk = {
  reasoningDelta?: string;
  answerDelta?: string;
  toolCalls?: PerceptionModelToolCall[];
};

export type PerceptionChatModel = {
  invoke(messages: unknown[]): Promise<PerceptionModelResponse>;
  stream?(messages: unknown[]): AsyncIterable<PerceptionModelStreamChunk>;
};
