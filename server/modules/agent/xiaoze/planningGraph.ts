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
};

export type PlanningApprovalBridge = {
  resume(input: ApprovalBridgeResumeInput): Promise<ApprovalBridgeResumeResult>;
};

const SYSTEM_PROMPT = [
  "You are Xiaoze (小泽), WiseEff's perception and action assistant.",
  "Use only the provided WiseEff tools to ground answers and proposed actions.",
  "Never claim a write occurred unless an approved mutating tool executed successfully.",
  "Cite sources from tool results when summarizing.",
  "If a tool returns FORBIDDEN or access is denied, answer that the user is not permitted and do not reveal protected data."
].join(" ");

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
    reducer: (left, update) => [...left, ...(update ?? [])],
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
  interrupt: Annotation<PerceptionAgentRunResult["interrupt"]>({
    reducer: (_, update) => update,
    default: () => undefined
  }),
  pendingMutatingCall: Annotation<PerceptionModelToolCall | undefined>({
    reducer: (_, update) => update,
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

function buildInitialMessages(input: PlanningAgentRunInput): unknown[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
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

  function intentNode(state: PlanningGraphState): Partial<PlanningGraphState> {
    if (state.messages.length > 0) {
      return {};
    }
    return {
      planSteps: ["Understand user intent", "Perceive relevant data", "Plan and act with approval"],
      step: 0,
      turnCount: 0
    };
  }

  async function perceiveNode(state: PlanningGraphState): Promise<Partial<PlanningGraphState>> {
    if (state.halted || state.text) {
      return {};
    }
    if (state.turnCount >= MAX_TURNS) {
      return { text: "I could not complete the request within the allowed tool turns." };
    }

    const response = await options.model.invoke(state.messages);
    if (!response.toolCalls?.length) {
      return { text: response.content ?? "", step: state.step + 1 };
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
      try {
        const result = await options.runTool(call.name, payload);
        citations.push(...result.citations);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ summary: result.summary, data: result.data, citations: result.citations })
        });
      } catch (error) {
        if (isForbiddenError(error)) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: "FORBIDDEN", message: "You are not permitted to access this data." })
          });
        } else {
          throw error;
        }
      }
    }

    if (pendingMutating) {
      return {
        messages,
        perceivedCitations: citations,
        pendingMutatingCall: pendingMutating,
        turnCount: state.turnCount + 1
      };
    }

    return {
      messages,
      perceivedCitations: citations,
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
    const response = await options.model.invoke(state.messages);
    if (response.content) {
      return { text: response.content, step: state.step + 1 };
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

      await checkpointer.put(input.threadId, {
        planSteps: ["Understand user intent", "Perceive relevant data", "Plan and act with approval"],
        step: 0
      });

      const initialState: Partial<PlanningGraphState> = {
        messages: buildInitialMessages(input),
        context: input.context,
        perceivedCitations: [],
        turnCount: 0,
        step: 0,
        halted: false
      };

      try {
        if (input.resume) {
          const finalState = (await graph.invoke(new Command({ resume: input.resume }), config)) as PlanningGraphState & {
            __interrupt__?: Array<{ value?: unknown }>;
          };
          const interruptResult = extractInterruptFromState(finalState);
          return {
            threadId: input.threadId,
            text: finalState.text ?? "",
            citations: finalState.perceivedCitations,
            interrupt: interruptResult ?? finalState.interrupt
          };
        }

        const finalState = (await graph.invoke(initialState, config)) as PlanningGraphState & {
          __interrupt__?: Array<{ value?: unknown }>;
        };
        const interruptResult = extractInterruptFromState(finalState);
        return {
          threadId: input.threadId,
          text: finalState.text ?? "",
          citations: finalState.perceivedCitations,
          interrupt: interruptResult ?? finalState.interrupt
        };
      } catch (error) {
        if (isGraphInterrupt(error)) {
          const value = error.interrupts?.[0]?.value as
            | { toolName?: string; payload?: Record<string, unknown>; citations?: AgentToolResult["citations"] }
            | undefined;
          if (value?.toolName && value.payload) {
            return {
              threadId: input.threadId,
              text: "",
              citations: value.citations ?? [],
              interrupt: {
                toolName: value.toolName,
                payload: value.payload,
                citations: value.citations ?? []
              }
            };
          }
        }
        throw error;
      }
    }
  };
}

export function fakeModelSequence(responses: Array<{ toolCalls?: PerceptionModelToolCall[]; content?: string }>): PerceptionChatModel {
  let index = 0;
  return {
    async invoke() {
      const response = responses[index] ?? responses.at(-1)!;
      index += 1;
      return response;
    }
  };
}

export function toolCall(name: string, args: Record<string, unknown>): PerceptionModelToolCall {
  return { id: `tc-${name}`, name, args };
}
