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
  runSteps?: import("./runEventSink").XiaozeRunStepRecord[];
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

export async function invokeModelTurnWithStreaming(
  model: PerceptionChatModel,
  messages: unknown[],
  onDelta?: (chunk: PerceptionModelStreamChunk) => void
): Promise<PerceptionModelResponse> {
  if (model.stream) {
    let reasoning = "";
    let answer = "";
    let toolCalls: PerceptionModelToolCall[] | undefined;
    for await (const chunk of model.stream(messages)) {
      if (chunk.toolCalls?.length) {
        toolCalls = chunk.toolCalls;
      }
      if (chunk.reasoningDelta) {
        reasoning += chunk.reasoningDelta;
        onDelta?.({ reasoningDelta: chunk.reasoningDelta });
      }
      if (chunk.answerDelta) {
        answer += chunk.answerDelta;
        onDelta?.({ answerDelta: chunk.answerDelta });
      }
    }
    const normalized = normalizeModelResponse({ content: answer, reasoning: reasoning || undefined });
    return {
      content: normalized.answer,
      reasoning: normalized.reasoning,
      toolCalls
    };
  }

  const response = await model.invoke(messages);
  const normalized = normalizeModelResponse(response);
  if (normalized.reasoning) {
    onDelta?.({ reasoningDelta: normalized.reasoning });
  }
  if (normalized.answer) {
    onDelta?.({ answerDelta: normalized.answer });
  }
  return {
    content: normalized.answer,
    reasoning: normalized.reasoning,
    toolCalls: response.toolCalls
  };
}

export async function invokeModelWithStreaming(
  model: PerceptionChatModel,
  messages: unknown[],
  onDelta?: (chunk: PerceptionModelStreamChunk) => void
): Promise<{ answer: string; reasoning?: string }> {
  const response = await invokeModelTurnWithStreaming(model, messages, onDelta);
  return {
    answer: response.content ?? "",
    reasoning: response.reasoning
  };
}

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
        interrupt: result.interrupt,
        runSteps: result.runSteps
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

function mapLangChainToolCalls(
  toolCalls?: Array<{ id?: string; name: string; args: Record<string, unknown> }>
): PerceptionModelToolCall[] | undefined {
  return toolCalls?.map((call, index) => ({
    id: call.id ?? `tool-${index}`,
    name: call.name,
    args: call.args
  }));
}

function mapLangChainResponse(response: {
  content?: unknown;
  tool_calls?: Array<{ id?: string; name: string; args: Record<string, unknown> }>;
  additional_kwargs?: Record<string, unknown>;
  response_metadata?: Record<string, unknown>;
}): PerceptionModelResponse {
  const rawContent = typeof response.content === "string" ? response.content : "";
  const normalized = normalizeModelResponse({
    content: rawContent,
    reasoning: readReasoningFromLangChainResponse(response)
  });
  return {
    content: normalized.answer,
    reasoning: normalized.reasoning,
    toolCalls: mapLangChainToolCalls(response.tool_calls)
  };
}

export function wrapLangChainChatModel(model: {
  invoke(input: unknown): Promise<{
    content?: unknown;
    tool_calls?: Array<{ id?: string; name: string; args: Record<string, unknown> }>;
    additional_kwargs?: Record<string, unknown>;
    response_metadata?: Record<string, unknown>;
  }>;
  stream?(input: unknown): Promise<AsyncIterable<{
    content?: unknown;
    tool_calls?: Array<{ id?: string; name: string; args: Record<string, unknown> }>;
    additional_kwargs?: Record<string, unknown>;
    response_metadata?: Record<string, unknown>;
  }>>;
}): PerceptionChatModel {
  return {
    async invoke(messages) {
      return mapLangChainResponse(await model.invoke(messages));
    },
    async *stream(messages) {
      if (!model.stream) {
        const response = await model.invoke(messages);
        const mapped = mapLangChainResponse(response);
        if (mapped.reasoning) {
          yield { reasoningDelta: mapped.reasoning };
        }
        if (mapped.content) {
          yield { answerDelta: mapped.content };
        }
        return;
      }

      let reasoning = "";
      let answer = "";
      let latestToolCalls: PerceptionModelToolCall[] | undefined;
      const stream = await model.stream(messages);
      for await (const chunk of stream) {
        const mappedToolCalls = mapLangChainToolCalls(chunk.tool_calls);
        if (mappedToolCalls?.length) {
          latestToolCalls = mappedToolCalls;
        }
        const chunkReasoning = readReasoningFromLangChainResponse(chunk);
        if (chunkReasoning) {
          const delta = chunkReasoning.startsWith(reasoning)
            ? chunkReasoning.slice(reasoning.length)
            : chunkReasoning;
          if (delta) {
            reasoning = chunkReasoning;
            yield { reasoningDelta: delta };
          }
        }
        const rawContent = typeof chunk.content === "string" ? chunk.content : "";
        if (rawContent) {
          const delta = rawContent.startsWith(answer) ? rawContent.slice(answer.length) : rawContent;
          if (delta) {
            answer += delta;
            yield { answerDelta: delta };
          }
        }
      }
      if (latestToolCalls?.length) {
        yield { toolCalls: latestToolCalls };
      }
    }
  };
}
