import { describe, expect, it } from "vitest";
import { buildXiaozePromptDebugSnapshot } from "./promptDebug";

describe("buildXiaozePromptDebugSnapshot", () => {
  it("captures structured prompt sections for a turn", () => {
    const tools = [{ name: "perception.getProjectOverview", description: "Overview", schema: { type: "object" } }];
    const llmMessages = [
      { role: "system", content: "You are Xiaoze." },
      { role: "user", content: "summarize aurora" }
    ];
    const snapshot = buildXiaozePromptDebugSnapshot({
      threadId: "thread-1",
      message: "summarize aurora",
      context: { projectId: "aurora", pageKey: "parameters" },
      llmMessages,
      tools,
      systemPolicy: "You are Xiaoze.",
      model: "MiniMax-M3"
    });

    expect(snapshot.threadId).toBe("thread-1");
    expect(snapshot.userMessage).toBe("summarize aurora");
    expect(snapshot.context.projectId).toBe("aurora");
    expect(snapshot.system.policy).toContain("Xiaoze");
    expect(snapshot.system.toolCatalog).toContain("perception.getProjectOverview");
    expect(snapshot.llmMessages).toEqual(llmMessages);
    expect(snapshot.tools).toEqual(tools);
    expect(snapshot.model).toBe("MiniMax-M3");
  });
});
