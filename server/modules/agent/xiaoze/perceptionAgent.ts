import type { AgentToolResult } from "../types";
import { mergeReasoningText, splitAssistantContent } from "./splitAssistantContent";
import { createXiaozeCheckpointer, type XiaozeCheckpointer } from "./checkpointer";
import { createPlanningAgent, type PlanningApprovalBridge } from "./planningGraph";
import type { XiaozePromptDebugSnapshot } from "./promptDebug";

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
        reasoning: result.reasoning,
        citations: result.citations,
        promptDebug: result.promptDebug,
        interrupt: result.interrupt
      };
    },
    listTools: planningAgent.listTools
  };
}

export function normalizeModelResponse(response: Pick<PerceptionModelResponse, "content" | "reasoning">) {
  const split = splitAssistantContent(response.content ?? "");
  const reasoning = mergeReasoningText(response.reasoning, split.reasoning);
  const answer = split.answer || (reasoning ? "" : response.content ?? "");
  return {
    answer: answer.trim(),
    reasoning: reasoning || undefined
  };
}

function readReasoningFromLangChainResponse(response: {
  content?: unknown;
  additional_kwargs?: Record<string, unknown>;
  response_metadata?: Record<string, unknown>;
}) {
  const additional = response.additional_kwargs ?? {};
  const metadata = response.response_metadata ?? {};
  const reasoningDetails = additional.reasoning_details ?? metadata.reasoning_details;
  if (Array.isArray(reasoningDetails)) {
    const text = reasoningDetails
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        if (entry && typeof entry === "object" && "text" in entry) {
          return String((entry as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n\n")
      .trim();
    if (text) {
      return text;
    }
  }

  const reasoningContent = additional.reasoning_content ?? metadata.reasoning_content;
  return typeof reasoningContent === "string" ? reasoningContent.trim() : undefined;
}

export function wrapLangChainChatModel(model: {
  invoke(input: unknown): Promise<{
    content?: unknown;
    tool_calls?: Array<{ id?: string; name: string; args: Record<string, unknown> }>;
    additional_kwargs?: Record<string, unknown>;
    response_metadata?: Record<string, unknown>;
  }>;
}): PerceptionChatModel {
  return {
    async invoke(messages) {
      const response = await model.invoke(messages);
      const rawContent = typeof response.content === "string" ? response.content : "";
      const normalized = normalizeModelResponse({
        content: rawContent,
        reasoning: readReasoningFromLangChainResponse(response)
      });
      const toolCalls = response.tool_calls?.map((call, index) => ({
        id: call.id ?? `tool-${index}`,
        name: call.name,
        args: call.args
      }));
      return {
        content: normalized.answer,
        reasoning: normalized.reasoning,
        toolCalls
      };
    }
  };
}
