import { describe, expect, it, vi } from "vitest";

import { createRouter } from "../../../shared/http/router";
import { developmentAuthContext } from "../../auth/routes";
import { createMemoryAgentDb } from "../testing/memoryAgentDb";
import { createAgentOrchestrator } from "../orchestrator";
import type { createAgentToolRegistry } from "../toolRegistry";
import { registerXiaozeRoutes } from "./agUiEndpoint";

function createReadRegistry() {
  const definition = {
    name: "perception.getProjectOverview",
    label: "查询项目概览",
    kind: "read",
    permission: "parameter:view",
    requiresApproval: false,
    description: "read project overview",
    schema: {}
  } as const;
  const run = vi.fn(async () => ({
    summary: "Project overview loaded.",
    data: { open_change_requests: 1 },
    citations: []
  }));
  const registry = {
    list: () => [definition],
    get: (name: string) => (name === definition.name ? definition : undefined),
    require: (name: string) => {
      if (name !== definition.name) {
        throw new Error(`unknown tool ${name}`);
      }
      return definition;
    },
    authorize: vi.fn(),
    run
  } as unknown as ReturnType<typeof createAgentToolRegistry>;
  return { registry, run };
}

function createSuggestRouter(proactiveEnabled = true) {
  const router = createRouter();
  registerXiaozeRoutes(router, {
    db: createMemoryAgentDb().db,
    env: {
      XIAOZE_PROACTIVE_ENABLED: proactiveEnabled,
      XIAOZE_CHECKPOINTER: "memory",
      XIAOZE_REASONING_FALLBACK_HEURISTIC: false
    },
    getCurrentAuthContext: () => developmentAuthContext
  });
  return router;
}

describe("POST /api/v1/agent/xiaoze/suggest", () => {
  it.each([
    ["undefined body", undefined],
    ["null body", null],
    ["non-object context", { context: "parameters" }],
    ["non-string page key", { context: { pageKey: 7 } }]
  ])("rejects %s at the route contract", async (_case, body) => {
    const router = createSuggestRouter();

    await expect(
      router.handle({
        method: "POST",
        path: "/api/v1/agent/xiaoze/suggest",
        params: {},
        query: {},
        headers: { authorization: "Bearer dev" },
        requestId: "req-invalid-suggest",
        body
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      status: 400,
      details: { issues: expect.any(Array) }
    });
  });

  it("validates the request before returning the feature-disabled empty result", async () => {
    const router = createSuggestRouter(false);

    await expect(
      router.handle({
        method: "POST",
        path: "/api/v1/agent/xiaoze/suggest",
        params: {},
        query: {},
        headers: {},
        requestId: "req-disabled-invalid-suggest",
        body: undefined
      })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 400 });
  });

  it("persists proactive read-only perception before execution", async () => {
    const { db, tables } = createMemoryAgentDb();
    const { registry, run } = createReadRegistry();
    const orchestrator = createAgentOrchestrator({ db, toolRegistry: registry });
    const router = createRouter();
    registerXiaozeRoutes(router, {
      db,
      env: {
        XIAOZE_PROACTIVE_ENABLED: true,
        XIAOZE_CHECKPOINTER: "memory",
        XIAOZE_REASONING_FALLBACK_HEURISTIC: false
      },
      getCurrentAuthContext: () => developmentAuthContext,
      createAgent: () => ({ run: async () => ({ text: "", citations: [] }) }),
      orchestrator,
      toolRegistry: registry
    });

    const response = await router.handle({
      method: "POST",
      path: "/api/v1/agent/xiaoze/suggest",
      params: {},
      query: {},
      headers: { authorization: "Bearer dev" },
      requestId: "req-persisted-suggest",
      body: { context: { pageKey: "parameters", projectId: "aurora" } }
    });

    expect(response).toMatchObject({ status: 200, body: { suggestions: expect.any(Array) } });
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[1].invocation).toMatchObject({
      initiator: "agent",
      sessionId: "suggest-req-persisted-suggest",
      toolCallId: expect.any(String),
      approvalRequired: false,
      approvalId: null
    });
    expect(tables.sessions).toHaveLength(1);
    expect(tables.toolCalls).toHaveLength(1);
    expect(tables.toolCalls[0]).toMatchObject({
      session_id: "suggest-req-persisted-suggest",
      name: "perception.getProjectOverview",
      status: "succeeded",
      requires_approval: false
    });
    expect(run.mock.calls[0]?.[1].invocation.toolCallId).toBe(tables.toolCalls[0]?.id);
  });
});
