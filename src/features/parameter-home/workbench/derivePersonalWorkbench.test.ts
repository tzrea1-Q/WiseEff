import { describe, expect, it } from "vitest";
import { derivePersonalWorkbench } from "./derivePersonalWorkbench";

const signals = {
  reviewQueue: 4,
  myDrafts: 2,
  returnedChanges: 1,
  waitingMerge: 3,
  unappliedImportBatches: 1,
  inactiveAccounts: 1
};

describe("derivePersonalWorkbench", () => {
  it("committer sees review-queue action first, insight second", () => {
    const vm = derivePersonalWorkbench({
      roleId: "hardware-committer",
      signals,
      changeRequests: [],
      drafts: [],
      projects: [],
      hotspots: []
    });
    expect(vm.emphasis).toBe("action-first");
    expect(vm.nextActions[0].title).toMatch(/审阅/);
  });

  it("keeps the selected project on user todo links", () => {
    const vm = derivePersonalWorkbench({
      roleId: "hardware-user",
      projectScope: "project-p",
      activeBindingCount: 1,
      signals,
      changeRequests: [],
      drafts: [],
      projects: [],
      hotspots: []
    });

    expect(vm.nextActions[0]?.path).toBe("/parameters?project=project-p");
    expect(vm.scenarioEntries.find((entry) => entry.id === "edit")).toMatchObject({
      metricLabel: "参数",
      metricValue: "1",
      path: "/parameters?project=project-p"
    });
    expect(vm.scenarioEntries.find((entry) => entry.id === "submissions")).toMatchObject({
      metricLabel: "草稿",
      metricValue: "2",
      path: "/parameters?project=project-p"
    });
  });

  it("keeps a missing canonical Binding count unavailable", () => {
    const vm = derivePersonalWorkbench({
      roleId: "hardware-user",
      projectScope: "project-p",
      signals,
      projects: [],
      hotspots: []
    });

    expect(vm.scenarioEntries.find((entry) => entry.id === "edit")).toMatchObject({
      metricLabel: "参数",
      metricValue: "不可用"
    });
  });

  it("does not turn stale or failed hotspots into a zero recommendation", () => {
    const hotspot = {
      id: "project:project-p",
      kind: "project" as const,
      title: "Project P",
      projectCode: "P",
      module: "项目参数",
      statusLabel: "需要关注",
      statusLevel: "watch" as const,
      score: 10,
      scoreBreakdown: { frequency: 1, scope: 1, workflow: 1, collaboration: 1 },
      evidence: [],
      trendDelta: 0,
      trendDirection: "flat" as const,
      suggestedPath: "/parameters?project=project-p"
    };
    const vm = derivePersonalWorkbench({
      roleId: "hardware-user",
      projectScope: "project-p",
      activeBindingCount: 1,
      hotspotsStatus: "error",
      signals: { ...signals, myDrafts: 0, returnedChanges: 0, waitingMerge: 0 },
      projects: [],
      hotspots: [hotspot]
    });

    expect(vm.nextActions.some((action) => action.id === "hotspot-project:project-p")).toBe(false);
    expect(vm.scenarioEntries.find((entry) => entry.id === "hotspots")?.metricValue).toBe("不可用");
  });

  it("admin emphasis is insight-first and has no beginner governance entry", () => {
    const vm = derivePersonalWorkbench({
      roleId: "admin",
      signals,
      changeRequests: [],
      drafts: [],
      projects: [],
      hotspots: []
    });
    expect(vm.emphasis).toBe("insight-first");
    expect(vm.scenarioEntries.some((entry) => /我要治理/.test(entry.title))).toBe(false);
  });

  it("preserves a known hotspot project when changing the destination for the user's role", () => {
    const hotspot = {
      id: "parameter:binding-p", kind: "parameter" as const, title: "Binding P",
      projectId: "project-p", projectCode: "P", module: "Configuration",
      statusLabel: "正常", statusLevel: "normal" as const, score: 0,
      scoreBreakdown: { frequency: 0, scope: 0, workflow: 0, collaboration: 0 },
      evidence: [], trendDelta: 0, trendDirection: "flat" as const,
      suggestedPath: "/parameter-review?project=project-p"
    };
    const vm = derivePersonalWorkbench({
      roleId: "software-user", projectScope: null,
      signals, projects: [], hotspots: [hotspot]
    });
    expect(vm.nextActions.find((action) => action.source === "hotspot")?.path).toBe("/parameters?project=project-p");
  });

  it("guest gets read-only entries only", () => {
    const vm = derivePersonalWorkbench({
      roleId: "guest",
      signals,
      changeRequests: [],
      drafts: [],
      projects: [],
      hotspots: []
    });
    expect(vm.nextActions.every((action) => action.kind !== "todo")).toBe(true);
  });
});
