import { describe, expect, it } from "vitest";
import { createMockAgentGateway } from "./mockAgentGateway";

describe("mock agent gateway", () => {
  it("starts a parameter admin session and returns mapped tools with approvals", async () => {
    const gateway = createMockAgentGateway();
    const session = await gateway.startSession({
      path: "/parameter-admin",
      pageKey: "parameter-admin",
      projectId: "aurora"
    });

    const turn = await gateway.sendMessage(session.id, "扫描闲置参数");

    expect(turn.session.messages.length).toBeGreaterThan(session.messages.length);
    expect(turn.toolCalls.map((toolCall) => toolCall.name)).toContain("parameter.scanOrphans");
    expect(turn.approvals.some((approval) => approval.toolCallId === "tool-draft-cleanup")).toBe(true);
  });
});
