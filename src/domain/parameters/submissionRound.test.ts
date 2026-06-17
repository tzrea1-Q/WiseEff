import { describe, expect, it } from "vitest";

import {
  canWithdrawSubmissionRound,
  formatSubmissionTimestamp,
  isActiveSubmissionRound
} from "./submissionRound";

describe("submissionRound helpers", () => {
  it("allows withdraw while a submission round is still in review", () => {
    expect(canWithdrawSubmissionRound("待审阅")).toBe(true);
    expect(canWithdrawSubmissionRound("硬件Committer检视")).toBe(true);
    expect(canWithdrawSubmissionRound("软件Committer检视")).toBe(true);
    expect(canWithdrawSubmissionRound("软件User合入")).toBe(true);
  });

  it("blocks withdraw for closed or stashed rounds", () => {
    expect(canWithdrawSubmissionRound("已合入")).toBe(false);
    expect(canWithdrawSubmissionRound("已打回")).toBe(false);
    expect(canWithdrawSubmissionRound("已撤回")).toBe(false);
    expect(canWithdrawSubmissionRound("已暂存")).toBe(false);
  });

  it("counts active submission rounds for the history summary metric", () => {
    expect(isActiveSubmissionRound("硬件Committer检视")).toBe(true);
    expect(isActiveSubmissionRound("已撤回")).toBe(false);
  });

  it("formats ISO timestamps into readable Chinese text", () => {
    const recent = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatSubmissionTimestamp(recent)).toBe("5 分钟前");
    expect(formatSubmissionTimestamp("刚刚")).toBe("刚刚");
    expect(formatSubmissionTimestamp("2026-06-17T03:10:21.456Z")).not.toContain("T03:10:21.456Z");
  });
});
