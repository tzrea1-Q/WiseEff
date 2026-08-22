import { describe, expect, it } from "vitest";
import {
  BEHAVIORAL_WINDOW_PROFILES,
  buildBehavioralHotspotEvidence,
  mapBehavioralHotspotStatus,
  scoreBehavioralHotspot
} from "./projectHotspotScoring";

describe("projectHotspotScoring", () => {
  const baseInput = {
    historyEventsInWindow: 12,
    changeRequestsInWindow: 4,
    modifiedParamCount: 30,
    totalParamCount: 200,
    openRequestCount: 2,
    returnedInWindow: 1,
    contributorsInWindow: 3,
    contributorsAllTime: 5
  };

  it("sums the four behavioral dimensions into score", () => {
    const scored = scoreBehavioralHotspot(baseInput, BEHAVIORAL_WINDOW_PROFILES["30d"]);
    const total = scored.frequency + scored.scope + scored.workflow + scored.collaboration;
    expect(scored.score).toBeCloseTo(Math.round(total * 10) / 10);
    expect(scored).not.toHaveProperty("risk");
    expect(scored).not.toHaveProperty("drift");
  });

  it("maps project status from score and workflow signals", () => {
    const quietProject = { ...baseInput, modifiedParamCount: 5, totalParamCount: 200, openRequestCount: 0, changeRequestsInWindow: 0 };
    const activeProject = { ...baseInput, modifiedParamCount: 5, totalParamCount: 200, openRequestCount: 0 };
    expect(mapBehavioralHotspotStatus({ ...quietProject, score: 50 }).label).toBe("正常");
    expect(mapBehavioralHotspotStatus({ ...activeProject, score: 120, changeRequestsInWindow: 0 }).label).toBe("偏高");
    expect(mapBehavioralHotspotStatus({ ...baseInput, score: 200, openRequestCount: 0 }).label).toBe("需要关注");
  });

  it("builds evidence without risk or drift", () => {
    const evidence = buildBehavioralHotspotEvidence(baseInput);
    expect(evidence[0]).toContain("累计修改 30 / 200");
    expect(evidence[1]).toContain("窗口内 12 次参数变更");
    expect(evidence[2]).toContain("待处理流程 2 项");
  });

  it("builds parameter evidence with project modification scope", () => {
    const evidence = buildBehavioralHotspotEvidence(
      { ...baseInput, modifiedParamCount: 2, totalParamCount: 5 },
      "parameter"
    );
    expect(evidence[0]).toContain("已在 2 / 5 个项目中修改（40%）");
  });
});
