import { describe, expect, it } from "vitest";
import { agentApprovalFromDto, agentMessageFromDto, agentToolCallFromDto } from "./agentDtos";

describe("agent DTO mapping", () => {
  it("maps citations, confidence, tool status, and approval status", () => {
    expect(
      agentMessageFromDto({
        id: "agent-msg-1",
        role: "assistant",
        content: "Review summary",
        citations: [{ type: "parameter", id: "change-1", label: "Change request change-1" }],
        confidence: 0.82,
        createdAt: "2026-05-27T00:00:00.000Z"
      }).confidence
    ).toBe(0.82);

    expect(
      agentToolCallFromDto({
        id: "tool-1",
        name: "parameter.summarizeReviewQueue",
        label: "Summarize review queue",
        payload: { projectId: "aurora" },
        requiresApproval: false,
        status: "succeeded",
        result: { summary: "2 pending", data: { pending: 2 }, citations: [] },
        createdAt: "2026-05-27T00:00:00.000Z",
        completedAt: "2026-05-27T00:00:01.000Z"
      }).status
    ).toBe("succeeded");

    expect(
      agentApprovalFromDto({
        id: "approval-1",
        toolCallId: "tool-2",
        title: "Create parameter draft",
        message: "This will create a draft.",
        status: "pending",
        createdAt: "2026-05-27T00:00:00.000Z"
      }).status
    ).toBe("pending");
  });
});
