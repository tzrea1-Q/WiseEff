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
