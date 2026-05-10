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

describe("TRANSFER_REVIEW", () => {
  it("updates the request assignee and keeps status unchanged", () => {
    const existing = initialState.changeRequests[0];
    const action: AppAction = {
      type: "TRANSFER_REVIEW",
      requestId: existing.id,
      to: "specialist-wang",
      note: "请协助审查新型号"
    };

    const next = reducer(initialState, action);
    const updated = next.changeRequests.find((request) => request.id === existing.id);

    expect(updated?.assignedTo).toBe("specialist-wang");
    expect(updated?.status).toBe(existing.status);
    expect(updated?.reviewerNote).toBe("请协助审查新型号");
    expect(next.notifications[0]).toContain(existing.id);
    expect(next.notifications[0]).toContain("specialist-wang");
  });

  it("keeps state unchanged for an unknown requestId", () => {
    const action: AppAction = {
      type: "TRANSFER_REVIEW",
      requestId: "PRQ-DOES-NOT-EXIST",
      to: "somebody"
    };

    const next = reducer(initialState, action);

    expect(next.changeRequests).toEqual(initialState.changeRequests);
  });
});

describe("UNDO_REVIEW_ACTION", () => {
  it("rolls the request status back to previousStatus", () => {
    const target = initialState.changeRequests.find((request) => request.status === "待审阅")!;
    const afterAdvance = reducer(initialState, { type: "ADVANCE_REVIEW", requestId: target.id });
    const advanced = afterAdvance.changeRequests.find((request) => request.id === target.id)!;
    expect(advanced.status).toBe("自动检查通过");

    const afterUndo = reducer(afterAdvance, {
      type: "UNDO_REVIEW_ACTION",
      requestId: target.id,
      previousStatus: "待审阅"
    });
    const undone = afterUndo.changeRequests.find((request) => request.id === target.id)!;

    expect(undone.status).toBe("待审阅");
  });

  it("clears rejectReason when undoing a rejection", () => {
    const target = initialState.changeRequests.find((request) => request.status === "待审阅")!;
    const afterReject = reducer(initialState, {
      type: "REJECT_REVIEW",
      requestId: target.id,
      reason: "测试打回"
    });
    const rejected = afterReject.changeRequests.find((request) => request.id === target.id)!;
    expect(rejected.rejectReason).toBe("测试打回");

    const afterUndo = reducer(afterReject, {
      type: "UNDO_REVIEW_ACTION",
      requestId: target.id,
      previousStatus: "待审阅"
    });
    const undone = afterUndo.changeRequests.find((request) => request.id === target.id)!;

    expect(undone.status).toBe("待审阅");
    expect(undone.rejectReason).toBeUndefined();
  });

  it("does not throw or mutate requests for an unknown requestId", () => {
    const next = reducer(initialState, {
      type: "UNDO_REVIEW_ACTION",
      requestId: "PRQ-NOPE",
      previousStatus: "待审阅"
    });

    expect(next.changeRequests).toEqual(initialState.changeRequests);
  });
});
