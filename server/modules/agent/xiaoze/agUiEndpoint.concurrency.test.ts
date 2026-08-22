import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../../shared/database/client";
import type { AuthContext } from "../../auth/types";
import type { createAgentToolRegistry } from "../toolRegistry";
import { createXiaozeAgentFactory } from "./agUiEndpoint";
import { createXiaozeCheckpointer } from "./checkpointer";
import { createRunEventSink } from "./runEventSink";

function authFor(userId: string): AuthContext {
  return {
    organization: { id: "org1", name: "Org" },
    user: { id: userId, organizationId: "org1", name: userId, title: "Tester", isActive: true },
    permissions: ["parameter:view"],
    roles: [{ projectId: null, roleId: "admin" }]
  } as AuthContext;
}

const stubDb = {
  query: async () => ({ rows: [], rowCount: 0 }),
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ query: async () => ({ rows: [], rowCount: 0 }) })
} as unknown as Database;

type RecordedCall = { projectId: string; userId: string };

function createFakeRegistry(calls: RecordedCall[]) {
  const tool = {
    name: "perception.getProjectOverview",
    label: "Get project overview",
    kind: "read" as const,
    permission: "parameter:view" as const,
    requiresApproval: false,
    run: async () => ({ summary: "", data: {}, citations: [] })
  };
  return {
    list: () => [tool],
    get: () => tool,
    require: () => tool,
    authorize: () => undefined,
    run: async (_name: string, context: { auth: AuthContext }, payload: Record<string, unknown>) => {
      calls.push({ projectId: String(payload.projectId), userId: context.auth.user.id });
      return { summary: `overview ${String(payload.projectId)}`, data: {}, citations: [] };
    }
  } as unknown as ReturnType<typeof createAgentToolRegistry>;
}

/**
 * Regression for the process-singleton request slots: two overlapping runs
 * with different auth contexts must each execute tools under their own auth
 * and stream into their own sink. Before the config-scoped request context,
 * the second request overwrote the first request's executionContextRef and
 * activeSink.
 */
describe("createXiaozeAgentFactory request isolation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("runs without constructing the production model in deterministic mode", async () => {
    vi.stubEnv("XIAOZE_DETERMINISTIC", "true");
    const productionModelFactory = vi.fn(() => {
      throw new Error("external provider model must not be constructed");
    });
    const factory = createXiaozeAgentFactory({
      db: stubDb,
      env: {
        XIAOZE_LLM_CONFIG: {
          source: "canonical",
          config: { model: "provider-model" },
          diagnostics: []
        },
        XIAOZE_CHECKPOINTER: "memory",
        XIAOZE_REASONING_FALLBACK_HEURISTIC: false,
        DATABASE_URL: undefined
      },
      modelFactory: productionModelFactory,
      checkpointer: createXiaozeCheckpointer(),
      toolRegistry: createFakeRegistry([]),
      approvalResolver: { resolveApproval: vi.fn() }
    });

    const agent = factory({ auth: authFor("deterministic-user"), requestId: "req-deterministic", sessionId: "t-deterministic" });
    const result = await agent.run({
      message: "hello",
      context: {},
      threadId: "t-deterministic"
    });

    expect(result.text).toBeTruthy();
    expect(productionModelFactory).toHaveBeenCalledTimes(0);
  });

  it("keeps auth context and sink per request when runs overlap", async () => {
    const calls: RecordedCall[] = [];
    let releaseSlow: (() => void) | undefined;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });

    const model = {
      async invoke(messages: unknown[]) {
        const entries = messages as Array<{ role?: string; content?: unknown }>;
        const hasToolResult = entries.some((entry) => entry && typeof entry === "object" && entry.role === "tool");
        if (hasToolResult) {
          return { content: "done" };
        }
        const text = JSON.stringify(messages);
        if (text.includes("slow-project")) {
          await slowGate;
          return {
            toolCalls: [{ id: "tc-slow", name: "perception.getProjectOverview", args: { projectId: "slow-project" } }]
          };
        }
        return {
          toolCalls: [{ id: "tc-fast", name: "perception.getProjectOverview", args: { projectId: "fast-project" } }]
        };
      }
    };

    const factory = createXiaozeAgentFactory({
      db: stubDb,
      env: {
        XIAOZE_CHECKPOINTER: "memory",
        XIAOZE_REASONING_FALLBACK_HEURISTIC: false,
        AGENT_API_BASE_URL: undefined,
        AGENT_API_KEY: undefined,
        AGENT_MODEL: undefined,
        XIAOZE_MODEL: undefined,
        DATABASE_URL: undefined
      } as never,
      modelFactory: () => model,
      checkpointer: createXiaozeCheckpointer(),
      toolRegistry: createFakeRegistry(calls),
      approvalResolver: { resolveApproval: vi.fn() }
    });

    const slowAuth = authFor("user-slow");
    const fastAuth = authFor("user-fast");
    const slowAgent = factory({ auth: slowAuth, requestId: "req-slow", sessionId: "t-slow" });
    const fastAgent = factory({ auth: fastAuth, requestId: "req-fast", sessionId: "t-fast" });

    const slowSink = createRunEventSink();
    const fastSink = createRunEventSink();

    const slowRun = slowAgent.run({
      message: "overview slow-project",
      context: { projectId: "slow-project" },
      threadId: "t-slow",
      sink: slowSink
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const fastResult = await fastAgent.run({
      message: "overview fast-project",
      context: { projectId: "fast-project" },
      threadId: "t-fast",
      sink: fastSink
    });
    expect(fastResult.text).toBe("done");

    releaseSlow?.();
    const slowResult = await slowRun;
    expect(slowResult.text).toBe("done");

    expect(calls).toHaveLength(2);
    expect(calls).toContainEqual({ projectId: "fast-project", userId: "user-fast" });
    expect(calls).toContainEqual({ projectId: "slow-project", userId: "user-slow" });

    slowSink.close();
    fastSink.close();
    const slowEvents = await slowSink.drain(0);
    const fastEvents = await fastSink.drain(0);
    const toolCallProjects = (events: Array<{ type: string; args?: Record<string, unknown> }>) =>
      events.filter((event) => event.type === "tool_call").map((event) => String(event.args?.projectId));

    expect(toolCallProjects(slowEvents as never)).toEqual(["slow-project"]);
    expect(toolCallProjects(fastEvents as never)).toEqual(["fast-project"]);
  });
});
