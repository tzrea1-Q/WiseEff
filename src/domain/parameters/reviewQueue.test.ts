import { describe, expect, it } from "vitest";

import { buildReviewMockRequests } from "@/reviewMockData";

import {
  canActOnReviewRequest,
  isReviewHistoryForRole,
  splitChangeRequestsForReviewQueue
} from "./reviewQueue";

describe("reviewQueue", () => {
  const requests = buildReviewMockRequests();
  const hardwareReviewRequest = requests.find((request) => request.status === "硬件Committer检视")!;

  it("keeps only the current workflow stage in pending for hardware committer", () => {
    const { pending, history } = splitChangeRequestsForReviewQueue("hardware-committer", requests);

    expect(pending.some((request) => request.id === hardwareReviewRequest.id)).toBe(true);
    expect(history.some((request) => request.id === hardwareReviewRequest.id)).toBe(false);
  });

  it("moves advanced requests into history for hardware committer", () => {
    const advancedRequest = { ...hardwareReviewRequest, status: "软件Committer检视" as const };
    const queue = splitChangeRequestsForReviewQueue("hardware-committer", [advancedRequest]);

    expect(queue.pending).toHaveLength(0);
    expect(queue.history).toHaveLength(1);
    expect(isReviewHistoryForRole("hardware-committer", advancedRequest)).toBe(true);
    expect(canActOnReviewRequest("hardware-committer", advancedRequest)).toBe(false);
  });

  it("does not show earlier-stage requests in history for software committer", () => {
    expect(isReviewHistoryForRole("software-committer", hardwareReviewRequest)).toBe(false);
    expect(canActOnReviewRequest("software-committer", hardwareReviewRequest)).toBe(false);
  });

  it("shows software review requests in pending for software committer", () => {
    const advancedRequest = { ...hardwareReviewRequest, status: "软件Committer检视" as const };
    const { pending } = splitChangeRequestsForReviewQueue("software-committer", [advancedRequest]);

    expect(pending).toHaveLength(1);
    expect(canActOnReviewRequest("software-committer", advancedRequest)).toBe(true);
  });
});
