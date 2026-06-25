import { randomUUID } from "node:crypto";
import { EventType } from "@ag-ui/core";
import type { AuthContext } from "../../auth/types";
import { ApiError } from "../../../shared/http/errors";
import type { RouteRequest, RouteResponse, WiseEffRouter } from "../../../shared/http/router";
import type { Database } from "../../../shared/database/client";
import type { ServerEnv } from "../../../config/env";
import { createAgentToolRegistry } from "../toolRegistry";
import type { AgentToolExecutionContext } from "../toolRegistry";
import type { AgentToolName, AgentCitation } from "../types";
import { createOrchestratorApprovalBridge, type ApprovalBridgeBeginResult } from "./approvalBridge";
import { createXiaozeCheckpointer } from "./checkpointer";
import { type PersistXiaozeTurnInput, createXiaozeTurnPersister } from "./threadPersistence";
import { registerXiaozeThreadRoutes } from "./threadRoutes";
import { type PerceptionAgentRunResult, type PerceptionToolDescriptor, wrapLangChainChatModel } from "./perceptionAgent";
import { createPlanningAgent } from "./planningGraph";
import { runXiaozeSuggest, type XiaozeSuggestContext } from "./suggest";
import { splitAssistantContent } from "./splitAssistantContent";
import {
  createReasoningMessageId,
  reasoningEndEvent,
  reasoningStartEvent,
  yieldReasoningTurn,
  type AgUiStreamEvent
} from "./streamAssistantReply";
import { buildXiaozePlanningToolDescriptors, toOpenAiToolDefinitions } from "./toolCatalog";
import { XIAOZE_PROMPT_DEBUG_EVENT } from "./promptDebug";
import { createRunEventSink, type RunEventSink } from "./runEventSink";
import {
  assistantShellStartEvent,
  mapSinkEventToAgUi,
  runStartedEvent,
  runTimingEvent,
  serializeTurnSteps,
  type RunTimelineContext
} from "./runTimelineEvents";
import { ChatOpenAI } from "@langchain/openai";

export type XiaozeAgUiRequest = Pick<RouteRequest, "headers" | "body" | "requestId">;

export type XiaozePerceptionAgent = {
  run(input: {
    message: string;
    context: { projectId?: string; pageKey?: string };
    threadId: string;
    includePromptDebug?: boolean;
    sink?: RunEventSink;
    resume?: {
      auth: AuthContext;
      requestId: string;
      approvalId: string;
      decision: "approve" | "reject";
      editedArgs?: Record<string, unknown>;
      reason?: string;
    };
  }): Promise<PerceptionAgentRunResult>;
};

function* maybeYieldReasoningEnd(
  event: { type: string },
  flags: { streamedReasoning: boolean; reasoningEnded: boolean },
  reasoningMessageId: string
) {
  if (flags.reasoningEnded || !flags.streamedReasoning || event.type !== "answer_delta") {
    return;
  }
  flags.reasoningEnded = true;
  yield reasoningEndEvent(reasoningMessageId);
}

async function* yieldMappedSinkEvents(
  sink: RunEventSink,
  context: RunTimelineContext,
  flags: { streamedReasoning: boolean; streamedAnswer: boolean; assistantShellStarted: boolean; reasoningEnded: boolean }
) {
  const events = await sink.drain();
  for (const event of events) {
    if (event.type === "reasoning_delta") {
      flags.streamedReasoning = true;
    }
    yield* maybeYieldReasoningEnd(event, flags, context.reasoningMessageId);
    if (
      (event.type === "tool_call" ||
        (event.type === "answer_delta" && (flags.reasoningEnded || !flags.streamedReasoning))) &&
      !flags.assistantShellStarted
    ) {
      flags.assistantShellStarted = true;
      yield assistantShellStartEvent(context.assistantMessageId);
    }
    if (event.type === "answer_delta") {
      flags.streamedAnswer = true;
    }
    for (const mapped of mapSinkEventToAgUi(event, context)) {
      yield mapped;
    }
  }
}

async function* pumpAgentRun(input: {
  sink: RunEventSink;
  context: RunTimelineContext;
  run: () => Promise<PerceptionAgentRunResult>;
  flags: { streamedReasoning: boolean; streamedAnswer: boolean; assistantShellStarted: boolean; reasoningEnded: boolean };
  outcome: { result?: PerceptionAgentRunResult; error?: unknown };
}) {
  let settled = false;

  void input
    .run()
    .then((value) => {
      input.outcome.result = value;
    })
    .catch((error) => {
      input.outcome.error = error;
    })
    .finally(() => {
      settled = true;
      input.sink.close();
    });

  while (true) {
    yield* yieldMappedSinkEvents(input.sink, input.context, input.flags);
    if (settled) {
      const leftover = await input.sink.drain(0);
      if (leftover.length > 0) {
        for (const event of leftover) {
          if (event.type === "reasoning_delta") {
            input.flags.streamedReasoning = true;
          }
          yield* maybeYieldReasoningEnd(event, input.flags, input.context.reasoningMessageId);
          if (
            (event.type === "tool_call" ||
              (event.type === "answer_delta" && (input.flags.reasoningEnded || !input.flags.streamedReasoning))) &&
            !input.flags.assistantShellStarted
          ) {
            input.flags.assistantShellStarted = true;
            yield assistantShellStartEvent(input.context.assistantMessageId);
          }
          if (event.type === "answer_delta") {
            input.flags.streamedAnswer = true;
          }
          for (const mapped of mapSinkEventToAgUi(event, input.context)) {
            yield mapped;
          }
        }
        continue;
      }
      break;
    }
  }
}

function buildAssistantReply(result: Pick<PerceptionAgentRunResult, "text" | "reasoning">) {
  const fallback = splitAssistantContent(result.text);
  const reasoning = result.reasoning?.trim() || fallback.reasoning || undefined;
  return {
    text: fallback.answer || result.text.trim(),
    reasoning
  };
}

function* finalizeTurnReply(input: {
  reply: { text: string; reasoning?: string };
  reasoningMessageId: string;
  messageId: string;
  flags: { streamedReasoning: boolean; streamedAnswer: boolean; assistantShellStarted: boolean; reasoningEnded: boolean };
}) {
  if (input.reply.reasoning && !input.flags.streamedReasoning) {
    yield* yieldReasoningTurn({ reasoningMessageId: input.reasoningMessageId, reasoning: input.reply.reasoning });
  } else if (!input.flags.reasoningEnded) {
    yield reasoningEndEvent(input.reasoningMessageId);
  }

  if (input.reply.text && !input.flags.streamedAnswer) {
    if (!input.flags.assistantShellStarted) {
      yield assistantShellStartEvent(input.messageId);
      input.flags.assistantShellStarted = true;
    }
    yield {
      event: EventType.TEXT_MESSAGE_CONTENT,
      data: { type: EventType.TEXT_MESSAGE_CONTENT, messageId: input.messageId, delta: input.reply.text }
    };
  }
  if (input.reply.text || input.flags.streamedAnswer) {
    yield {
      event: EventType.TEXT_MESSAGE_END,
      data: { type: EventType.TEXT_MESSAGE_END, messageId: input.messageId }
    };
  }
}

type ResumeDecision = {
  approvalId: string;
  decision: "approve" | "reject";
  editedArgs?: Record<string, unknown>;
  reason?: string;
};

const XIAOZE_INTERRUPT_EVENT = "on_interrupt";

function readBearerUserId(headers: RouteRequest["headers"]) {
  const header = headers.authorization ?? headers.Authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (!value?.startsWith("Bearer ")) {
    return undefined;
  }
  try {
    const payload = JSON.parse(Buffer.from(value.slice(7).split(".")[1] ?? "", "base64url").toString("utf8")) as {
      sub?: string;
    };
    return payload.sub;
  } catch {
    return undefined;
  }
}

function readLatestUserMessage(body: unknown) {
  const parsed = readLatestUserMessageEntry(body);
  return parsed?.content ?? "";
}

function readLatestUserMessageEntry(body: unknown): { id: string; content: string } | undefined {
  const input = body as { messages?: Array<{ id?: string; role?: string; content?: unknown }> };
  const messages = input.messages ?? [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") {
      const content = message.content;
      let text = "";
      if (typeof content === "string") {
        text = content;
      } else if (Array.isArray(content)) {
        text = content
          .map((part) => (typeof part === "object" && part && "text" in part ? String(part.text ?? "") : ""))
          .join("");
      }
      if (!text.trim()) {
        return undefined;
      }
      return {
        id: typeof message.id === "string" && message.id.trim() ? message.id : randomUUID(),
        content: text
      };
    }
  }
  return undefined;
}

function parseAgentContextEntryValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "object") {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function readAgentContextEntry(body: unknown, description: string) {
  const input = body as { context?: Array<{ description?: string; value?: unknown }> };
  for (const item of input.context ?? []) {
    if (item.description !== description) {
      continue;
    }
    const parsed = parseAgentContextEntryValue(item.value);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  }
  return undefined;
}

function readPageContext(body: unknown) {
  const value = readAgentContextEntry(body, "wiseeff.page");
  if (!value) {
    return {};
  }
  return value as { projectId?: string; pageKey?: string; path?: string };
}

function readPromptDebugRequest(body: unknown) {
  const value = readAgentContextEntry(body, "wiseeff.debug");
  return value?.promptDebug === true;
}

function readResumeDecision(body: unknown): ResumeDecision | undefined {
  const input = body as {
    resume?: Array<{ interruptId?: string; status?: string; payload?: unknown }>;
    forwardedProps?: { command?: { resume?: unknown; interruptEvent?: unknown } };
  };

  const command = input.forwardedProps?.command;
  if (command?.resume && typeof command.resume === "object") {
    const resume = command.resume as { decision?: string; editedArgs?: Record<string, unknown>; reason?: string };
    const interruptEvent = command.interruptEvent as { approvalId?: string } | undefined;
    const approvalId = interruptEvent?.approvalId;
    if (approvalId && (resume.decision === "approve" || resume.decision === "reject")) {
      return {
        approvalId,
        decision: resume.decision,
        editedArgs: resume.editedArgs,
        reason: resume.reason
      };
    }
  }

  const entry = input.resume?.[0];
  if (entry?.payload && typeof entry.payload === "object") {
    const payload = entry.payload as {
      approvalId?: string;
      decision?: "approve" | "reject";
      editedArgs?: Record<string, unknown>;
      reason?: string;
    };
    if (payload.approvalId && payload.decision) {
      return {
        approvalId: payload.approvalId,
        decision: payload.decision,
        editedArgs: payload.editedArgs,
        reason: payload.reason
      };
    }
  }

  return undefined;
}

function buildInterruptValue(interrupt: ApprovalBridgeBeginResult) {
  return {
    approvalId: interrupt.approvalId,
    toolCallId: interrupt.toolCallId,
    toolName: interrupt.toolName,
    payload: interrupt.payload,
    citations: interrupt.citations
  };
}

function resolveXiaozeModel(env: Pick<ServerEnv, "AGENT_MODEL" | "XIAOZE_MODEL">) {
  return env.XIAOZE_MODEL?.trim() || env.AGENT_MODEL?.trim() || "gpt-4o-mini";
}

function createProductionModel(
  env: Pick<ServerEnv, "AGENT_API_BASE_URL" | "AGENT_API_KEY" | "AGENT_MODEL" | "XIAOZE_MODEL">,
  tools: PerceptionToolDescriptor[]
) {
  const chat = new ChatOpenAI({
    model: resolveXiaozeModel(env),
    apiKey: env.AGENT_API_KEY,
    configuration: {
      baseURL: env.AGENT_API_BASE_URL
    },
    modelKwargs: {
      extra_body: {
        reasoning_split: true
      }
    }
  });
  const bound = tools.length > 0 ? chat.bindTools(toOpenAiToolDefinitions(tools)) : chat;
  return wrapLangChainChatModel(bound);
}

export function createXiaozeAgUiHandler(options: {
  resolveAuth: (request: XiaozeAgUiRequest) => Promise<AuthContext | undefined>;
  createAgent: (context: AgentToolExecutionContext) => XiaozePerceptionAgent;
  approvalBridge?: ReturnType<typeof createOrchestratorApprovalBridge>;
  allowPromptDebug?: boolean;
  resolveModelLabel?: () => string | undefined;
  persistTurn?: (input: PersistXiaozeTurnInput) => Promise<void>;
}) {
  return async function handleXiaozeAgUi(request: XiaozeAgUiRequest): Promise<RouteResponse> {
    const auth = await options.resolveAuth(request);
    if (!auth) {
      throw new ApiError("UNAUTHENTICATED", "Authentication is required for Xiaoze.", 401);
    }
    const verifiedAuth = auth;

    const threadId =
      typeof (request.body as { threadId?: unknown }).threadId === "string"
        ? String((request.body as { threadId: string }).threadId)
        : randomUUID();
    const runId =
      typeof (request.body as { runId?: unknown }).runId === "string"
        ? String((request.body as { runId: string }).runId)
        : randomUUID();
    const pageContext = readPageContext(request.body);
    const message = readLatestUserMessage(request.body);
    const userMessageEntry = readLatestUserMessageEntry(request.body);
    const resumeDecision = readResumeDecision(request.body);
    const includePromptDebug = (options.allowPromptDebug ?? process.env.NODE_ENV !== "production") && readPromptDebugRequest(request.body);
    const executionContext: AgentToolExecutionContext = {
      auth: verifiedAuth,
      requestId: request.requestId,
      sessionId: threadId,
      projectId: pageContext.projectId
    };
    const agent = options.createAgent(executionContext);
    const approvalBridge = options.approvalBridge;

    async function persistSuccessfulTurn(persistInput: {
      userMessage?: { id: string; content: string };
      assistantMessage?: {
        id: string;
        content: string;
        citations?: AgentCitation[];
        runSteps?: ReturnType<typeof serializeTurnSteps>;
      };
      reasoningMessage?: { id: string; content: string };
    }) {
      if (!options.persistTurn) {
        return;
      }
      await options.persistTurn({
        auth: verifiedAuth,
        requestId: request.requestId,
        threadId,
        runId,
        pageContext,
        userMessage: persistInput.userMessage,
        assistantMessage: persistInput.assistantMessage,
        reasoningMessage: persistInput.reasoningMessage
      });
    }

    async function* streamEvents(): AsyncIterable<AgUiStreamEvent> {
      const runStartedAtMs = Date.now();
      const messageId = randomUUID();
      const reasoningMessageId = createReasoningMessageId();
      const timelineContext: RunTimelineContext = {
        threadId,
        runId,
        assistantMessageId: messageId,
        reasoningMessageId,
        runStartedAtMs
      };

      yield runStartedEvent({ threadId, runId, runStartedAtMs });
      yield reasoningStartEvent(reasoningMessageId);

      try {
        if (resumeDecision && approvalBridge) {
          try {
            const resumed = await agent.run({
              message: "",
              context: {
                projectId: pageContext.projectId,
                pageKey: pageContext.pageKey
              },
              threadId,
              resume: {
                auth: verifiedAuth,
                requestId: request.requestId,
                approvalId: resumeDecision.approvalId,
                decision: resumeDecision.decision,
                editedArgs: resumeDecision.editedArgs,
                reason: resumeDecision.reason
              }
            });
            const reply = buildAssistantReply(resumed);
            yield* yieldReasoningTurn({ reasoningMessageId, reasoning: reply.reasoning });
            if (reply.text) {
              yield {
                event: EventType.TEXT_MESSAGE_CONTENT,
                data: { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: reply.text }
              };
              yield {
                event: EventType.TEXT_MESSAGE_END,
                data: { type: EventType.TEXT_MESSAGE_END, messageId }
              };
            }
            await persistSuccessfulTurn({
              assistantMessage: reply.text
                ? {
                    id: messageId,
                    content: reply.text,
                    citations: resumed.citations,
                    runSteps: resumed.runSteps ? serializeTurnSteps(resumed.runSteps) : undefined
                  }
                : undefined,
              reasoningMessage: reply.reasoning ? { id: reasoningMessageId, content: reply.reasoning } : undefined
            });
            const durationMs = Math.max(0, Date.now() - runStartedAtMs);
            yield runTimingEvent({
              runId,
              reasoningMessageId,
              startedAt: runStartedAtMs,
              durationMs,
              phase: "finished"
            });
            yield {
              event: EventType.RUN_FINISHED,
              data: { type: EventType.RUN_FINISHED, threadId, runId, outcome: { type: "success" } }
            };
          } catch (error) {
            if (error instanceof ApiError && error.code === "FORBIDDEN") {
              const safeMessage = "You are not permitted to perform that action.";
              yield reasoningEndEvent(reasoningMessageId);
              yield {
                event: EventType.TEXT_MESSAGE_CONTENT,
                data: { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: safeMessage }
              };
              yield {
                event: EventType.TEXT_MESSAGE_END,
                data: { type: EventType.TEXT_MESSAGE_END, messageId }
              };
              await persistSuccessfulTurn({
                assistantMessage: { id: messageId, content: safeMessage }
              });
              yield runTimingEvent({
                runId,
                reasoningMessageId,
                startedAt: runStartedAtMs,
                durationMs: Math.max(0, Date.now() - runStartedAtMs),
                phase: "finished"
              });
              yield {
                event: EventType.RUN_FINISHED,
                data: { type: EventType.RUN_FINISHED, threadId, runId, outcome: { type: "success" } }
              };
            } else {
              throw error;
            }
          }
          return;
        }

        const sink = createRunEventSink();
        const streamFlags = {
          streamedReasoning: false,
          streamedAnswer: false,
          assistantShellStarted: false,
          reasoningEnded: false
        };
        const outcome: { result?: PerceptionAgentRunResult; error?: unknown } = {};
        yield* pumpAgentRun({
          sink,
          context: timelineContext,
          flags: streamFlags,
          outcome,
          run: () =>
            agent.run({
              message,
              context: {
                projectId: pageContext.projectId,
                pageKey: pageContext.pageKey
              },
              threadId,
              includePromptDebug,
              sink
            })
        });

        if (outcome.error) {
          throw outcome.error;
        }
        const result = outcome.result!;

        if (result.interrupt && approvalBridge) {
          yield reasoningEndEvent(reasoningMessageId);
          const interrupt = await approvalBridge.begin({
            auth: verifiedAuth,
            requestId: request.requestId,
            sessionId: threadId,
            toolName: result.interrupt.toolName as AgentToolName,
            payload: result.interrupt.payload,
            citations: result.interrupt.citations,
            pageKey: pageContext.pageKey,
            projectId: pageContext.projectId
          });
          const interruptValue = buildInterruptValue(interrupt);
          const frontendToolCallId = randomUUID();

          yield {
            event: EventType.TOOL_CALL_START,
            data: {
              type: EventType.TOOL_CALL_START,
              toolCallId: frontendToolCallId,
              toolCallName: "xiaoze_approval",
              parentMessageId: messageId
            }
          };
          yield {
            event: EventType.TOOL_CALL_ARGS,
            data: {
              type: EventType.TOOL_CALL_ARGS,
              toolCallId: frontendToolCallId,
              delta: JSON.stringify(interruptValue)
            }
          };
          yield {
            event: EventType.TOOL_CALL_END,
            data: { type: EventType.TOOL_CALL_END, toolCallId: frontendToolCallId }
          };
          yield {
            event: EventType.CUSTOM,
            data: { type: EventType.CUSTOM, name: XIAOZE_INTERRUPT_EVENT, value: interruptValue }
          };
          yield runTimingEvent({
            runId,
            reasoningMessageId,
            startedAt: runStartedAtMs,
            durationMs: Math.max(0, Date.now() - runStartedAtMs),
            phase: "finished"
          });
          yield {
            event: EventType.RUN_FINISHED,
            data: {
              type: EventType.RUN_FINISHED,
              threadId,
              runId,
              outcome: {
                type: "interrupt",
                interrupts: [
                  {
                    id: interrupt.approvalId,
                    reason: "tool_call",
                    toolCallId: frontendToolCallId,
                    message: "Approval is required before executing this action.",
                    metadata: interruptValue
                  }
                ]
              }
            }
          };
          if (userMessageEntry) {
            await persistSuccessfulTurn({ userMessage: userMessageEntry });
          }
          return;
        }

        const reply = buildAssistantReply(result);
        if (result.promptDebug) {
          const modelLabel = options.resolveModelLabel?.();
          yield {
            event: EventType.CUSTOM,
            data: {
              type: EventType.CUSTOM,
              name: XIAOZE_PROMPT_DEBUG_EVENT,
              value: {
                runId,
                messageId,
                snapshot: modelLabel ? { ...result.promptDebug, model: modelLabel } : result.promptDebug
              }
            }
          };
        }
        yield* finalizeTurnReply({
          reply,
          reasoningMessageId,
          messageId,
          flags: streamFlags
        });
        const runSteps = result.runSteps ? serializeTurnSteps(result.runSteps) : undefined;
        await persistSuccessfulTurn({
          userMessage: userMessageEntry,
          assistantMessage: reply.text
            ? { id: messageId, content: reply.text, citations: result.citations, runSteps }
            : undefined,
          reasoningMessage: reply.reasoning ? { id: reasoningMessageId, content: reply.reasoning } : undefined
        });
        yield runTimingEvent({
          runId,
          reasoningMessageId,
          startedAt: runStartedAtMs,
          durationMs: Math.max(0, Date.now() - runStartedAtMs),
          phase: "finished"
        });
        yield {
          event: EventType.RUN_FINISHED,
          data: { type: EventType.RUN_FINISHED, threadId, runId, outcome: { type: "success" } }
        };
      } catch (error) {
        if (error instanceof ApiError && error.code === "FORBIDDEN") {
          const safeMessage = "You are not permitted to perform that action.";
          yield reasoningEndEvent(reasoningMessageId);
          yield {
            event: EventType.TEXT_MESSAGE_CONTENT,
            data: { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: safeMessage }
          };
          yield {
            event: EventType.TEXT_MESSAGE_END,
            data: { type: EventType.TEXT_MESSAGE_END, messageId }
          };
          await persistSuccessfulTurn({
            userMessage: userMessageEntry,
            assistantMessage: { id: messageId, content: safeMessage }
          });
          yield runTimingEvent({
            runId,
            reasoningMessageId,
            startedAt: runStartedAtMs,
            durationMs: Math.max(0, Date.now() - runStartedAtMs),
            phase: "finished"
          });
          yield {
            event: EventType.RUN_FINISHED,
            data: { type: EventType.RUN_FINISHED, threadId, runId, outcome: { type: "success" } }
          };
          return;
        }

        yield reasoningEndEvent(reasoningMessageId);
        yield runTimingEvent({
          runId,
          reasoningMessageId,
          startedAt: runStartedAtMs,
          durationMs: Math.max(0, Date.now() - runStartedAtMs),
          phase: "error"
        });
        yield {
          event: EventType.RUN_ERROR,
          data: {
            type: EventType.RUN_ERROR,
            message: error instanceof Error ? error.message : "Xiaoze run failed."
          }
        };
      }
    }

    return { status: 200, sse: streamEvents() };
  };
}

export function createDeterministicPerceptionModel(): import("./perceptionAgent").PerceptionChatModel {
  return {
    async invoke(messages) {
      const userMessage = messages.find(
        (message) => typeof message === "object" && message && "role" in message && (message as { role: string }).role === "user"
      ) as { content?: string } | undefined;
      const text = userMessage?.content ?? "";
      const hasToolResult = messages.some(
        (message) => typeof message === "object" && message && "role" in message && (message as { role: string }).role === "tool"
      );
      if (!hasToolResult) {
        const forbidden = /secret|forbidden|denied|越权|无权限/i.test(text);
        if (forbidden) {
          return {
            toolCalls: [{ id: "tc-forbidden", name: "perception.getProjectOverview", args: { projectId: "secret-project" } }]
          };
        }
        const changeMatch = text.match(/(?:set|change)\s+([a-z0-9-]+)\s+(?:to|=)\s+(\S+)/i);
        if (changeMatch) {
          return {
            toolCalls: [
              {
                id: "tc-action",
                name: "action.submitParameterChange",
                args: {
                  projectId: "aurora",
                  parameterId: changeMatch[1],
                  targetValue: changeMatch[2],
                  reason: "Xiaoze action request"
                }
              }
            ]
          };
        }
        const projectMatch = text.match(/project\s+([a-z0-9-]+)/i);
        const projectId = projectMatch?.[1] ?? "aurora";
        return {
          toolCalls: [{ id: "tc-overview", name: "perception.getProjectOverview", args: { projectId } }]
        };
      }
      const toolMessage = messages.find(
        (message) => typeof message === "object" && message && "role" in message && (message as { role: string }).role === "tool"
      ) as { content?: string } | undefined;
      const payload = toolMessage?.content ? JSON.parse(toolMessage.content) : {};
      if (payload.error === "FORBIDDEN") {
        return { content: "You are not permitted to access that project. I cannot share its data." };
      }
      return { content: `${payload.summary ?? "Grounded summary."} [citation:parameter]` };
    }
  };
}

export function createXiaozeAgentFactory(options: {
  db: Database;
  env: Pick<ServerEnv, "AGENT_API_BASE_URL" | "AGENT_API_KEY" | "AGENT_MODEL" | "XIAOZE_MODEL" | "XIAOZE_DETERMINISTIC">;
  modelFactory?: typeof createProductionModel;
  checkpointer?: ReturnType<typeof createXiaozeCheckpointer>;
  approvalBridge?: ReturnType<typeof createOrchestratorApprovalBridge>;
}) {
  const registry = createAgentToolRegistry({ db: options.db });
  const perceptionTools = registry.list().filter((tool) => tool.name.startsWith("perception."));
  const actionTools = registry.list().filter((tool) => tool.name.startsWith("action."));
  const planningToolDescriptors = buildXiaozePlanningToolDescriptors([...perceptionTools, ...actionTools]);
  const modelFactory = options.modelFactory ?? createProductionModel;
  const checkpointer = options.checkpointer ?? createXiaozeCheckpointer();
  const approvalBridge = options.approvalBridge ?? createOrchestratorApprovalBridge({ db: options.db, toolRegistry: registry });
  const executionContextRef: { current: AgentToolExecutionContext | null } = { current: null };
  const planningAgent = createPlanningAgent({
    model: options.env.XIAOZE_DETERMINISTIC
      ? createDeterministicPerceptionModel()
      : modelFactory(options.env, planningToolDescriptors),
    runTool: (name, payload) => {
      if (!executionContextRef.current) {
        throw new Error("Xiaoze execution context is not bound for this request.");
      }
      return registry.run(name as never, executionContextRef.current, payload);
    },
    listTools: () => planningToolDescriptors,
    checkpointer,
    approvalBridge
  });

  return (executionContext: AgentToolExecutionContext): XiaozePerceptionAgent => {
    executionContextRef.current = executionContext;
    return {
      async run(input) {
        const result = await planningAgent.run({
          ...input,
          threadId: input.threadId
        });
        return {
          text: result.text,
          reasoning: result.reasoning,
          citations: result.citations,
          promptDebug: result.promptDebug,
          interrupt: result.interrupt,
          runSteps: result.runSteps
        };
      }
    };
  };
}

export function registerXiaozeRoutes(
  router: WiseEffRouter,
  options: {
    db?: Database;
    env?: Pick<
      ServerEnv,
      "XIAOZE_RUNTIME_ENABLED" | "XIAOZE_DETERMINISTIC" | "XIAOZE_PROACTIVE_ENABLED" | "AGENT_API_BASE_URL" | "AGENT_API_KEY" | "AGENT_MODEL" | "XIAOZE_MODEL"
    >;
    getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext;
    createAgent?: (context: AgentToolExecutionContext) => XiaozePerceptionAgent;
    approvalBridge?: ReturnType<typeof createOrchestratorApprovalBridge>;
  }
) {
  if (!options.env?.XIAOZE_RUNTIME_ENABLED || !options.db) {
    return;
  }

  registerXiaozeThreadRoutes(router, {
    db: options.db,
    getCurrentAuthContext: options.getCurrentAuthContext
  });

  const createAgent =
    options.createAgent ??
    createXiaozeAgentFactory({
      db: options.db,
      env: options.env
    });
  const approvalBridge = options.approvalBridge ?? createOrchestratorApprovalBridge({ db: options.db });
  const persistTurn = createXiaozeTurnPersister({ db: options.db });

  const handler = createXiaozeAgUiHandler({
    resolveAuth: async (request) => {
      try {
        return await options.getCurrentAuthContext(request as RouteRequest);
      } catch (error) {
        if (error instanceof ApiError && error.code === "UNAUTHENTICATED") {
          return undefined;
        }
        throw error;
      }
    },
    createAgent,
    approvalBridge,
    persistTurn,
    resolveModelLabel: options.env ? () => resolveXiaozeModel(options.env!) : undefined
  });

  router.post("/api/v1/agent/xiaoze", async (request) => handler(request));

  const registry = createAgentToolRegistry({ db: options.db });
  router.post("/api/v1/agent/xiaoze/suggest", async (request) => {
    if (!options.env?.XIAOZE_PROACTIVE_ENABLED) {
      return { status: 200, body: { suggestions: [] } };
    }

    let auth: AuthContext;
    try {
      auth = await options.getCurrentAuthContext(request);
    } catch (error) {
      if (error instanceof ApiError && error.code === "UNAUTHENTICATED") {
        throw new ApiError("UNAUTHENTICATED", "Authentication is required for Xiaoze suggestions.", 401);
      }
      throw error;
    }

    const body = request.body as { context?: XiaozeSuggestContext };
    const context = body.context ?? {};
    const executionContext: AgentToolExecutionContext = {
      auth,
      requestId: request.requestId,
      sessionId: `suggest-${request.requestId}`,
      projectId: context.projectId
    };

    const result = await runXiaozeSuggest({
      context,
      runTool: (name, payload) => registry.run(name as never, executionContext, payload),
      listReadTools: () => registry.list().filter((tool) => tool.name.startsWith("perception.")).map((tool) => tool.name)
    });

    return { status: 200, body: result };
  });
}

export { readBearerUserId };
