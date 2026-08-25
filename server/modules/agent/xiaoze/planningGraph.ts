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
import type { ApprovalResolveInput, ApprovalResolveResult } from "../orchestrator";
import { createXiaozeCheckpointer, type XiaozeCheckpointer } from "./checkpointer";
import type {
  PerceptionAgentContext,
  PerceptionAgentRunInput,
  PerceptionAgentRunResult,
  PerceptionChatModel,
  PerceptionModelToolCall,
  PerceptionToolDescriptor
} from "./modelTypes";
import { invokeModelTurnWithStreaming, invokeModelWithStreaming } from "./perceptionAgent";
import { mergeReasoningText } from "./splitAssistantContent";
import { formatToolCatalogForSystemPrompt, getXiaozeToolLabel } from "./toolCatalog";
import { buildXiaozePromptDebugSnapshot } from "./promptDebug";
import { createToolCallId, startRunStep, type RunEventSink } from "./runEventSink";
import { formatApprovalExecutionFailure } from "./approvalExecutionFailure";
import { XIAOZE_PROMPT_VERSION, XIAOZE_SYSTEM_PROMPT } from "./xiaozePrompt";

export type PlanningResumeDecision = Pick<ApprovalResolveInput, "approvalId" | "decision" | "editedArgs" | "reason">;

export type PlanningRequestContext = {
  auth: AuthContext;
  requestId: string;
  sessionId: string;
  projectId?: string;
};

export type PlanningAgentRunInput = PerceptionAgentRunInput & {
  threadId: string;
  resume?: PlanningResumeDecision;
  sink?: RunEventSink;
  requestContext?: PlanningRequestContext;
};

export type PlanningApprovalResolver = {
  resolveApproval(input: ApprovalResolveInput): Promise<ApprovalResolveResult>;
};

const XIAOZE_RUN_SCOPE_KEY = "xiaozeRunScope";

type XiaozeRunScope = {
  sink?: RunEventSink;
  requestContext?: PlanningRequestContext;
};

type PlanningNodeConfig = {
  configurable?: Record<string, unknown>;
};

function readRunScope(config?: PlanningNodeConfig): XiaozeRunScope {
  const value = config?.configurable?.[XIAOZE_RUN_SCOPE_KEY];
  return value && typeof value === "object" ? (value as XiaozeRunScope) : {};
}

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
  pendingMutatingToolCallId: Annotation<string | undefined>({
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
    pendingMutatingToolCallId: null as unknown as undefined,
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
    | { toolCallId?: string; toolName?: string; payload?: Record<string, unknown>; citations?: AgentToolResult["citations"] }
    | undefined;
  if (!interruptEntry?.toolName || !interruptEntry.payload) {
    return undefined;
  }
  return {
    toolCallId: interruptEntry.toolCallId,
    toolName: interruptEntry.toolName,
    payload: interruptEntry.payload,
    citations: interruptEntry.citations ?? finalState.perceivedCitations
  };
}

export function createPlanningAgent(options: {
  model: PerceptionChatModel;
  runTool: (
    name: string,
    payload: Record<string, unknown>,
    requestContext?: PlanningRequestContext,
    toolCallId?: string
  ) => Promise<AgentToolResult>;
  listTools: () => PerceptionToolDescriptor[];
  checkpointer?: XiaozeCheckpointer;
  approvalResolver?: PlanningApprovalResolver;
}) {
  const checkpointer = options.checkpointer ?? createXiaozeCheckpointer();

  function pushSink(config: PlanningNodeConfig | undefined, event: Parameters<RunEventSink["push"]>[0]) {
    readRunScope(config).sink?.push(event);
  }

  async function invokeModel(messages: unknown[], config?: PlanningNodeConfig) {
    return invokeModelWithStreaming(options.model, messages, (chunk) => {
      if (chunk.reasoningDelta) {
        pushSink(config, { type: "reasoning_delta", delta: chunk.reasoningDelta });
      }
      if (chunk.answerDelta) {
        pushSink(config, { type: "answer_delta", delta: chunk.answerDelta });
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

  async function perceiveNode(
    state: PlanningGraphState,
    config?: PlanningNodeConfig
  ): Promise<Partial<PlanningGraphState>> {
    if (state.halted || state.text?.trim()) {
      return {};
    }
    if (state.turnCount >= MAX_TURNS) {
      return { text: "I could not complete the request within the allowed tool turns." };
    }

    const response = await invokeModelTurnWithStreaming(options.model, state.messages, (chunk) => {
      if (chunk.reasoningDelta) {
        pushSink(config, { type: "reasoning_delta", delta: chunk.reasoningDelta });
      }
    });
    if (!response.toolCalls?.length) {
      const answer = response.content?.trim();
      if (answer) {
        pushSink(config, { type: "answer_delta", delta: answer });
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
    let pendingMutatingToolCallId: string | undefined;

    for (const call of response.toolCalls) {
      const toolDefinition = options.listTools().find((tool) => tool.name === call.name);
      if (toolDefinition?.requiresApproval) {
        pendingMutating = call;
        pendingMutatingToolCallId = createToolCallId();
        break;
      }
      const payload = mergeToolPayload(call.args, state.context);
      const toolCallId = createToolCallId();
      const label = getXiaozeToolLabel(call.name);
      const { step, finish } = startRunStep({ kind: "tool", label, toolName: call.name });
      pushSink(config, { type: "step_started", step });
      pushSink(config, { type: "tool_call", toolCallId, toolName: call.name, args: payload });
      try {
        const result = await options.runTool(call.name, payload, readRunScope(config).requestContext, toolCallId);
        citations.push(...result.citations);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ summary: result.summary, data: result.data, citations: result.citations })
        });
        pushSink(config, {
          type: "tool_result",
          toolCallId,
          toolName: call.name,
          summary: result.summary,
          status: "succeeded"
        });
        pushSink(config, finish({ status: "succeeded", summary: result.summary }));
      } catch (error) {
        if (isForbiddenError(error)) {
          const summary = "You are not permitted to access this data.";
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: "FORBIDDEN", message: summary })
          });
          pushSink(config, {
            type: "tool_result",
            toolCallId,
            toolName: call.name,
            summary,
            status: "forbidden"
          });
          pushSink(config, finish({ status: "forbidden", summary }));
        } else {
          pushSink(config, finish({ status: "failed", summary: error instanceof Error ? error.message : "Tool failed." }));
          throw error;
        }
      }
    }

    if (pendingMutating) {
      return {
        messages,
        perceivedCitations: citations,
        pendingMutatingCall: pendingMutating,
        pendingMutatingToolCallId,
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

  async function actNode(
    state: PlanningGraphState,
    config?: PlanningNodeConfig
  ): Promise<Partial<PlanningGraphState>> {
    const pending = state.pendingMutatingCall;
    if (!pending) {
      return {};
    }

    const pendingToolCallId = state.pendingMutatingToolCallId;
    if (!pendingToolCallId) {
      throw new ApiError("CONFLICT", "Xiaoze approval checkpoint is missing durable tool-call correlation.", {
        sessionId: readRunScope(config).requestContext?.sessionId
      });
    }

    const payload = mergeToolPayload(pending.args, state.context);
    const interruptPayload = {
      toolCallId: pendingToolCallId,
      toolName: pending.name,
      payload,
      citations: state.perceivedCitations
    };

    const resumeDecision = interrupt(interruptPayload) as PlanningResumeDecision;
    if (!options.approvalResolver) {
      throw new Error("Approval resolver is required to resume mutating actions.");
    }
    const requestContext = readRunScope(config).requestContext;
    if (!requestContext) {
      throw new Error("Xiaoze request context is required to resolve approvals.");
    }

    if (resumeDecision.decision === "reject") {
      const resumed = await options.approvalResolver.resolveApproval({
        auth: requestContext.auth,
        requestId: requestContext.requestId,
        approvalId: resumeDecision.approvalId,
        decision: "reject",
        expectedSessionId: requestContext.sessionId,
        expectedToolCallId: pendingToolCallId,
        reason: resumeDecision.reason
      });
      return {
        text: resumed.text,
        halted: true,
        pendingMutatingCall: undefined,
        pendingMutatingToolCallId: undefined,
        interrupt: undefined,
        step: state.step + 1
      };
    }

    // Approved execution shows up on the step timeline like any other tool run.
    const { step, finish } = startRunStep({
      kind: "tool",
      label: getXiaozeToolLabel(pending.name),
      toolName: pending.name
    });
    pushSink(config, { type: "step_started", step });
    let resumed: Awaited<ReturnType<typeof options.approvalResolver.resolveApproval>>;
    try {
      resumed = await options.approvalResolver.resolveApproval({
        auth: requestContext.auth,
        requestId: requestContext.requestId,
        approvalId: resumeDecision.approvalId,
        decision: resumeDecision.decision,
        expectedSessionId: requestContext.sessionId,
        expectedToolCallId: pendingToolCallId,
        editedArgs: resumeDecision.editedArgs,
        reason: resumeDecision.reason
      });
    } catch (error) {
      const summary = formatApprovalExecutionFailure(error);
      pushSink(config, finish({ status: "failed", summary }));
      if (isForbiddenError(error)) {
        throw error;
      }
      return {
        text: summary,
        halted: true,
        pendingMutatingCall: undefined,
        pendingMutatingToolCallId: undefined,
        interrupt: undefined,
        step: state.step + 1
      };
    }
    pushSink(config, finish({ status: "succeeded", summary: resumed.text }));

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
      pendingMutatingToolCallId: undefined,
      interrupt: undefined,
      step: state.step + 1
    };
  }

  async function observeNode(
    state: PlanningGraphState,
    config?: PlanningNodeConfig
  ): Promise<Partial<PlanningGraphState>> {
    if (state.halted || state.text) {
      return {};
    }
    const { step, finish } = startRunStep({ kind: "model", label: "生成回复" });
    pushSink(config, { type: "step_started", step });
    const normalized = await invokeModel(state.messages, config);
    pushSink(config, finish({ status: "succeeded", summary: normalized.answer ? "Reply ready" : undefined }));
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
      const runScope: XiaozeRunScope = {
        sink: input.sink,
        requestContext: input.requestContext
      };
      // The client supplies threadId, so the checkpoint namespace must carry the
      // organization and user: otherwise replaying someone else's threadId would
      // resume their conversation state across user or tenant boundaries.
      const checkpointThreadId = input.requestContext
        ? `${input.requestContext.auth.organization.id}:${input.requestContext.auth.user.id}:${input.threadId}`
        : input.threadId;
      const config = { configurable: { thread_id: checkpointThreadId, [XIAOZE_RUN_SCOPE_KEY]: runScope } };
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

      await checkpointer.put(checkpointThreadId, {
        planSteps: ["Understand user intent", "Perceive relevant data", "Plan and act with approval"],
        step: 0
      });

      const initialState: Partial<PlanningGraphState> = {
        ...beginTurnState(),
        messages: buildInitialMessages(input, tools),
        context: input.context
      };

      try {
        if (input.resume) {
          const resumeValue: PlanningResumeDecision = {
            approvalId: input.resume.approvalId,
            decision: input.resume.decision,
            editedArgs: input.resume.editedArgs,
            reason: input.resume.reason
          };
          const finalState = (await graph.invoke(new Command({ resume: resumeValue }), config)) as PlanningGraphState & {
            __interrupt__?: Array<{ value?: unknown }>;
          };
          const interruptResult = extractInterruptFromState(finalState);
          if (interruptResult ?? finalState.interrupt) {
            await checkpointer.ensureInterruptCheckpointDurable(checkpointThreadId);
          }
          return {
            threadId: input.threadId,
            text: finalState.text ?? "",
            reasoning: finalState.reasoning || undefined,
            citations: finalState.perceivedCitations,
            interrupt: interruptResult ?? finalState.interrupt,
            runSteps: input.sink?.getSteps()
          };
        }

        const finalState = (await graph.invoke(initialState, config)) as PlanningGraphState & {
          __interrupt__?: Array<{ value?: unknown }>;
        };
        const interruptResult = extractInterruptFromState(finalState);
        if (interruptResult ?? finalState.interrupt) {
          await checkpointer.ensureInterruptCheckpointDurable(checkpointThreadId);
        }
        const llmMessages =
          finalState.messages?.length > 0 ? finalState.messages : buildPlanningLlmMessages(input, tools);
        return {
          threadId: input.threadId,
          text: finalState.text ?? "",
          reasoning: finalState.reasoning || undefined,
          citations: finalState.perceivedCitations,
          promptDebug: buildPromptDebug(llmMessages),
          interrupt: interruptResult ?? finalState.interrupt,
          runSteps: input.sink?.getSteps()
        };
      } catch (error) {
        if (isGraphInterrupt(error)) {
          const value = error.interrupts?.[0]?.value as
            | { toolCallId?: string; toolName?: string; payload?: Record<string, unknown>; citations?: AgentToolResult["citations"] }
            | undefined;
          if (value?.toolName && value.payload) {
            await checkpointer.ensureInterruptCheckpointDurable(checkpointThreadId);
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
                toolCallId: value.toolCallId,
                toolName: value.toolName,
                payload: value.payload,
                citations: value.citations ?? []
              },
              runSteps: input.sink?.getSteps()
            };
          }
        }
        throw error;
      }
    }
  };
}
