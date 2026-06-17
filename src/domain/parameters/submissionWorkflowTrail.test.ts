import { describe, expect, it } from "vitest";

import { buildSubmissionWorkflowTrail } from "./submissionWorkflowTrail";
import type { ParameterReviewDecisionRecord } from "./types";

const users = [
  { id: "u-hw", name: "王杰" },
  { id: "u-sw", name: "孙梅" },
  { id: "u-dev", name: "陈娜" }
];

const workflowAssignees = {
  hardwareCommitterId: "u-hw",
  softwareCommitterId: "u-sw",
  softwareUserId: "u-dev"
};

function resolveUserName(userId?: string) {
  if (!userId) {
    return "未指派";
  }
  return users.find((user) => user.id === userId)?.name ?? userId;
}

describe("buildSubmissionWorkflowTrail", () => {
  it("shows designated assignees and completed executors for finished stages", () => {
    const reviewDecisions: ParameterReviewDecisionRecord[] = [
      {
        id: "d-1",
        requestId: "PRQ-1",
        reviewerUserId: "u-hw",
        decision: "advance",
        fromStatus: "hardware_review",
        toStatus: "software_review",
        createdAt: "2026-06-17T03:00:00.000Z"
      },
      {
        id: "d-2",
        requestId: "PRQ-1",
        reviewerUserId: "u-sw",
        decision: "advance",
        fromStatus: "software_review",
        toStatus: "software_merge",
        createdAt: "2026-06-17T03:10:00.000Z"
      }
    ];

    const trail = buildSubmissionWorkflowTrail({
      activeIndex: 4,
      workflowAssignees,
      requestIds: ["PRQ-1"],
      changeRequests: [{ id: "PRQ-1", assignedTo: "u-dev", status: "软件User合入" }],
      reviewDecisions,
      resolveUserName
    });

    expect(trail).toHaveLength(3);
    expect(trail[0]).toMatchObject({
      key: "hardware_review",
      assigneeName: "王杰",
      executorName: "王杰",
      executorLabel: "执行人",
      state: "completed"
    });
    expect(trail[1]).toMatchObject({
      key: "software_review",
      assigneeName: "孙梅",
      executorName: "孙梅",
      state: "completed"
    });
    expect(trail[2]).toMatchObject({
      key: "software_merge",
      assigneeName: "陈娜",
      executorLabel: "当前处理",
      state: "active",
      executorName: "陈娜"
    });
  });

  it("marks hardware review as skipped when low-risk path bypasses hardware stage", () => {
    const reviewDecisions: ParameterReviewDecisionRecord[] = [
      {
        id: "d-1",
        requestId: "PRQ-1",
        reviewerUserId: "u-sw",
        decision: "advance",
        fromStatus: "submitted",
        toStatus: "software_review",
        createdAt: "2026-06-17T03:00:00.000Z"
      }
    ];

    const trail = buildSubmissionWorkflowTrail({
      activeIndex: 3,
      workflowAssignees,
      requestIds: ["PRQ-1"],
      changeRequests: [{ id: "PRQ-1", assignedTo: "u-sw", status: "软件Committer检视" }],
      reviewDecisions,
      resolveUserName
    });

    expect(trail[0]).toMatchObject({
      key: "hardware_review",
      state: "skipped"
    });
    expect(trail[1]).toMatchObject({
      key: "software_review",
      state: "active",
      executorName: "孙梅",
      executorLabel: "当前处理"
    });
  });

  it("aggregates multiple executors for the same stage", () => {
    const reviewDecisions: ParameterReviewDecisionRecord[] = [
      {
        id: "d-1",
        requestId: "PRQ-1",
        reviewerUserId: "u-hw",
        decision: "advance",
        fromStatus: "hardware_review",
        toStatus: "software_review",
        createdAt: "2026-06-17T03:00:00.000Z"
      },
      {
        id: "d-2",
        requestId: "PRQ-2",
        reviewerUserId: "u-sw",
        decision: "advance",
        fromStatus: "hardware_review",
        toStatus: "software_review",
        createdAt: "2026-06-17T03:05:00.000Z"
      }
    ];

    const trail = buildSubmissionWorkflowTrail({
      activeIndex: 3,
      workflowAssignees,
      requestIds: ["PRQ-1", "PRQ-2"],
      changeRequests: [],
      reviewDecisions,
      resolveUserName
    });

    expect(trail[0].executorName).toBe("王杰 等 2 人");
  });
});
