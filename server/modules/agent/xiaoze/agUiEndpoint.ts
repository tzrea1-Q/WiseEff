import { randomUUID } from "node:crypto";
import type { AuthContext } from "../../auth/types";
import { ApiError } from "../../../shared/http/errors";
import type { RouteRequest, RouteResponse, WiseEffRouter } from "../../../shared/http/router";
import type { Database } from "../../../shared/database/client";
import type { KnowledgeEmbeddingClient } from "../../knowledge/indexing/embeddingClient";
import type { ObjectStore } from "../../logs/objectStore";
import type { ServerEnv } from "../../../config/env";
import { getAgentSession } from "../repository";
import { createAgentToolRegistry } from "../toolRegistry";
import type { AgentToolExecutionContext } from "../toolRegistry";
import type { AgentToolName, AgentCitation } from "../types";
import { createAgentOrchestrator, type AgentOrchestrator, type ApprovalBeginResult } from "../orchestrator";
import { createXiaozeCheckpointer, resolveXiaozeCheckpointerFromEnv } from "./checkpointer";
import { type PersistXiaozeTurnInput, createXiaozeTurnPersister } from "./threadPersistence";
import { registerXiaozeThreadRoutes } from "./threadRoutes";
import { type PerceptionAgentRunResult, type PerceptionToolDescriptor, wrapLangChainChatModel } from "./perceptionAgent";
import { createPlanningAgent, type PlanningApprovalResolver } from "./planningGraph";
import { runXiaozeSuggest, type XiaozeSuggestContext } from "./suggest";
import { buildXiaozePlanningToolDescriptors, toOpenAiToolDefinitions } from "./toolCatalog";
import { isXiaozeDeterministicMode } from "./runtimeMode";
import { createRunEventSink, serializeTurnSteps, type RunEventSink } from "./runEventSink";
import {
  createReasoningMessageId,
  createXiaozeTurnStream,
  type AgUiStreamEvent,
  type XiaozeTurnStream
} from "./xiaozeTurnStream";
import { ChatOpenAI } from "@langchain/openai";

export type XiaozeAgUiRequest = Pick<RouteRequest, "headers" | "body" | "requestId">;

export type XiaozeApprovalChain = Pick<AgentOrchestrator, "beginApproval">;

export type XiaozePerceptionAgent = {
  run(input: {
    message: string;
    context: { projectId?: string; pageKey?: string };
    threadId: string;
    includePromptDebug?: boolean;
    sink?: RunEventSink;
    resume?: {
      approvalId: string;
      decision: "approve" | "reject";
      editedArgs?: Record<string, unknown>;
      reason?: string;
    };
  }): Promise<PerceptionAgentRunResult>;
};

async function* pumpAgentRun(input: {
  sink: RunEventSink;
  stream: XiaozeTurnStream;
  run: () => Promise<PerceptionAgentRunResult>;
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
    for (const event of await input.sink.drain()) {
      yield* input.stream.ingest(event);
    }
    if (settled) {
      const leftover = await input.sink.drain(0);
      if (leftover.length > 0) {
        for (const event of leftover) {
          input.sink.push(event);
        }
        continue;
      }
      break;
    }
  }
}

type ResumeDecision = {
  approvalId: string;
  decision: "approve" | "reject";
  editedArgs?: Record<string, unknown>;
  reason?: string;
};

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

function resolveXiaozeModel(env: Pick<ServerEnv, "AGENT_MODEL" | "XIAOZE_MODEL">) {
  return env.XIAOZE_MODEL?.trim() || env.AGENT_MODEL?.trim() || "gpt-4o-mini";
}

function createProductionModel(
  env: Pick<
    ServerEnv,
    "AGENT_API_BASE_URL" | "AGENT_API_KEY" | "AGENT_MODEL" | "XIAOZE_MODEL" | "XIAOZE_REASONING_FALLBACK_HEURISTIC"
  >,
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
  return wrapLangChainChatModel(bound, {
    fallbackHeuristic: env.XIAOZE_REASONING_FALLBACK_HEURISTIC
  });
}

export function createXiaozeAgUiHandler(options: {
  resolveAuth: (request: XiaozeAgUiRequest) => Promise<AuthContext | undefined>;
  createAgent: (context: AgentToolExecutionContext) => XiaozePerceptionAgent;
  approvalChain?: XiaozeApprovalChain;
  allowPromptDebug?: boolean;
  resolveModelLabel?: () => string | undefined;
  persistTurn?: (input: PersistXiaozeTurnInput) => Promise<void>;
  /** Rejects runs whose client-supplied threadId addresses another user's thread. */
  assertThreadAccess?: (input: { auth: AuthContext; threadId: string }) => Promise<void>;
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
    if (options.assertThreadAccess) {
      await options.assertThreadAccess({ auth: verifiedAuth, threadId });
    }
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
    const approvalChain = options.approvalChain;
    const activeResume = approvalChain ? resumeDecision : undefined;

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
      const stream = createXiaozeTurnStream({
        threadId,
        runId,
        assistantMessageId: messageId,
        reasoningMessageId,
        runStartedAtMs
      });

      yield* stream.open();

      try {
        const sink = createRunEventSink();
        const outcome: { result?: PerceptionAgentRunResult; error?: unknown } = {};
        yield* pumpAgentRun({
          sink,
          stream,
          outcome,
          run: () =>
            agent.run({
              message: activeResume ? "" : message,
              context: {
                projectId: pageContext.projectId,
                pageKey: pageContext.pageKey
              },
              threadId,
              includePromptDebug,
              sink,
              ...(activeResume
                ? {
                    resume: {
                      approvalId: activeResume.approvalId,
                      decision: activeResume.decision,
                      editedArgs: activeResume.editedArgs,
                      reason: activeResume.reason
                    }
                  }
                : {})
            })
        });

        if (outcome.error) {
          throw outcome.error;
        }
        const result = outcome.result!;

        if (result.interrupt && approvalChain) {
          const interrupt = await approvalChain.beginApproval({
            auth: verifiedAuth,
            requestId: request.requestId,
            sessionId: threadId,
            toolName: result.interrupt.toolName as AgentToolName,
            payload: result.interrupt.payload,
            citations: result.interrupt.citations,
            pageKey: pageContext.pageKey,
            projectId: pageContext.projectId
          });
          yield* stream.interrupt(interrupt);
          if (!activeResume && userMessageEntry) {
            await persistSuccessfulTurn({ userMessage: userMessageEntry });
          }
          return;
        }

        const finalized = stream.finalize({
          text: result.text,
          reasoning: result.reasoning,
          citations: result.citations,
          runSteps: result.runSteps,
          promptDebug: result.promptDebug,
          promptDebugModel: options.resolveModelLabel?.()
        });
        yield* finalized.events;
        await persistSuccessfulTurn({
          userMessage: activeResume ? undefined : userMessageEntry,
          assistantMessage: finalized.reply.text
            ? {
                id: messageId,
                content: finalized.reply.text,
                citations: result.citations,
                runSteps: finalized.runSteps
              }
            : undefined,
          reasoningMessage: finalized.reply.reasoning
            ? { id: reasoningMessageId, content: finalized.reply.reasoning }
            : undefined
        });
        yield* stream.complete();
      } catch (error) {
        if (error instanceof ApiError && error.code === "FORBIDDEN") {
          const safeMessage = "You are not permitted to perform that action.";
          yield* stream.forbidden(safeMessage);
          await persistSuccessfulTurn({
            userMessage: activeResume ? undefined : userMessageEntry,
            assistantMessage: { id: messageId, content: safeMessage }
          });
          yield* stream.complete();
          return;
        }

        yield* stream.fail(error);
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
        // Deterministic distillation: `创建知识草稿:<标题>`(可选 `来源日志:<logId>`)
        // pins the approval-gated draft tool so acceptance can drive the interrupt.
        // Match a single line only: the planner appends page context on new lines.
        const draftMatch = text.match(/(?:创建知识草稿|create knowledge draft)[:：]\s*([^\n]+)/i);
        if (draftMatch) {
          const draftLine = draftMatch[1].trim();
          const sourceMatch = draftLine.match(/\s+(?:来源日志|source-log)[:：]\s*(\S+)\s*$/i);
          const title = sourceMatch ? draftLine.slice(0, sourceMatch.index).trim() : draftLine;
          return {
            toolCalls: [
              {
                id: "tc-knowledge-draft",
                name: "action.createKnowledgeDraft",
                args: {
                  title,
                  contentMarkdown: `## 结论\n\n${title}\n\n(由小泽在对话中沉淀,待人工审阅发布。)`,
                  tags: ["小泽沉淀"],
                  ...(sourceMatch ? { sourceLogId: sourceMatch[1] } : {})
                }
              }
            ]
          };
        }
        // Deterministic knowledge grounding: `知识库检索:<keywords>` pins the
        // query; any knowledge-base mention falls back to the full message.
        const knowledgeQueryMatch = text.match(/(?:知识库检索|knowledge search)[:：]\s*(.+)/i);
        if (knowledgeQueryMatch || /知识库|knowledge base/i.test(text)) {
          return {
            toolCalls: [
              {
                id: "tc-knowledge",
                name: "knowledge.search",
                args: { query: (knowledgeQueryMatch?.[1] ?? text).trim() }
              }
            ]
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
      const citationType =
        Array.isArray(payload.citations) && typeof payload.citations[0]?.type === "string"
          ? payload.citations[0].type
          : "parameter";
      return { content: `${payload.summary ?? "Grounded summary."} [citation:${citationType}]` };
    }
  };
}

export function createXiaozeAgentFactory(options: {
  db: Database;
  env: Pick<
    ServerEnv,
    | "AGENT_API_BASE_URL"
    | "AGENT_API_KEY"
    | "AGENT_MODEL"
    | "XIAOZE_MODEL"
    | "XIAOZE_CHECKPOINTER"
    | "XIAOZE_REASONING_FALLBACK_HEURISTIC"
    | "DATABASE_URL"
  >;
  modelFactory?: typeof createProductionModel;
  checkpointer?: ReturnType<typeof createXiaozeCheckpointer>;
  toolRegistry?: ReturnType<typeof createAgentToolRegistry>;
  objectStore?: ObjectStore;
  approvalResolver?: PlanningApprovalResolver;
}) {
  const registry =
    options.toolRegistry ?? createAgentToolRegistry({ db: options.db, objectStore: options.objectStore });
  // Read tools (perception + knowledge) bind before approval-gated action tools.
  const readTools = registry.list().filter((tool) => !tool.requiresApproval);
  const actionTools = registry.list().filter((tool) => tool.requiresApproval);
  const planningToolDescriptors = buildXiaozePlanningToolDescriptors([...readTools, ...actionTools]);
  const modelFactory = options.modelFactory ?? createProductionModel;
  const checkpointer = options.checkpointer ?? resolveXiaozeCheckpointerFromEnv(options.env);
  const approvalResolver =
    options.approvalResolver ?? createAgentOrchestrator({ db: options.db, toolRegistry: registry });
  const planningAgent = createPlanningAgent({
    model: isXiaozeDeterministicMode()
      ? createDeterministicPerceptionModel()
      : modelFactory(options.env, planningToolDescriptors),
    runTool: (name, payload, requestContext) => {
      if (!requestContext) {
        throw new Error("Xiaoze execution context is not bound for this request.");
      }
      return registry.run(name as never, requestContext, payload);
    },
    listTools: () => planningToolDescriptors,
    checkpointer,
    approvalResolver
  });

  return (executionContext: AgentToolExecutionContext): XiaozePerceptionAgent => ({
    async run(input) {
      const result = await planningAgent.run({
        ...input,
        threadId: input.threadId,
        requestContext: executionContext
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
  });
}

export function registerXiaozeRoutes(
  router: WiseEffRouter,
  options: {
    db?: Database;
    env?: Pick<
      ServerEnv,
      | "XIAOZE_PROACTIVE_ENABLED"
      | "XIAOZE_CHECKPOINTER"
      | "DATABASE_URL"
      | "AGENT_API_BASE_URL"
      | "AGENT_API_KEY"
      | "AGENT_MODEL"
      | "XIAOZE_MODEL"
      | "XIAOZE_REASONING_FALLBACK_HEURISTIC"
    >;
    getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext;
    createAgent?: (context: AgentToolExecutionContext) => XiaozePerceptionAgent;
    approvalChain?: XiaozeApprovalChain;
    objectStore?: ObjectStore;
    knowledgeEmbeddingClient?: KnowledgeEmbeddingClient;
  }
) {
  if (!options.db) {
    return;
  }

  registerXiaozeThreadRoutes(router, {
    db: options.db,
    getCurrentAuthContext: options.getCurrentAuthContext
  });

  const envDefaults = options.env ?? {
    XIAOZE_CHECKPOINTER: "memory",
    XIAOZE_REASONING_FALLBACK_HEURISTIC: false
  };
  const registry = createAgentToolRegistry({
    db: options.db,
    objectStore: options.objectStore,
    knowledgeEmbeddingClient: options.knowledgeEmbeddingClient
  });
  const orchestrator = createAgentOrchestrator({ db: options.db, toolRegistry: registry });
  const createAgent =
    options.createAgent ??
    createXiaozeAgentFactory({
      db: options.db,
      env: envDefaults,
      toolRegistry: registry,
      approvalResolver: orchestrator,
      ...(options.env
        ? {}
        : {
            modelFactory: (_env, _tools) => createDeterministicPerceptionModel()
          })
    });
  const approvalChain = options.approvalChain ?? orchestrator;
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
    approvalChain,
    persistTurn,
    resolveModelLabel: options.env ? () => resolveXiaozeModel(options.env!) : undefined,
    assertThreadAccess: async ({ auth, threadId }) => {
      const session = await getAgentSession(options.db!, auth.organization.id, threadId);
      if (session && session.actorUserId !== auth.user.id) {
        throw new ApiError("FORBIDDEN", "This Xiaoze thread belongs to another user.", 403, { threadId });
      }
    }
  });

  router.post("/api/v1/agent/xiaoze", async (request) => handler(request));

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
