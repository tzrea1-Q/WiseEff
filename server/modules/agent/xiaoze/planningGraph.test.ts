import { describe, expect, it, vi } from "vitest";
import { createXiaozeCheckpointer } from "./checkpointer";
import { createPlanningAgent, fakeModelSequence, toolCall } from "./planningGraph";

const anyAuth = {
  organization: { id: "org1" },
  user: { id: "u1", isActive: true },
  permissions: ["parameter:edit"],
  roles: []
} as never;

describe("createPlanningAgent", () => {
  it("grounds a read-only answer (P0 parity)", async () => {
    const runTool = vi.fn().mockResolvedValue({ summary: "12 parameters", data: {}, citations: [] });
    const model = fakeModelSequence([
      { toolCalls: [toolCall("perception.getProjectOverview", { projectId: "p1" })] },
      { content: "Project p1 has 12 parameters" }
    ]);
    const agent = createPlanningAgent({
      model,
      runTool,
      listTools: () => [{ name: "perception.getProjectOverview", description: "x", schema: {} }],
      checkpointer: createXiaozeCheckpointer()
    });
    const result = await agent.run({ message: "summarize p1", context: { projectId: "p1" }, threadId: "t1" });
    expect(result.text).toContain("12 parameters");
  });

  it("returns an interrupt for a mutating tool without executing (P1 parity)", async () => {
    const runTool = vi.fn();
    const model = fakeModelSequence([
      {
        toolCalls: [
          toolCall("action.submitParameterChange", {
            projectId: "p1",
            parameterId: "pd1",
            targetValue: "42",
            reason: "x"
          })
        ]
      }
    ]);
    const agent = createPlanningAgent({
      model,
      runTool,
      listTools: () => [{ name: "action.submitParameterChange", description: "x", schema: {}, requiresApproval: true }],
      checkpointer: createXiaozeCheckpointer()
    });
    const result = await agent.run({ message: "set pd1 to 42", context: { projectId: "p1" }, threadId: "t2" });
    expect(runTool).not.toHaveBeenCalled();
    expect(result.interrupt?.toolName).toBe("action.submitParameterChange");
  });

  it("resumes the plan after approval and observes the result", async () => {
    const checkpointer = createXiaozeCheckpointer();
    const approvalBridge = {
      resume: vi.fn().mockResolvedValue({ text: "change request cr-1 created" })
    };
    const runTool = vi.fn().mockResolvedValue({ summary: "overview", data: {}, citations: [] });
    const model = fakeModelSequence([
      { toolCalls: [toolCall("action.submitParameterChange", { projectId: "p1", parameterId: "pd1", targetValue: "42", reason: "x" })] },
      { content: "Submitted change request cr-1 created. Track it on the review page." }
    ]);
    const agent = createPlanningAgent({
      model,
      runTool,
      listTools: () => [{ name: "action.submitParameterChange", description: "x", schema: {}, requiresApproval: true }],
      checkpointer,
      approvalBridge
    });

    const interrupted = await agent.run({ message: "set pd1 to 42", context: { projectId: "p1" }, threadId: "t9" });
    expect(interrupted.interrupt?.toolName).toBe("action.submitParameterChange");

    const resumed = await agent.run({
      message: "",
      context: { projectId: "p1" },
      threadId: "t9",
      resume: {
        auth: anyAuth,
        requestId: "req-1",
        approvalId: "approval-1",
        decision: "approve"
      }
    });

    expect(approvalBridge.resume).toHaveBeenCalledOnce();
    expect(resumed.text).toContain("cr-1");
  });

  it("halts gracefully on reject without mutation", async () => {
    const checkpointer = createXiaozeCheckpointer();
    const approvalBridge = {
      resume: vi.fn().mockResolvedValue({ text: "The proposed action was rejected." })
    };
    const model = fakeModelSequence([
      { toolCalls: [toolCall("action.submitParameterChange", { projectId: "p1", parameterId: "pd1", targetValue: "42", reason: "x" })] }
    ]);
    const agent = createPlanningAgent({
      model,
      runTool: vi.fn(),
      listTools: () => [{ name: "action.submitParameterChange", description: "x", schema: {}, requiresApproval: true }],
      checkpointer,
      approvalBridge
    });

    await agent.run({ message: "set pd1 to 42", context: { projectId: "p1" }, threadId: "t-reject" });
    const result = await agent.run({
      message: "",
      context: { projectId: "p1" },
      threadId: "t-reject",
      resume: {
        auth: anyAuth,
        requestId: "req-2",
        approvalId: "approval-2",
        decision: "reject",
        reason: "Not now"
      }
    });

    expect(result.text.toLowerCase()).toContain("rejected");
  });
});
