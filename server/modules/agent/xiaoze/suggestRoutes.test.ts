import { describe, expect, it } from "vitest";

import { createRouter } from "../../../shared/http/router";
import { developmentAuthContext } from "../../auth/routes";
import { createMemoryAgentDb } from "../testing/memoryAgentDb";
import { registerXiaozeRoutes } from "./agUiEndpoint";

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
});
