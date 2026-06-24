import { randomUUID } from "node:crypto";
import { EventType } from "@ag-ui/core";
import type { AuthContext } from "../../auth/types";
import { ApiError } from "../../../shared/http/errors";
import type { RouteRequest, RouteResponse } from "../../../shared/http/router";
import type { Database } from "../../../shared/database/client";
import type { ServerEnv } from "../../../config/env";
import { createAgentToolRegistry } from "../toolRegistry";
import type { AgentToolExecutionContext } from "../toolRegistry";
import { createPerceptionAgent, type PerceptionAgentRunResult, wrapLangChainChatModel } from "./perceptionAgent";
import { ChatOpenAI } from "@langchain/openai";

export type XiaozeAgUiRequest = Pick<RouteRequest, "headers" | "body" | "requestId">;

export type XiaozePerceptionAgent = {
  run(input: { message: string; context: { projectId?: string; pageKey?: string } }): Promise<PerceptionAgentRunResult>;
};

type AgUiStreamEvent = { event: string; data: Record<string, unknown> };

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
  const input = body as { messages?: Array<{ role?: string; content?: unknown }> };
  const messages = input.messages ?? [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") {
      const content = message.content;
      if (typeof content === "string") {
        return content;
      }
      if (Array.isArray(content)) {
        return content
          .map((part) => (typeof part === "object" && part && "text" in part ? String(part.text ?? "") : ""))
          .join("");
      }
    }
  }
  return "";
}

function readPageContext(body: unknown) {
  const input = body as { context?: Array<{ description?: string; value?: unknown }> };
  for (const item of input.context ?? []) {
    if (item.description === "wiseeff.page" && item.value && typeof item.value === "object") {
      return item.value as { projectId?: string; pageKey?: string; path?: string };
    }
  }
  return {};
}

function createProductionModel(env: Pick<ServerEnv, "AGENT_API_BASE_URL" | "AGENT_API_KEY" | "AGENT_MODEL" | "XIAOZE_MODEL">) {
  const chat = new ChatOpenAI({
    model: env.XIAOZE_MODEL ?? env.AGENT_MODEL ?? "gpt-4o-mini",
    apiKey: env.AGENT_API_KEY,
    configuration: {
      baseURL: env.AGENT_API_BASE_URL
    }
  });
  return wrapLangChainChatModel(chat);
}

export function createXiaozeAgUiHandler(options: {
  resolveAuth: (request: XiaozeAgUiRequest) => Promise<AuthContext | undefined>;
  createAgent: (context: AgentToolExecutionContext) => XiaozePerceptionAgent;
}) {
  return async function handleXiaozeAgUi(request: XiaozeAgUiRequest): Promise<RouteResponse> {
    const auth = await options.resolveAuth(request);
    if (!auth) {
      throw new ApiError("UNAUTHENTICATED", "Authentication is required for Xiaoze.", 401);
    }

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
    const executionContext: AgentToolExecutionContext = {
      auth,
      requestId: request.requestId,
      sessionId: threadId,
      projectId: pageContext.projectId
    };
    const agent = options.createAgent(executionContext);

    async function* streamEvents(): AsyncIterable<AgUiStreamEvent> {
      yield {
        event: EventType.RUN_STARTED,
        data: { type: EventType.RUN_STARTED, threadId, runId }
      };

      const messageId = randomUUID();
      try {
        const result = await agent.run({
          message,
          context: {
            projectId: pageContext.projectId,
            pageKey: pageContext.pageKey
          }
        });

        yield {
          event: EventType.TEXT_MESSAGE_START,
          data: { type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" }
        };
        yield {
          event: EventType.TEXT_MESSAGE_CONTENT,
          data: { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: result.text }
        };
        yield {
          event: EventType.TEXT_MESSAGE_END,
          data: { type: EventType.TEXT_MESSAGE_END, messageId }
        };
        yield {
          event: EventType.RUN_FINISHED,
          data: { type: EventType.RUN_FINISHED, threadId, runId }
        };
      } catch (error) {
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
}) {
  const registry = createAgentToolRegistry({ db: options.db });
  const perceptionTools = registry.list().filter((tool) => tool.name.startsWith("perception."));
  const modelFactory = options.modelFactory ?? createProductionModel;

  return (executionContext: AgentToolExecutionContext): XiaozePerceptionAgent => {
    const model = options.env.XIAOZE_DETERMINISTIC ? createDeterministicPerceptionModel() : modelFactory(options.env);
    const agent = createPerceptionAgent({
      model,
      runTool: (name, payload) => registry.run(name as never, executionContext, payload),
      listTools: () =>
        perceptionTools.map((tool) => ({
          name: tool.name,
          description: tool.label,
          schema: { type: "object", properties: { projectId: { type: "string" } } }
        }))
    });
    return agent;
  };
}

export function registerXiaozeRoutes(
  router: { post: (path: string, handler: (request: RouteRequest) => Promise<RouteResponse>) => void },
  options: {
    db?: Database;
    env?: Pick<
      ServerEnv,
      "XIAOZE_RUNTIME_ENABLED" | "XIAOZE_DETERMINISTIC" | "AGENT_API_BASE_URL" | "AGENT_API_KEY" | "AGENT_MODEL" | "XIAOZE_MODEL"
    >;
    getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext;
    createAgent?: (context: AgentToolExecutionContext) => XiaozePerceptionAgent;
  }
) {
  if (!options.env?.XIAOZE_RUNTIME_ENABLED || !options.db) {
    return;
  }

  const createAgent =
    options.createAgent ??
    createXiaozeAgentFactory({
      db: options.db,
      env: options.env
    });

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
    createAgent
  });

  router.post("/api/v1/agent/xiaoze", async (request) => handler(request));
}

export { readBearerUserId };
