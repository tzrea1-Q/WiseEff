import { describe, expect, it } from "vitest";
import { XiaozeTurnStateTracker } from "./xiaozeTurnState";

const ids = { runId: "run-1", messageId: "msg-1", reasoningMessageId: "reason-1" };

describe("XiaozeTurnStateTracker", () => {
  it("transitions thinking → tool → composing → done", () => {
    const tracker = new XiaozeTurnStateTracker(ids);

    expect(tracker.snapshot().phase).toBe("thinking");

    tracker.onSinkEvent({
      type: "step_started",
      step: {
        id: "step-1",
        kind: "tool",
        label: "搜索参数定义",
        toolName: "perception.searchParameters",
        status: "running",
        startedAtMs: 1
      }
    });
    expect(tracker.snapshot().phase).toBe("tool");
    expect(tracker.snapshot().steps).toHaveLength(1);

    tracker.onSinkEvent({
      type: "step_finished",
      stepId: "step-1",
      status: "succeeded",
      summary: "4 parameters",
      durationMs: 12
    });
    expect(tracker.snapshot().steps?.[0]?.status).toBe("succeeded");

    tracker.onSinkEvent({ type: "answer_delta", delta: "找到 4 个参数。" });
    expect(tracker.snapshot().phase).toBe("composing");
    expect(tracker.snapshot().text).toContain("找到 4 个");

    tracker.markDone({ text: "找到 4 个 charge 相关参数。" });
    expect(tracker.snapshot().phase).toBe("done");
    expect(tracker.snapshot().text).toBe("找到 4 个 charge 相关参数。");
  });
});
