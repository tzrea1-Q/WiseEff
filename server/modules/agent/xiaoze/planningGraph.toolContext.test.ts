import { describe, expect, it } from "vitest";
import { createXiaozeCheckpointer } from "./checkpointer";
import { createPlanningAgent, fakeModelSequence } from "./planningGraph";
import { formatToolCatalogForSystemPrompt } from "./toolCatalog";

describe("planningGraph tool context", () => {
  it("includes the tool catalog in the initial system message", async () => {
    const tools = [
      { name: "perception.getProjectOverview", description: "Project overview", schema: { type: "object" } },
      { name: "action.submitParameterChange", description: "Submit change", schema: { type: "object" }, requiresApproval: true }
    ];
    const capturedMessages: unknown[][] = [];
    const model = {
      async invoke(messages: unknown[]) {
        capturedMessages.push(messages);
        return { content: "WiseEff covers parameters, logs, and debugging." };
      }
    };
    const agent = createPlanningAgent({
      model,
      runTool: async () => ({ summary: "ok", data: {}, citations: [] }),
      listTools: () => tools,
      checkpointer: createXiaozeCheckpointer()
    });

    await agent.run({ message: "请告诉我本平台有什么能力", context: {}, threadId: "tool-context" });

    const systemMessage = capturedMessages[0]?.[0] as { role?: string; content?: string } | undefined;
    expect(systemMessage?.role).toBe("system");
    expect(systemMessage?.content).toContain(formatToolCatalogForSystemPrompt(tools));
    expect(systemMessage?.content).toContain("perception.getProjectOverview");
  });
});
