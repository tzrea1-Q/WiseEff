import { describe, expect, it } from "vitest";
import {
  groupMessagesIntoTurns,
  pickAssistantForTurn,
  resolveTurnAnswerText,
  shouldDeferTurnAnswer
} from "./xiaozeTurnGrouping";

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
    expect(
      resolveTurnAnswerText(pickAssistantForTurn(turn), {
        runId: "run-1",
        messageId: "a-zh",
        reasoningMessageId: "r1",
        text: "在 aurora 项目中找到 4 个 charge 相关参数。"
      })
    ).toContain("4 个");
  });

  it("defers partial answer while tool steps are running without turn reply", () => {
    expect(
      shouldDeferTurnAnswer({
        isActiveTurn: true,
        isRunning: true,
        turnReply: undefined,
        steps: [{ id: "s1", kind: "tool", label: "搜索参数定义", status: "running", startedAtMs: 0 }]
      })
    ).toBe(true);
  });

  it("does not defer answer once turn reply is available", () => {
    expect(
      shouldDeferTurnAnswer({
        isActiveTurn: true,
        isRunning: true,
        turnReply: {
          runId: "run-1",
          messageId: "a1",
          reasoningMessageId: "r1",
          text: "完整回答"
        },
        steps: [{ id: "s1", kind: "tool", label: "搜索参数定义", status: "succeeded", startedAtMs: 0 }]
      })
    ).toBe(false);
  });

  it("prefers turn reply over duplicated streamed assistant content", () => {
    const assistant = {
      id: "a-dup",
      role: "assistant" as const,
      content: "在 aurora 项目中找到 4 个参数。\n\n在 aurora 项目中找到 4 个参数。"
    };
    expect(
      resolveTurnAnswerText(
        assistant,
        {
          runId: "run-1",
          messageId: "a-dup",
          reasoningMessageId: "r1",
          text: "在 aurora 项目中找到 4 个参数。"
        },
        false
      )
    ).toBe("在 aurora 项目中找到 4 个参数。");
  });
});
