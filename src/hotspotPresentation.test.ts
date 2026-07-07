import { describe, expect, it } from "vitest";
import type { PrototypeState } from "./mockData";
import type { DashboardWindow, HotspotScoreBreakdown } from "@/domain/parameters/dashboardTypes";
import {
  classifyHotspotArchetype,
  computeEyebrow,
  deriveHotspotTrend,
  generateHotspotActions,
  HOTSPOT_ACTION_TEMPLATES,
  mapHotspotStatus
} from "./hotspotPresentation";
import type {
  HotspotActionPair,
  HotspotArchetype,
  HotspotStatusLevel,
  HotspotTrend
} from "./hotspotPresentation";

function makeHotspot(
  over: Partial<{
    id: string;
    title: string;
    projectCode: string;
    module: string;
    highRiskCount: number;
    changeCount: number;
    score: number;
    scoreBreakdown: HotspotScoreBreakdown;
    lastChangedAt: string;
  }> = {}
) {
  return {
    id: "h-1",
    title: "Charging Policy",
    projectCode: "AUR-Prod",
    module: "Charging Policy",
    status: "",
    changeCount: 0,
    highRiskCount: 0,
    score: 0,
    scoreBreakdown: { frequency: 0, risk: 0, impact: 0, workflow: 0, drift: 0 },
    explanation: "",
    evidence: [],
    suggestedAction: "",
    suggestedPath: "/",
    ...over
  };
}

function withBreakdown(over: Partial<HotspotScoreBreakdown>) {
  return makeHotspot({
    scoreBreakdown: {
      frequency: 0,
      risk: 0,
      impact: 0,
      workflow: 0,
      drift: 0,
      ...over
    }
  });
}

describe("hotspotPresentation type exports", () => {
  it("exports the presentation union types", () => {
    const levels: HotspotStatusLevel[] = ["alert", "watch", "healthy"];
    const archetypes: HotspotArchetype[] = [
      "risk-heavy",
      "drift-anomaly",
      "workflow-stuck",
      "change-surge",
      "impact-wide"
    ];
    const trend: HotspotTrend = { delta: 0, direction: "flat" };
    const pair: HotspotActionPair = { primary: { label: "A", path: "/a" } };

    expect(levels).toHaveLength(3);
    expect(archetypes).toHaveLength(5);
    expect(trend.direction).toBe("flat");
    expect(pair.secondary).toBeUndefined();
  });
});

describe("mapHotspotStatus", () => {
  it("maps alert, watch, and healthy thresholds", () => {
    expect(mapHotspotStatus(makeHotspot({ highRiskCount: 5 }))).toEqual({ level: "alert", label: "需要关注" });
    expect(mapHotspotStatus(makeHotspot({ score: 220 }))).toEqual({ level: "alert", label: "需要关注" });
    expect(mapHotspotStatus(makeHotspot({ highRiskCount: 3, score: 140 }))).toEqual({ level: "watch", label: "持续观察" });
    expect(mapHotspotStatus(makeHotspot({ score: 150 }))).toEqual({ level: "watch", label: "持续观察" });
    expect(mapHotspotStatus(makeHotspot({ highRiskCount: 1, score: 80 }))).toEqual({ level: "healthy", label: "健康" });
  });
});

describe("deriveHotspotTrend", () => {
  it("is deterministic and bounded for each time window", () => {
    const hotspot = makeHotspot({ id: "hotspot-a" });

    expect(deriveHotspotTrend(hotspot, "30d")).toEqual(deriveHotspotTrend(hotspot, "30d"));

    for (const win of ["7d", "30d", "180d"] as DashboardWindow[]) {
      const trend = deriveHotspotTrend(hotspot, win);

      expect(trend.delta).toBeGreaterThanOrEqual(-25);
      expect(trend.delta).toBeLessThanOrEqual(25);
      if (trend.direction === "flat") {
        expect(Math.abs(trend.delta)).toBeLessThan(5);
      }
      if (trend.direction === "up") {
        expect(trend.delta).toBeGreaterThan(0);
      }
      if (trend.direction === "down") {
        expect(trend.delta).toBeLessThan(0);
      }
    }
  });

  it("changes when the time window changes for at least one sample", () => {
    const ids = Array.from({ length: 12 }, (_, index) => `trend-${index}`);
    const sevenDays = ids.map((id) => deriveHotspotTrend(makeHotspot({ id }), "7d").delta);
    const oneHundredEightyDays = ids.map((id) => deriveHotspotTrend(makeHotspot({ id }), "180d").delta);

    expect(sevenDays).not.toEqual(oneHundredEightyDays);
  });
});

describe("classifyHotspotArchetype", () => {
  it("maps the dominant dimension to an archetype", () => {
    expect(classifyHotspotArchetype(withBreakdown({ risk: 50, frequency: 10 }))).toBe("risk-heavy");
    expect(classifyHotspotArchetype(withBreakdown({ drift: 40, workflow: 10 }))).toBe("drift-anomaly");
    expect(classifyHotspotArchetype(withBreakdown({ workflow: 40, frequency: 10 }))).toBe("workflow-stuck");
    expect(classifyHotspotArchetype(withBreakdown({ frequency: 40, impact: 10 }))).toBe("change-surge");
    expect(classifyHotspotArchetype(withBreakdown({ impact: 40 }))).toBe("impact-wide");
  });

  it("breaks ties by risk, drift, workflow, frequency, impact", () => {
    expect(classifyHotspotArchetype(withBreakdown({ frequency: 30, risk: 30, impact: 30, workflow: 30, drift: 30 }))).toBe(
      "risk-heavy"
    );
    expect(classifyHotspotArchetype(withBreakdown({ risk: 0, drift: 30, workflow: 30, frequency: 30, impact: 30 }))).toBe(
      "drift-anomaly"
    );
    expect(classifyHotspotArchetype(withBreakdown({ risk: 0, drift: 0, workflow: 30, frequency: 30, impact: 30 }))).toBe(
      "workflow-stuck"
    );
    expect(classifyHotspotArchetype(withBreakdown({ risk: 0, drift: 0, workflow: 0, frequency: 30, impact: 30 }))).toBe(
      "change-surge"
    );
    expect(classifyHotspotArchetype(withBreakdown({}))).toBe("risk-heavy");
  });
});

describe("generateHotspotActions", () => {
  it("has templates for every archetype", () => {
    for (const archetype of ["risk-heavy", "drift-anomaly", "workflow-stuck", "change-surge", "impact-wide"] as HotspotArchetype[]) {
      expect(HOTSPOT_ACTION_TEMPLATES[archetype].primary).toBeDefined();
    }
  });

  it("fills slots and trims zero-count action suffixes", () => {
    const riskAction = generateHotspotActions(
      makeHotspot({
        highRiskCount: 6,
        scoreBreakdown: { frequency: 0, risk: 100, impact: 0, workflow: 0, drift: 0 }
      })
    );
    const driftAction = generateHotspotActions(
      makeHotspot({
        scoreBreakdown: { frequency: 0, risk: 0, impact: 0, workflow: 0, drift: 100 }
      })
    );
    const zeroRiskAction = generateHotspotActions(
      makeHotspot({
        highRiskCount: 0,
        scoreBreakdown: { frequency: 0, risk: 100, impact: 0, workflow: 0, drift: 0 }
      })
    );

    expect(riskAction.primary.label).toBe("创建高风险专项审阅 · 6 项");
    expect(riskAction.primary.path).toBe("/parameter-review?filter=high-risk&module=Charging%20Policy");
    expect(riskAction.secondary?.label).toBe("查看 Charging Policy 推荐值对比");
    expect(riskAction.secondary?.path).toBe("/parameters?module=Charging%20Policy");
    expect(driftAction.primary.path).toBe("/parameters?module=Charging%20Policy&highlight=drift");
    expect(driftAction.primary.path).toContain("highlight=drift");
    expect(zeroRiskAction.primary.label).toBe("创建高风险专项审阅");
    for (const action of [riskAction.primary, riskAction.secondary, driftAction.primary, zeroRiskAction.primary].filter(Boolean)) {
      expect(action?.label).not.toMatch(/[{}]/);
      expect(action?.path).not.toMatch(/[{}]/);
      expect(action?.path).not.toContain("/parameter-comparison");
    }
  });
});

describe("computeEyebrow", () => {
  it("shows project coverage for module hotspots and recent change for project hotspots", () => {
    const state = {
      parameters: [
        { module: "Charging Policy", projectId: "aurora" },
        { module: "Charging Policy", projectId: "nebula" },
        { module: "Battery Safety", projectId: "aurora" }
      ]
    } as Pick<PrototypeState, "parameters">;

    expect(computeEyebrow(makeHotspot({ module: "Charging Policy", projectCode: "2 个项目" }), state)).toBe("2 个项目 · 2 项目");
    expect(computeEyebrow(makeHotspot({ module: "项目参数", projectCode: "AUR-Prod", lastChangedAt: "36 分钟前" }), state)).toBe(
      "最近变更 36 分钟前"
    );
    expect(computeEyebrow(makeHotspot({ module: "项目参数", projectCode: "AUR-Prod" }), state)).toBe("多次变更");
  });
});
