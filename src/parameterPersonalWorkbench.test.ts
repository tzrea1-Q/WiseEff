import { describe, expect, it } from "vitest";
import { deriveParameterHomepageAnalytics } from "./parameterHomepageAnalytics";
import { derivePersonalWorkbench } from "./parameterPersonalWorkbench";
import { initialState, type PrototypeState } from "./mockData";

function analyticsFor(state: PrototypeState = initialState) {
  return deriveParameterHomepageAnalytics(state, "30d", "overall");
}

describe("derivePersonalWorkbench", () => {
  it("puts real workflow actions before hotspot recommendations for a user", () => {
    const state: PrototypeState = {
      ...initialState,
      activeRoleId: "software-user",
      parameterSubmissionRounds: [
        {
          ...initialState.parameterSubmissionRounds[0],
          id: "PRS-user-draft",
          submitter: "Software User",
          status: "已暂存",
          summary: "还有 1 个参数修改草稿未提交。"
        },
        ...initialState.parameterSubmissionRounds
      ]
    };

    const workbench = derivePersonalWorkbench(state, analyticsFor(state));

    expect(workbench.roleView).toBe("user");
    expect(workbench.nextActions[0]).toMatchObject({
      kind: "todo",
      priority: "primary",
      title: "继续未提交的参数草稿"
    });
    expect(workbench.nextActions[0].path).toBe("/parameters");
    expect(workbench.nextActions.some((action) => action.kind === "recommendation")).toBe(true);
    expect(workbench.nextActions.findIndex((action) => action.kind === "todo")).toBeLessThan(
      workbench.nextActions.findIndex((action) => action.kind === "recommendation")
    );
  });

  it("generates hotspot recommendations when a user has no workflow todo", () => {
    const state: PrototypeState = {
      ...initialState,
      activeRoleId: "hardware-user",
      parameterSubmissionRounds: [],
      changeRequests: []
    };

    const workbench = derivePersonalWorkbench(state, analyticsFor(state));

    expect(workbench.roleView).toBe("user");
    expect(workbench.emptyState).toBe("recommendations");
    expect(workbench.nextActions[0]).toMatchObject({
      kind: "recommendation",
      priority: "primary"
    });
    expect(workbench.nextActions[0].path).toMatch(/^\/parameters/);
  });

  it("does not create software merge todos before users have an accessible merge action", () => {
    const state: PrototypeState = {
      ...initialState,
      activeRoleId: "software-user",
      parameterSubmissionRounds: [],
      changeRequests: [
        {
          ...initialState.changeRequests[0],
          id: "CR-user-software-merge",
          status: "软件User合入"
        }
      ]
    };

    const workbench = derivePersonalWorkbench(state, analyticsFor(state));
    const todoActions = workbench.nextActions.filter((action) => action.kind === "todo");

    expect(todoActions).toEqual([]);
    expect(workbench.nextActions).not.toContainEqual(
      expect.objectContaining({
        id: "user-software-merge",
        path: "/parameter-submissions"
      })
    );
  });

  it("does not treat committer-authored drafts as user workflow todos", () => {
    const state: PrototypeState = {
      ...initialState,
      activeRoleId: "software-user",
      changeRequests: [],
      parameterSubmissionRounds: [
        {
          ...initialState.parameterSubmissionRounds[0],
          id: "PRS-committer-draft",
          submitter: "Software Committer",
          status: "已暂存",
          summary: "Committer draft should not appear for a Software User."
        }
      ]
    };

    const workbench = derivePersonalWorkbench(state, analyticsFor(state));

    expect(workbench.emptyState).toBe("recommendations");
    expect(workbench.nextActions.every((action) => action.source !== "submission")).toBe(true);
  });

  it("drops actions that reference missing project or parameter data", () => {
    const state: PrototypeState = {
      ...initialState,
      activeRoleId: "software-user",
      parameterSubmissionRounds: [
        {
          ...initialState.parameterSubmissionRounds[0],
          id: "PRS-bad-reference",
          submitter: "Software User",
          status: "已暂存",
          projectId: "missing-project",
          items: [
            {
              ...initialState.parameterSubmissionRounds[0].items[0],
              parameterId: "missing-parameter"
            }
          ]
        }
      ]
    };

    const workbench = derivePersonalWorkbench(state, analyticsFor(state));

    expect(workbench.nextActions.some((action) => action.id.includes("PRS-bad-reference"))).toBe(false);
  });

  it("shows review actions for committers", () => {
    const state: PrototypeState = { ...initialState, activeRoleId: "hardware-committer" };

    const workbench = derivePersonalWorkbench(state, analyticsFor(state));

    expect(workbench.roleView).toBe("committer");
    expect(workbench.nextActions[0]).toMatchObject({
      kind: "todo",
      priority: "primary",
      title: "处理待审阅参数变更"
    });
    expect(workbench.nextActions[0].path).toBe("/parameter-review");
    expect(workbench.scenarioEntries.map((entry) => entry.title)).toContain("处理审阅");
  });

  it("does not create review todos for rejected work", () => {
    const state: PrototypeState = {
      ...initialState,
      activeRoleId: "hardware-committer",
      changeRequests: [
        {
          ...initialState.changeRequests[0],
          id: "CR-rejected-only",
          status: "已打回"
        }
      ],
      parameterInitializationReviews: []
    };

    const workbench = derivePersonalWorkbench(state, analyticsFor(state));

    expect(workbench.nextActions).not.toContainEqual(
      expect.objectContaining({
        id: "committer-review-queue",
        title: "处理待审阅参数变更"
      })
    );
    expect(workbench.emptyState).toBe("recommendations");
  });

  it("uses the current committer review candidates for the review scenario metric", () => {
    const state: PrototypeState = {
      ...initialState,
      activeRoleId: "hardware-committer",
      changeRequests: [
        {
          ...initialState.changeRequests[0],
          id: "CR-hardware-review",
          status: "硬件Committer检视"
        },
        {
          ...initialState.changeRequests[0],
          id: "CR-software-review",
          status: "软件Committer检视"
        },
        {
          ...initialState.changeRequests[0],
          id: "CR-rejected",
          status: "已打回"
        },
        {
          ...initialState.changeRequests[0],
          id: "CR-merged",
          status: "已合入"
        }
      ]
    };

    const workbench = derivePersonalWorkbench(state, analyticsFor(state));
    const reviewScenario = workbench.scenarioEntries.find((entry) => entry.id === "review");

    expect(reviewScenario).toMatchObject({
      metricLabel: "待审",
      metricValue: "1"
    });
  });

  it("shows direct management actions for admins without beginner governance copy", () => {
    const state: PrototypeState = { ...initialState, activeRoleId: "admin" };

    const workbench = derivePersonalWorkbench(state, analyticsFor(state));

    expect(workbench.roleView).toBe("admin");
    expect(workbench.scenarioEntries.map((entry) => entry.title)).toEqual([
      "管理后台",
      "新建项目",
      "用户管理"
    ]);
    expect(JSON.stringify(workbench)).not.toContain("我要治理");
  });

  it("keeps guests read-only and avoids review or admin destinations", () => {
    const state: PrototypeState = { ...initialState, activeRoleId: "guest" };

    const workbench = derivePersonalWorkbench(state, analyticsFor(state));

    expect(workbench.roleView).toBe("guest");
    expect(workbench.nextActions.every((action) => action.kind !== "todo")).toBe(true);
    expect(workbench.scenarioEntries.map((entry) => entry.path)).toEqual([
      "/parameters",
      "/parameter-home"
    ]);
    expect(JSON.stringify(workbench)).not.toContain("/parameter-review");
    expect(JSON.stringify(workbench)).not.toContain("/parameter-admin");
  });
});
