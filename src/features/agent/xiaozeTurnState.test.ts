import { describe, expect, it } from "vitest";
import { XIAOZE_TURN_STATE_EVENT, type XiaozeTurnStatePayload } from "./xiaozeTurnStateTypes";

describe("xiaozeTurnStateTypes", () => {
  it("uses a stable custom event name", () => {
    expect(XIAOZE_TURN_STATE_EVENT).toBe("xiaoze_turn_state");
  });

  it("accepts a done payload with authoritative answer text", () => {
    const payload: XiaozeTurnStatePayload = {
      runId: "run-1",
      messageId: "msg-1",
      reasoningMessageId: "reason-1",
      phase: "done",
      text: "找到 4 个 charge 相关参数。",
      steps: [
        {
          id: "step-1",
          kind: "tool",
          label: "搜索参数定义",
          status: "succeeded",
          startedAtMs: 1
        }
      ]
    };
    expect(payload.phase).toBe("done");
    expect(payload.text).toContain("4 个");
  });
});
