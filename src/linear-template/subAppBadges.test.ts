import { describe, expect, it } from "vitest";
import type { PrototypeState } from "../mockData";
import { initialState } from "../mockData";
import { deriveSubAppBadges } from "./subAppBadges";

describe("deriveSubAppBadges", () => {
  it("counts pending parameter change requests for the parameter management card", () => {
    const badges = deriveSubAppBadges(initialState);

    expect(badges.parameterManagement).toEqual({ count: 1, label: "1 条待审阅" });
  });

  it("counts completed logs for the log analysis card", () => {
    const badges = deriveSubAppBadges(initialState);

    expect(badges.logAnalysis).toEqual({ count: 1, label: "已分析 1 份" });
  });

  it("counts connected devices for the parameter debugging card", () => {
    const badges = deriveSubAppBadges(initialState);

    expect(badges.parameterDebugging).toEqual({ count: 1, label: "1 台样机在线" });
  });

  it("returns empty labels when counts are zero", () => {
    const emptyState: PrototypeState = {
      ...initialState,
      changeRequests: [],
      parameterSubmissionRounds: [],
      logs: [],
      devices: []
    };
    const badges = deriveSubAppBadges(emptyState);

    expect(badges.parameterManagement).toEqual({ count: 0, label: "暂无待办" });
    expect(badges.logAnalysis).toEqual({ count: 0, label: "暂无记录" });
    expect(badges.parameterDebugging).toEqual({ count: 0, label: "暂无在线设备" });
  });
});
