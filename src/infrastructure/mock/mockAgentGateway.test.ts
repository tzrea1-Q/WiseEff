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

  it("persists session messages across actions and approvals", async () => {
    const gateway = createMockAgentGateway();
    const session = await gateway.startSession({
      path: "/parameter-admin",
      pageKey: "parameter-admin",
      projectId: "aurora"
    });
    const messageTurn = await gateway.sendMessage(session.id, "鎵弿闂茬疆鍙傛暟");
    const messageCount = messageTurn.session.messages.length;

    const actionTurn = await gateway.runAction(session.id, "draft-cleanup", { source: "test" });

    expect(actionTurn.toolCalls).toHaveLength(1);
    expect(actionTurn.toolCalls[0]).toMatchObject({
      name: "parameter.draftCleanupPlan",
      payload: {
        actionId: "draft-cleanup",
        path: "/parameter-admin",
        source: "test"
      }
    });
    expect(actionTurn.session.messages.length).toBeGreaterThan(messageCount);

    const approvalTurn = await gateway.approveToolCall(session.id, "approval-tool-draft-cleanup");

    expect(approvalTurn.session.messages.length).toBeGreaterThan(actionTurn.session.messages.length);
  });

  it("maps log checklist actions to the log checklist tool", async () => {
    const gateway = createMockAgentGateway();
    const session = await gateway.startSession({
      path: "/logs",
      pageKey: "logs",
      projectId: "aurora"
    });

    const turn = await gateway.sendMessage(session.id, "鐢熸垚鎺掓煡娓呭崟");

    expect(turn.toolCalls.map((toolCall) => toolCall.name)).toContain("log.generateChecklist");
  });

  it("maps parameter review actions to the review queue summary tool", async () => {
    const gateway = createMockAgentGateway();
    const session = await gateway.startSession({
      path: "/parameter-review",
      pageKey: "parameter-review",
      projectId: "aurora"
    });

    const turn = await gateway.sendMessage(session.id, "鎬荤粨瀹￠槄闃熷垪");

    expect(turn.toolCalls.map((toolCall) => toolCall.name)).toContain("parameter.summarizeReviewQueue");
  });
});
