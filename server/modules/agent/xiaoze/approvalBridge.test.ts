import { describe, expect, it, vi } from "vitest";
import { createApprovalBridge } from "./approvalBridge";

const anyAuth = {
  organization: { id: "org1" },
  user: { id: "u1" },
  roles: [{ roleId: "admin", projectId: null }],
  permissions: ["parameter:edit"]
} as never;

describe("createApprovalBridge", () => {
  it("creates a persisted approval on begin", async () => {
    const orchestrator = {
      createApproval: vi.fn().mockResolvedValue({ approvalId: "a1", toolCallId: "t1" }),
      approveToolCall: vi.fn(),
      rejectToolCall: vi.fn()
    };
    const bridge = createApprovalBridge({ orchestrator });
    const interrupt = await bridge.begin({
      auth: anyAuth,
      requestId: "req-1",
      sessionId: "s1",
      toolName: "action.submitParameterChange",
      payload: { projectId: "p1" },
      citations: []
    });
    expect(orchestrator.createApproval).toHaveBeenCalled();
    expect(interrupt.approvalId).toBe("a1");
    expect(interrupt.toolCallId).toBe("t1");
  });

  it("approves via the orchestrator on resume", async () => {
    const orchestrator = {
      createApproval: vi.fn().mockResolvedValue({ approvalId: "a1", toolCallId: "t1" }),
      approveToolCall: vi.fn().mockResolvedValue({ messages: [{ content: "done" }] }),
      rejectToolCall: vi.fn()
    };
    const bridge = createApprovalBridge({ orchestrator });
    await bridge.begin({
      auth: anyAuth,
      requestId: "req-1",
      sessionId: "s1",
      toolName: "action.submitParameterChange",
      payload: { projectId: "p1" },
      citations: []
    });
    await bridge.resume({ auth: anyAuth, requestId: "req-2", approvalId: "a1", decision: "approve" });
    expect(orchestrator.approveToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ approvalId: "a1", reason: "Approved from Xiaoze chat." })
    );
  });

  it("rejects via the orchestrator on resume", async () => {
    const orchestrator = {
      createApproval: vi.fn().mockResolvedValue({ approvalId: "a1", toolCallId: "t1" }),
      approveToolCall: vi.fn(),
      rejectToolCall: vi.fn().mockResolvedValue({ messages: [{ content: "rejected" }] })
    };
    const bridge = createApprovalBridge({ orchestrator });
    await bridge.resume({
      auth: anyAuth,
      requestId: "req-2",
      approvalId: "a1",
      decision: "reject",
      reason: "Not now"
    });
    expect(orchestrator.rejectToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ approvalId: "a1", reason: "Not now" })
    );
  });
});
