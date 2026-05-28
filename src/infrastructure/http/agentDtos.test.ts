import { describe, expect, it } from "vitest";
import { agentApprovalFromDto, agentMessageFromDto, agentToolCallFromDto, agentTurnFromDto } from "./agentDtos";

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

  it("preserves M4 Agent turn envelope contract names", () => {
    const turn = agentTurnFromDto({
      session: {
        id: "agent-session-1",
        context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "admin" },
        messages: []
      },
      messages: [
        {
          id: "agent-msg-1",
          role: "assistant",
          content: "Review queue summary",
          citations: [{ type: "parameter", id: "change-1", label: "Fast charge current" }],
          confidence: 0.78,
          createdAt: "2026-05-28T00:00:00.000Z"
        }
      ],
      toolCalls: [
        {
          id: "tool-call-1",
          name: "parameter.summarizeReviewQueue",
          label: "Summarize review queue",
          payload: { projectId: "aurora" },
          requiresApproval: false,
          status: "succeeded",
          result: { summary: "2 pending", data: { pending: 2 }, citations: [] },
          createdAt: "2026-05-28T00:00:00.000Z"
        }
      ],
      approvals: [
        {
          id: "approval-1",
          toolCallId: "tool-call-2",
          title: "Create parameter draft",
          message: "Approve before WiseAgent creates a human-review draft.",
          status: "pending",
          createdAt: "2026-05-28T00:00:00.000Z"
        }
      ]
    });

    expect(turn.toolCalls[0]).toMatchObject({
      name: "parameter.summarizeReviewQueue",
      status: "succeeded"
    });
    expect(turn.approvals[0]).toMatchObject({
      toolCallId: "tool-call-2",
      status: "pending"
    });
  });
});
