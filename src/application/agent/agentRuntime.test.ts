import { describe, expect, it, vi } from "vitest";

import type { AgentGateway } from "@/application/ports/AgentGateway";
import { buildAgentContext, resolveAgentGateway } from "./agentRuntime";

function createGateway(): AgentGateway {
  return {
    startSession: vi.fn(),
    sendMessage: vi.fn(),
    runAction: vi.fn(),
    approveToolCall: vi.fn(),
    rejectToolCall: vi.fn()
  };
}

describe("agent runtime", () => {
  it("returns an injected gateway in mock mode and undefined without one", () => {
    const gateway = createGateway();

    expect(resolveAgentGateway("mock")).toBeUndefined();
    expect(resolveAgentGateway("mock", gateway)).toBe(gateway);
  });

  it("requires a gateway in api mode", () => {
    const gateway = createGateway();

    expect(() => resolveAgentGateway("api")).toThrow("Agent gateway is required in api runtime mode.");
    expect(resolveAgentGateway("api", gateway)).toBe(gateway);
  });

  it("builds agent context from route and identity input", () => {
    expect(
      buildAgentContext({
        path: "/parameter-review",
        pageKey: "parameter-review",
        projectId: "aurora",
        roleId: "reviewer"
      })
    ).toEqual({
      path: "/parameter-review",
      pageKey: "parameter-review",
      projectId: "aurora",
      roleId: "reviewer"
    });
  });
});
