import type { AgentToolResult } from "../types";
import { looksLikeInternalReasoning } from "./splitAssistantContent";
import {
  createReasoningClassifier,
  readReasoningFromLangChainResponse,
  type ReasoningClassifierOptions
} from "./reasoningClassifier";

export { looksLikeInternalReasoning } from "./splitAssistantContent";
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
  return createReasoningClassifier({ fallbackHeuristic: false }).normalizeModelResponse(response);
}

export function appendStreamText(previous: string, incoming: string): { next: string; delta: string } {
  if (!incoming) {
    return { next: previous, delta: "" };
  }
  if (previous && incoming.startsWith(previous)) {
    return { next: incoming, delta: incoming.slice(previous.length) };
  }
  if (previous && previous.startsWith(incoming)) {
    return { next: previous, delta: "" };
  }
  return { next: previous + incoming, delta: incoming };
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

type LangChainChatModel = {
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
};

function mapLangChainResponse(
  response: Awaited<ReturnType<LangChainChatModel["invoke"]>>,
  classifier: ReturnType<typeof createReasoningClassifier>
): PerceptionModelResponse {
  const rawContent = typeof response.content === "string" ? response.content : "";
  const normalized = classifier.normalizeModelResponse({
    content: rawContent,
    reasoning: readReasoningFromLangChainResponse(response)
  });
  return {
    content: normalized.answer,
    reasoning: normalized.reasoning,
    toolCalls: mapLangChainToolCalls(response.tool_calls)
  };
}

export function wrapLangChainChatModel(
  model: LangChainChatModel,
  classifierOptions: ReasoningClassifierOptions = { fallbackHeuristic: false }
): PerceptionChatModel {
  const classifier = createReasoningClassifier(classifierOptions);

  return {
    async invoke(messages) {
      return mapLangChainResponse(await model.invoke(messages), classifier);
    },
    async *stream(messages) {
      if (!model.stream) {
        const response = await model.invoke(messages);
        const mapped = mapLangChainResponse(response, classifier);
        if (mapped.reasoning) {
          yield { reasoningDelta: mapped.reasoning };
        }
        if (mapped.content) {
          yield { answerDelta: mapped.content };
        }
        return;
      }

      let latestToolCalls: PerceptionModelToolCall[] | undefined;
      const router = classifier.createStreamRouter();
      const stream = await model.stream(messages);
      for await (const chunk of stream) {
        const mappedToolCalls = mapLangChainToolCalls(chunk.tool_calls);
        if (mappedToolCalls?.length) {
          latestToolCalls = mappedToolCalls;
        }

        for (const event of router.ingestChunk(chunk)) {
          if (event.reasoningDelta) {
            yield { reasoningDelta: event.reasoningDelta };
          }
          if (event.answerDelta) {
            yield { answerDelta: event.answerDelta };
          }
        }
      }
      if (latestToolCalls?.length) {
        yield { toolCalls: latestToolCalls };
      }
    }
  };
}
