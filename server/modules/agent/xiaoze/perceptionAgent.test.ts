import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../shared/http/errors";
import { createPerceptionAgent, type PerceptionChatModel, type PerceptionModelResponse } from "./perceptionAgent";

function makeFakeModelThatCalls(toolName: string, args: Record<string, unknown>): PerceptionChatModel {
  let invoked = false;
  return {
    async invoke(messages): Promise<PerceptionModelResponse> {
      if (!invoked) {
        invoked = true;
        return {
          toolCalls: [{ id: "tc-1", name: toolName, args }]
        };
      }

      const toolMessage = messages.find(
        (message) => typeof message === "object" && message && "role" in message && (message as { role: string }).role === "tool"
      ) as { content?: string } | undefined;
      const summary = toolMessage?.content ? JSON.parse(toolMessage.content).summary : "";
      return {
        content: `Based on the tool result: ${summary}`
      };
    }
  };
}

describe("createPerceptionAgent", () => {
  it("answers grounded in a perception tool result", async () => {
    const runTool = vi.fn().mockResolvedValue({ summary: "Project p1: 12 parameters", data: {}, citations: [] });
    const fakeModel = makeFakeModelThatCalls("perception.getProjectOverview", { projectId: "p1" });
    const agent = createPerceptionAgent({
      model: fakeModel,
      runTool,
      listTools: () => [{ name: "perception.getProjectOverview", description: "x", schema: {} }]
    });
    const result = await agent.run({ message: "summarize project p1", context: { projectId: "p1", pageKey: "parameters" } });
    expect(runTool).toHaveBeenCalledWith("perception.getProjectOverview", expect.objectContaining({ projectId: "p1" }));
    expect(result.text).toContain("12 parameters");
  });

  it("returns an interrupt for approval-gated tools instead of executing", async () => {
    const runTool = vi.fn();
    const fakeModel = makeFakeModelThatCalls("action.submitParameterChange", {
      projectId: "p1",
      parameterId: "pd1",
      targetValue: "42",
      reason: "x"
    });
    const agent = createPerceptionAgent({
      model: fakeModel,
      runTool,
      listTools: () => [{ name: "action.submitParameterChange", description: "x", schema: {}, requiresApproval: true }]
    });
    const result = await agent.run({ message: "set pd1 to 42", context: { projectId: "p1" } });
    expect(runTool).not.toHaveBeenCalled();
    expect(result.interrupt?.toolName).toBe("action.submitParameterChange");
  });

  it("surfaces a safe answer when a tool is forbidden", async () => {
    const runTool = vi.fn().mockRejectedValue(new ApiError("FORBIDDEN", "Agent project access is required.", 403));
    const model: PerceptionChatModel = {
      async invoke(messages) {
        const hasToolResult = messages.some(
          (message) => typeof message === "object" && message && "role" in message && (message as { role: string }).role === "tool"
        );
        if (!hasToolResult) {
          return { toolCalls: [{ id: "tc-2", name: "perception.getProjectOverview", args: { projectId: "secret" } }] };
        }
        return { content: "You are not permitted to access that project." };
      }
    };
    const agent = createPerceptionAgent({
      model,
      runTool,
      listTools: () => [{ name: "perception.getProjectOverview", description: "x", schema: {} }]
    });
    const result = await agent.run({ message: "summarize secret project", context: { pageKey: "parameters" } });
    expect(result.text.toLowerCase()).toContain("not permitted");
  });
});
