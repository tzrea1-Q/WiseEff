import { describe, expect, it } from "vitest";
import { groupMessagesIntoTurns, pickAssistantForTurn } from "./xiaozeTurnGrouping";

describe("xiaozeTurnGrouping", () => {
  it("groups messages into user-led turns", () => {
    const turns = groupMessagesIntoTurns([
      { id: "u1", role: "user", content: "hello" },
      { id: "r1", role: "reasoning", content: "thinking" },
      { id: "a1", role: "assistant", content: "你好" }
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0]?.user.id).toBe("u1");
    expect(turns[0]?.reasoning?.id).toBe("r1");
    expect(turns[0]?.assistants.map((entry) => entry.id)).toEqual(["a1"]);
  });

  it("prefers the Chinese assistant message when duplicates exist", () => {
    const turn = groupMessagesIntoTurns([
      { id: "u1", role: "user", content: "charge?" },
      {
        id: "a-en",
        role: "assistant",
        content: "The user is asking about charge parameters."
      },
      {
        id: "a-zh",
        role: "assistant",
        content: "在 aurora 项目中找到 4 个 charge 相关参数。"
      }
    ])[0];

    expect(pickAssistantForTurn(turn)?.id).toBe("a-zh");
  });
});
