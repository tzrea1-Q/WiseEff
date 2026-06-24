import { describe, expect, it } from "vitest";
import { formatLlmMessagesTrace, formatPromptDebugCopyText } from "./xiaozePromptDebugFormat";
import type { XiaozePromptDebugSnapshot } from "./xiaozePromptDebugTypes";

const baseSnapshot: XiaozePromptDebugSnapshot = {
  threadId: "thread-1",
  userMessage: "你好",
  context: { pageKey: "parameters", projectId: "aurora" },
  system: {
    policy: "You are Xiaoze.",
    toolCatalog: "- perception.getProjectOverview: overview"
  },
  llmMessages: [
    { role: "system", content: "You are Xiaoze." },
    { role: "user", content: "你好" },
    { role: "assistant", tool_calls: [{ id: "tc-1", function: { name: "perception.getProjectOverview", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "tc-1", content: "{\"summary\":\"ok\"}" }
  ],
  tools: [{ name: "perception.getProjectOverview", description: "overview", schema: { type: "object" } }],
  model: "MiniMax-M3"
};

describe("xiaozePromptDebugFormat", () => {
  it("formats multi-turn llm trace with numbered roles", () => {
    const trace = formatLlmMessagesTrace(baseSnapshot.llmMessages);
    expect(trace).toContain("[1] system");
    expect(trace).toContain("[4] tool");
    expect(trace).toContain("tool_calls:");
  });

  it("builds a copy-friendly full prompt payload", () => {
    const text = formatPromptDebugCopyText(baseSnapshot);
    expect(text).toContain("=== Model ===");
    expect(text).toContain("=== LLM 交互 (4 条) ===");
    expect(text).toContain("[2] user");
    expect(text).toContain("你好");
  });
});
