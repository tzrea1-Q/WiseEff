import { describe, expect, it } from "vitest";
import { reducer, type AppAction } from "./App";
import { initialState } from "./mockData";

describe("review reducer existing actions", () => {
  it("ADVANCE_REVIEW preserves fastTrack and reviewer note metadata", () => {
    const target = initialState.changeRequests.find((request) => request.status === "待审阅")!;
    const action: AppAction = {
      type: "ADVANCE_REVIEW",
      requestId: target.id,
      fastTrack: true,
      note: "AI 高置信快速推进"
    };

    const next = reducer(initialState, action);
    const updated = next.changeRequests.find((request) => request.id === target.id)!;

    expect(updated.status).toBe("自动检查通过");
    expect(updated.fastTrack).toBe(true);
    expect(updated.reviewerNote).toBe("AI 高置信快速推进");
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(new Date(target.updatedAt).getTime());
    expect(next.notifications[0]).toContain("快速通道");
  });

  it("REJECT_REVIEW preserves fastTrack metadata", () => {
    const target = initialState.changeRequests.find((request) => request.status === "待审阅")!;
    const action: AppAction = {
      type: "REJECT_REVIEW",
      requestId: target.id,
      reason: "缺少高温工况验证",
      fastTrack: true
    };

    const next = reducer(initialState, action);
    const updated = next.changeRequests.find((request) => request.id === target.id)!;

    expect(updated.status).toBe("已打回");
    expect(updated.rejectReason).toBe("缺少高温工况验证");
    expect(updated.fastTrack).toBe(true);
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(new Date(target.updatedAt).getTime());
    expect(next.notifications[0]).toContain("快速通道");
  });
});
