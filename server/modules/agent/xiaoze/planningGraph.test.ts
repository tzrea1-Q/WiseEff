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

  it("answers a fresh turn on the same thread without reusing prior text", async () => {
    const model = fakeModelSequence([
      { content: "I am Xiaoze.", reasoning: "The user asked who I am." },
      { content: "WiseEff supports parameters, logs, and debugging.", reasoning: "The user asked about platform capabilities." }
    ]);
    const agent = createPlanningAgent({
      model,
      runTool: vi.fn(),
      listTools: () => [],
      checkpointer: createXiaozeCheckpointer()
    });

    const first = await agent.run({ message: "你是谁？", context: {}, threadId: "t-multi" });
    expect(first.text).toBe("I am Xiaoze.");
    expect(first.reasoning).toBe("The user asked who I am.");

    const second = await agent.run({
      message: "请告诉我本平台有什么能力",
      context: {},
      threadId: "t-multi"
    });
    expect(second.text).toBe("WiseEff supports parameters, logs, and debugging.");
    expect(second.reasoning).toBe("The user asked about platform capabilities.");
  });

  it("includes prompt debug snapshot when includePromptDebug is enabled", async () => {
    const tools = [{ name: "perception.getProjectOverview", description: "Project overview", schema: { type: "object" } }];
    const agent = createPlanningAgent({
      model: fakeModelSequence([{ content: "Answer" }]),
      runTool: vi.fn(),
      listTools: () => tools,
      checkpointer: createXiaozeCheckpointer()
    });

    const result = await agent.run({
      message: "hello",
      context: { projectId: "aurora" },
      threadId: "prompt-debug-turn",
      includePromptDebug: true
    });

    expect(result.promptDebug?.userMessage).toBe("hello");
    expect(result.promptDebug?.context.projectId).toBe("aurora");
    expect(result.promptDebug?.tools).toEqual(tools);
    expect(result.promptDebug?.llmMessages).toHaveLength(3);
    expect(result.promptDebug?.llmMessages.at(-1)).toMatchObject({ role: "assistant", content: "Answer" });
  });

  it("includes expanded llm message trace after tool calls", async () => {
    const tools = [{ name: "perception.getProjectOverview", description: "Project overview", schema: { type: "object" } }];
    const agent = createPlanningAgent({
      model: fakeModelSequence([
        { toolCalls: [toolCall("perception.getProjectOverview", { projectId: "aurora" })] },
        { content: "Answer" }
      ]),
      runTool: vi.fn().mockResolvedValue({ summary: "ok", data: {}, citations: [] }),
      listTools: () => tools,
      checkpointer: createXiaozeCheckpointer()
    });

    const result = await agent.run({
      message: "summarize aurora",
      context: { projectId: "aurora" },
      threadId: "prompt-debug-trace",
      includePromptDebug: true
    });

    expect(result.promptDebug?.llmMessages.length).toBeGreaterThan(2);
    expect(result.promptDebug?.llmMessages.some((message) => (message as { role?: string }).role === "tool")).toBe(true);
  });

  it("includes the final assistant message in prompt debug trace after tool grounding", async () => {
    const tools = [{ name: "perception.getProjectOverview", description: "Project overview", schema: { type: "object" } }];
    const agent = createPlanningAgent({
      model: fakeModelSequence([
        { toolCalls: [toolCall("perception.getProjectOverview", { projectId: "aurora" })] },
        { content: "Aurora has 12 parameters." }
      ]),
      runTool: vi.fn().mockResolvedValue({ summary: "ok", data: {}, citations: [] }),
      listTools: () => tools,
      checkpointer: createXiaozeCheckpointer()
    });

    const result = await agent.run({
      message: "summarize aurora",
      context: { projectId: "aurora" },
      threadId: "prompt-debug-final-assistant",
      includePromptDebug: true
    });

    expect(result.text).toBe("Aurora has 12 parameters.");
    expect(result.promptDebug?.llmMessages.length).toBeGreaterThanOrEqual(5);
    expect(result.promptDebug?.llmMessages.at(-1)).toMatchObject({ role: "assistant", content: "Aurora has 12 parameters." });
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
