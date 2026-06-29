import {
  Annotation,
  Command,
  END,
  START,
  StateGraph,
  interrupt,
  isGraphInterrupt
} from "@langchain/langgraph";
import { ApiError } from "../../../shared/http/errors";
import type { AgentToolResult } from "../types";
import type { AuthContext } from "../../auth/types";
import type { ApprovalBridgeResumeInput, ApprovalBridgeResumeResult } from "./approvalBridge";
import { createXiaozeCheckpointer, type XiaozeCheckpointer } from "./checkpointer";
import type {
  PerceptionAgentContext,
  PerceptionAgentRunInput,
  PerceptionAgentRunResult,
  PerceptionChatModel,
  PerceptionModelToolCall,
  PerceptionToolDescriptor
} from "./perceptionAgent";
import { invokeModelTurnWithStreaming, invokeModelWithStreaming } from "./perceptionAgent";
import { mergeReasoningText } from "./splitAssistantContent";
import { formatToolCatalogForSystemPrompt, getXiaozeToolLabel } from "./toolCatalog";
import { buildXiaozePromptDebugSnapshot } from "./promptDebug";
import { startRunStep, type RunEventSink } from "./runEventSink";
import { createToolCallId } from "./runTimelineEvents";
import { XIAOZE_PROMPT_VERSION, XIAOZE_SYSTEM_PROMPT } from "./xiaozePrompt";

export type PlanningResumeDecision = Pick<
  ApprovalBridgeResumeInput,
  "approvalId" | "decision" | "editedArgs" | "reason"
> & {
  auth: AuthContext;
  requestId: string;
};

export type PlanningAgentRunInput = PerceptionAgentRunInput & {
  threadId: string;
  resume?: PlanningResumeDecision;
  sink?: RunEventSink;
};

export type PlanningApprovalBridge = {
  resume(input: ApprovalBridgeResumeInput): Promise<ApprovalBridgeResumeResult>;
};

const SYSTEM_PROMPT = XIAOZE_SYSTEM_PROMPT;

const MAX_TURNS = 6;

const PlanningState = Annotation.Root({
  messages: Annotation<unknown[]>({
    reducer: (_, update) => update ?? [],
    default: () => []
  }),
  planSteps: Annotation<string[]>({
    reducer: (left, update) => update ?? left,
    default: () => []
  }),
  step: Annotation<number>({
    reducer: (_, update) => update ?? 0,
    default: () => 0
  }),
  perceivedCitations: Annotation<AgentToolResult["citations"]>({
    reducer: (_, update) => update ?? [],
    default: () => []
  }),
  context: Annotation<PerceptionAgentContext>({
    reducer: (_, update) => update ?? {},
    default: () => ({})
  }),
  text: Annotation<string | undefined>({
    reducer: (_, update) => update,
    default: () => undefined
  }),
  reasoning: Annotation<string | undefined>({
    reducer: (_, update) => update,
    default: () => undefined
  }),
  interrupt: Annotation<PerceptionAgentRunResult["interrupt"]>({
    reducer: (_, update) => (update === null ? undefined : update),
    default: () => undefined
  }),
  pendingMutatingCall: Annotation<PerceptionModelToolCall | undefined>({
    reducer: (_, update) => (update === null ? undefined : update),
    default: () => undefined
  }),
  turnCount: Annotation<number>({
    reducer: (_, update) => update ?? 0,
    default: () => 0
  }),
  halted: Annotation<boolean>({
    reducer: (_, update) => update ?? false,
    default: () => false
  })
});

type PlanningGraphState = typeof PlanningState.State;

function isForbiddenError(error: unknown) {
  return error instanceof ApiError && error.code === "FORBIDDEN";
}

function mergeToolPayload(
  args: Record<string, unknown>,
  context: PerceptionAgentContext
): Record<string, unknown> {
  return {
    ...args,
    ...(typeof args.projectId === "string" ? {} : context.projectId ? { projectId: context.projectId } : {})
  };
}

function beginTurnState(): Partial<PlanningGraphState> {
  return {
    step: 0,
    turnCount: 0,
    text: "",
    reasoning: "",
    halted: false,
    pendingMutatingCall: null as unknown as undefined,
    interrupt: null as unknown as undefined,
    perceivedCitations: []
  };
}

function buildPlanningLlmMessages(input: PlanningAgentRunInput, tools: PerceptionToolDescriptor[]): unknown[] {
  const toolCatalog = formatToolCatalogForSystemPrompt(tools);
  return [
    { role: "system", content: [SYSTEM_PROMPT, toolCatalog].join("\n\n") },
    {
      role: "user",
      content: [
        input.message,
        input.context.pageKey ? `\nCurrent page: ${input.context.pageKey}` : "",
        input.context.projectId ? `\nCurrent project: ${input.context.projectId}` : ""
      ].join("")
    }
  ];
}

function buildInitialMessages(input: PlanningAgentRunInput, tools: PerceptionToolDescriptor[]): unknown[] {
  return buildPlanningLlmMessages(input, tools);
}

function extractInterruptFromState(finalState: PlanningGraphState & { __interrupt__?: Array<{ value?: unknown }> }): PerceptionAgentRunResult["interrupt"] | undefined {
  const interruptEntry = finalState.__interrupt__?.[0]?.value as
    | { toolName?: string; payload?: Record<string, unknown>; citations?: AgentToolResult["citations"] }
    | undefined;
  if (!interruptEntry?.toolName || !interruptEntry.payload) {
    return undefined;
  }
  return {
    toolName: interruptEntry.toolName,
    payload: interruptEntry.payload,
    citations: interruptEntry.citations ?? finalState.perceivedCitations
  };
}

export function createPlanningAgent(options: {
  model: PerceptionChatModel;
  runTool: (name: string, payload: Record<string, unknown>) => Promise<AgentToolResult>;
  listTools: () => PerceptionToolDescriptor[];
  checkpointer?: XiaozeCheckpointer;
  approvalBridge?: PlanningApprovalBridge;
}) {
  const checkpointer = options.checkpointer ?? createXiaozeCheckpointer();
  let activeSink: RunEventSink | undefined;

  function pushSink(event: Parameters<RunEventSink["push"]>[0]) {
    activeSink?.push(event);
  }

  async function invokeModel(messages: unknown[]) {
    return invokeModelWithStreaming(options.model, messages, (chunk) => {
      if (chunk.reasoningDelta) {
        pushSink({ type: "reasoning_delta", delta: chunk.reasoningDelta });
      }
      if (chunk.answerDelta) {
        pushSink({ type: "answer_delta", delta: chunk.answerDelta });
      }
    });
  }

  function intentNode(state: PlanningGraphState): Partial<PlanningGraphState> {
    return {
      ...beginTurnState(),
      ...(state.planSteps.length === 0
        ? {
            planSteps: ["Understand user intent", "Perceive relevant data", "Plan and act with approval"]
          }
        : {})
    };
  }

  async function perceiveNode(state: PlanningGraphState): Promise<Partial<PlanningGraphState>> {
    if (state.halted || state.text?.trim()) {
      return {};
    }
    if (state.turnCount >= MAX_TURNS) {
      return { text: "I could not complete the request within the allowed tool turns." };
    }

    const response = await invokeModelTurnWithStreaming(options.model, state.messages, (chunk) => {
      if (chunk.reasoningDelta) {
        pushSink({ type: "reasoning_delta", delta: chunk.reasoningDelta });
      }
    });
    if (!response.toolCalls?.length) {
      const answer = response.content?.trim();
      if (answer) {
        pushSink({ type: "answer_delta", delta: answer });
      }
      return {
        text: response.content,
        reasoning: mergeReasoningText(state.reasoning, response.reasoning),
        messages: answer ? [...state.messages, { role: "assistant", content: answer }] : state.messages,
        step: state.step + 1
      };
    }

    const messages = [...state.messages, { role: "assistant", tool_calls: response.toolCalls }];
    const citations = [...state.perceivedCitations];
    let pendingMutating: PerceptionModelToolCall | undefined;

    for (const call of response.toolCalls) {
      const toolDefinition = options.listTools().find((tool) => tool.name === call.name);
      if (toolDefinition?.requiresApproval) {
        pendingMutating = call;
        break;
      }
      const payload = mergeToolPayload(call.args, state.context);
      const toolCallId = call.id || createToolCallId();
      const label = getXiaozeToolLabel(call.name);
      const { step, finish } = startRunStep({ kind: "tool", label, toolName: call.name });
      pushSink({ type: "step_started", step });
      pushSink({ type: "tool_call", toolCallId, toolName: call.name, args: payload });
      try {
        const result = await options.runTool(call.name, payload);
        citations.push(...result.citations);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ summary: result.summary, data: result.data, citations: result.citations })
        });
        pushSink({
          type: "tool_result",
          toolCallId,
          toolName: call.name,
          summary: result.summary,
          status: "succeeded"
        });
        pushSink(finish({ status: "succeeded", summary: result.summary }));
      } catch (error) {
        if (isForbiddenError(error)) {
          const summary = "You are not permitted to access this data.";
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: "FORBIDDEN", message: summary })
          });
          pushSink({
            type: "tool_result",
            toolCallId,
            toolName: call.name,
            summary,
            status: "forbidden"
          });
          pushSink(finish({ status: "forbidden", summary }));
        } else {
          pushSink(finish({ status: "failed", summary: error instanceof Error ? error.message : "Tool failed." }));
          throw error;
        }
      }
    }

    if (pendingMutating) {
      return {
        messages,
        perceivedCitations: citations,
        pendingMutatingCall: pendingMutating,
        reasoning: mergeReasoningText(state.reasoning, response.reasoning),
        turnCount: state.turnCount + 1
      };
    }

    return {
      messages,
      perceivedCitations: citations,
      reasoning: mergeReasoningText(state.reasoning, response.reasoning),
      turnCount: state.turnCount + 1
    };
  }

  function planNode(state: PlanningGraphState): Partial<PlanningGraphState> {
    if (state.text || state.halted) {
      return {};
    }
    if (state.pendingMutatingCall) {
      return { step: state.step + 1 };
    }
    return {};
  }

  async function actNode(state: PlanningGraphState): Promise<Partial<PlanningGraphState>> {
    const pending = state.pendingMutatingCall;
    if (!pending) {
      return {};
    }

    const payload = mergeToolPayload(pending.args, state.context);
    const interruptPayload = {
      toolName: pending.name,
      payload,
      citations: state.perceivedCitations
    };

    const resumeDecision = interrupt(interruptPayload) as PlanningResumeDecision;
    if (!options.approvalBridge) {
      throw new Error("Approval bridge is required to resume mutating actions.");
    }

    const resumed = await options.approvalBridge.resume({
      auth: resumeDecision.auth,
      requestId: resumeDecision.requestId,
      approvalId: resumeDecision.approvalId,
      decision: resumeDecision.decision,
      editedArgs: resumeDecision.editedArgs,
      reason: resumeDecision.reason
    });

    if (resumeDecision.decision === "reject") {
      return {
        text: resumed.text,
        halted: true,
        pendingMutatingCall: undefined,
        interrupt: undefined,
        step: state.step + 1
      };
    }

    const messages = [
      ...state.messages,
      {
        role: "tool",
        tool_call_id: pending.id,
        content: JSON.stringify({ summary: resumed.text, data: {}, citations: state.perceivedCitations })
      }
    ];

    return {
      messages,
      pendingMutatingCall: undefined,
      interrupt: undefined,
      step: state.step + 1
    };
  }

  async function observeNode(state: PlanningGraphState): Promise<Partial<PlanningGraphState>> {
    if (state.halted || state.text) {
      return {};
    }
    const { step, finish } = startRunStep({ kind: "model", label: "生成回复" });
    pushSink({ type: "step_started", step });
    const normalized = await invokeModel(state.messages);
    pushSink(finish({ status: "succeeded", summary: normalized.answer ? "Reply ready" : undefined }));
    if (normalized.answer || normalized.reasoning) {
      return {
        text: normalized.answer,
        reasoning: mergeReasoningText(state.reasoning, normalized.reasoning),
        step: state.step + 1
      };
    }
    return { turnCount: state.turnCount };
  }

  function routeAfterPerceive(state: PlanningGraphState): "plan" | "perceive" | typeof END {
    if (state.text || state.halted) {
      return END;
    }
    if (state.pendingMutatingCall) {
      return "plan";
    }
    if (state.turnCount >= MAX_TURNS) {
      return END;
    }
    return "perceive";
  }

  function routeAfterPlan(state: PlanningGraphState): "act" | typeof END {
    if (state.text || state.halted) {
      return END;
    }
    if (state.pendingMutatingCall) {
      return "act";
    }
    return END;
  }

  function routeAfterAct(state: PlanningGraphState): "observe" | typeof END {
    if (state.halted || state.text) {
      return END;
    }
    return "observe";
  }

  function routeAfterObserve(state: PlanningGraphState): "perceive" | typeof END {
    if (state.text || state.halted) {
      return END;
    }
    return "perceive";
  }

  const graph = new StateGraph(PlanningState)
    .addNode("intent", intentNode)
    .addNode("perceive", perceiveNode)
    .addNode("plan", planNode)
    .addNode("act", actNode)
    .addNode("observe", observeNode)
    .addEdge(START, "intent")
    .addEdge("intent", "perceive")
    .addConditionalEdges("perceive", routeAfterPerceive, ["plan", "perceive", END])
    .addConditionalEdges("plan", routeAfterPlan, ["act", END])
    .addConditionalEdges("act", routeAfterAct, ["observe", END])
    .addConditionalEdges("observe", routeAfterObserve, ["perceive", END])
    .compile({ checkpointer: checkpointer.saver });

  return {
    listTools: options.listTools,
    async run(input: PlanningAgentRunInput): Promise<PerceptionAgentRunResult & { threadId: string }> {
      const config = { configurable: { thread_id: input.threadId } };
      const tools = options.listTools();
      const buildPromptDebug = (llmMessages: unknown[]) =>
        input.includePromptDebug
          ? buildXiaozePromptDebugSnapshot({
              threadId: input.threadId,
              message: input.message,
              context: input.context,
              llmMessages,
              tools,
              systemPolicy: SYSTEM_PROMPT,
              promptVersion: XIAOZE_PROMPT_VERSION
            })
          : undefined;

      await checkpointer.put(input.threadId, {
        planSteps: ["Understand user intent", "Perceive relevant data", "Plan and act with approval"],
        step: 0
      });

      const initialState: Partial<PlanningGraphState> = {
        ...beginTurnState(),
        messages: buildInitialMessages(input, tools),
        context: input.context
      };

      try {
        activeSink = input.sink;
        if (input.resume) {
          const finalState = (await graph.invoke(new Command({ resume: input.resume }), config)) as PlanningGraphState & {
            __interrupt__?: Array<{ value?: unknown }>;
          };
          const interruptResult = extractInterruptFromState(finalState);
          return {
            threadId: input.threadId,
            text: finalState.text ?? "",
            reasoning: finalState.reasoning || undefined,
            citations: finalState.perceivedCitations,
            interrupt: interruptResult ?? finalState.interrupt,
            runSteps: activeSink?.getSteps()
          };
        }

        const finalState = (await graph.invoke(initialState, config)) as PlanningGraphState & {
          __interrupt__?: Array<{ value?: unknown }>;
        };
        const interruptResult = extractInterruptFromState(finalState);
        const llmMessages =
          finalState.messages?.length > 0 ? finalState.messages : buildPlanningLlmMessages(input, tools);
        return {
          threadId: input.threadId,
          text: finalState.text ?? "",
          reasoning: finalState.reasoning || undefined,
          citations: finalState.perceivedCitations,
          promptDebug: buildPromptDebug(llmMessages),
          interrupt: interruptResult ?? finalState.interrupt,
          runSteps: activeSink?.getSteps()
        };
      } catch (error) {
        if (isGraphInterrupt(error)) {
          const value = error.interrupts?.[0]?.value as
            | { toolName?: string; payload?: Record<string, unknown>; citations?: AgentToolResult["citations"] }
            | undefined;
          if (value?.toolName && value.payload) {
            const checkpoint = await graph.getState(config);
            const llmMessages =
              checkpoint.values.messages?.length > 0
                ? checkpoint.values.messages
                : buildPlanningLlmMessages(input, tools);
            return {
              threadId: input.threadId,
              text: "",
              citations: value.citations ?? [],
              promptDebug: buildPromptDebug(llmMessages),
              interrupt: {
                toolName: value.toolName,
                payload: value.payload,
                citations: value.citations ?? []
              },
              runSteps: activeSink?.getSteps()
            };
          }
        }
        throw error;
      } finally {
        activeSink = undefined;
      }
    }
  };
}

export function fakeModelSequence(
  responses: Array<{ toolCalls?: PerceptionModelToolCall[]; content?: string; reasoning?: string }>
): PerceptionChatModel {
  let index = 0;
  return {
    async invoke() {
      const response = responses[index] ?? responses.at(-1)!;
      index += 1;
      return response;
    },
    async *stream() {
      const response = responses[index] ?? responses.at(-1)!;
      index += 1;
      if (response.toolCalls?.length) {
        yield { toolCalls: response.toolCalls };
        return;
      }
      if (response.reasoning) {
        for (const char of response.reasoning) {
          yield { reasoningDelta: char };
        }
      }
      if (response.content) {
        for (const char of response.content) {
          yield { answerDelta: char };
        }
      }
    }
  };
}

export function toolCall(name: string, args: Record<string, unknown>): PerceptionModelToolCall {
  return { id: `tc-${name}`, name, args };
}
