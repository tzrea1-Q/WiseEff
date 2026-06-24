import type { AgentToolResult } from "../types";
import { createXiaozeCheckpointer, type XiaozeCheckpointer } from "./checkpointer";
import { createPlanningAgent, type PlanningApprovalBridge } from "./planningGraph";

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
};

export type PerceptionAgentRunResult = {
  text: string;
  citations: AgentToolResult["citations"];
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
  toolCalls?: PerceptionModelToolCall[];
};

export type PerceptionChatModel = {
  invoke(messages: unknown[]): Promise<PerceptionModelResponse>;
};

export function createPerceptionAgent(options: {
  model: PerceptionChatModel;
  runTool: (name: string, payload: Record<string, unknown>) => Promise<AgentToolResult>;
  listTools: () => PerceptionToolDescriptor[];
  checkpointer?: XiaozeCheckpointer;
  approvalBridge?: PlanningApprovalBridge;
}) {
  const planningAgent = createPlanningAgent(options);

  return {
    async run(input: PerceptionAgentRunInput): Promise<PerceptionAgentRunResult> {
      const result = await planningAgent.run({
        ...input,
        threadId: input.threadId ?? "default"
      });
      return {
        text: result.text,
        citations: result.citations,
        interrupt: result.interrupt
      };
    },
    listTools: planningAgent.listTools
  };
}

export function wrapLangChainChatModel(model: {
  invoke(input: unknown): Promise<{ content?: unknown; tool_calls?: Array<{ id?: string; name: string; args: Record<string, unknown> }> }>;
}): PerceptionChatModel {
  return {
    async invoke(messages) {
      const response = await model.invoke(messages);
      const content = typeof response.content === "string" ? response.content : undefined;
      const toolCalls = response.tool_calls?.map((call, index) => ({
        id: call.id ?? `tool-${index}`,
        name: call.name,
        args: call.args
      }));
      return { content, toolCalls };
    }
  };
}
