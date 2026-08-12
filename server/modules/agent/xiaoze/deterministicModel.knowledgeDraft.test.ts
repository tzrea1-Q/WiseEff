import { describe, expect, it } from "vitest";

import { createDeterministicPerceptionModel } from "./agUiEndpoint";

/**
 * The planner appends page context lines to the user content
 * (`<message>\nCurrent page: …`), so the deterministic routes must match a
 * single line and never anchor on end-of-string — this pins the exact shape.
 */
function userMessages(content: string) {
  return [
    { role: "system", content: "system prompt" },
    { role: "user", content: `${content}\nCurrent page: logs` }
  ];
}

describe("deterministic model knowledge-draft routing", () => {
  it("routes 创建知识草稿 to action.createKnowledgeDraft with the title", async () => {
    const model = createDeterministicPerceptionModel();
    const response = await model.invoke(userMessages("创建知识草稿:快充温控排查经验"));

    expect(response.toolCalls).toEqual([
      expect.objectContaining({
        name: "action.createKnowledgeDraft",
        args: expect.objectContaining({
          title: "快充温控排查经验",
          tags: ["小泽沉淀"]
        })
      })
    ]);
    expect((response.toolCalls![0].args as { sourceLogId?: string }).sourceLogId).toBeUndefined();
  });

  it("parses the optional 来源日志 source id out of the same line", async () => {
    const model = createDeterministicPerceptionModel();
    const response = await model.invoke(userMessages("创建知识草稿:充电异常断电根因 来源日志:log-abc-123"));

    expect(response.toolCalls?.[0]).toMatchObject({
      name: "action.createKnowledgeDraft",
      args: { title: "充电异常断电根因", sourceLogId: "log-abc-123" }
    });
  });

  it("keeps knowledge search routing untouched", async () => {
    const model = createDeterministicPerceptionModel();
    const response = await model.invoke(userMessages("知识库检索:快充温控"));

    expect(response.toolCalls?.[0]).toMatchObject({ name: "knowledge.search", args: { query: "快充温控" } });
  });
});
