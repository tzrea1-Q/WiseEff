// Hotspot presentation-layer derivations: archetype, status, trend, action templates.
// Pure functions only; no React imports.

import type { PrototypeState } from "./mockData";
import type { HomepageTimeWindow, HotspotScoreBreakdown, ParameterHotspot } from "./parameterHomepageAnalytics";

export type HotspotStatusLevel = "alert" | "watch" | "healthy";

export type HotspotArchetype =
  | "risk-heavy"
  | "drift-anomaly"
  | "workflow-stuck"
  | "change-surge"
  | "impact-wide";

export type HotspotTrend = {
  delta: number;
  direction: "up" | "down" | "flat";
};

export type HotspotActionSpec = {
  label: string;
  path: string;
};

export type HotspotActionPair = {
  primary: HotspotActionSpec;
  secondary?: HotspotActionSpec;
};

type ActionTemplate = {
  labelTemplate: string;
  pathTemplate: string;
};

type ArchetypeActions = {
  primary: ActionTemplate;
  secondary?: ActionTemplate;
};

export const HOTSPOT_ACTION_TEMPLATES: Record<HotspotArchetype, ArchetypeActions> = {
  "risk-heavy": {
    primary: {
      labelTemplate: "创建高风险专项审阅 · {highRiskCount} 项",
      pathTemplate: "/parameter-review?filter=high-risk&module={module}"
    },
    secondary: {
      labelTemplate: "查看 {module} 推荐值对比",
      pathTemplate: "/parameter-comparison?module={module}"
    }
  },
  "drift-anomaly": {
    primary: {
      labelTemplate: "查看 {module} 漂移详情",
      pathTemplate: "/parameter-comparison?module={module}&highlight=drift"
    },
    secondary: {
      labelTemplate: "订阅偏离告警",
      pathTemplate: "/parameter-admin?tab=alerts"
    }
  },
  "workflow-stuck": {
    primary: {
      labelTemplate: "进入审阅队列",
      pathTemplate: "/parameter-review"
    },
    secondary: {
      labelTemplate: "查看等待合并清单",
      pathTemplate: "/parameter-review?filter=waiting-merge"
    }
  },
  "change-surge": {
    primary: {
      labelTemplate: "打开 {module} 变更历史",
      pathTemplate: "/parameters?module={module}&tab=history"
    },
    secondary: {
      labelTemplate: "查看 {projectCode} 近期改动",
      pathTemplate: "/logs?project={projectCode}"
    }
  },
  "impact-wide": {
    primary: {
      labelTemplate: "查看跨项目定义使用",
      pathTemplate: "/parameter-comparison?module={module}"
    },
    secondary: {
      labelTemplate: "打开参数定义库",
      pathTemplate: "/parameter-admin?tab=definitions"
    }
  }
};

const TIE_BREAK_ORDER: Array<keyof HotspotScoreBreakdown> = ["risk", "drift", "workflow", "frequency", "impact"];

export function mapHotspotStatus(
  hotspot: Pick<ParameterHotspot, "highRiskCount" | "score">
): { level: HotspotStatusLevel; label: string } {
  if (hotspot.highRiskCount >= 5 || hotspot.score >= 180) {
    return { level: "alert", label: "需要关注" };
  }
  if (hotspot.highRiskCount >= 2 || hotspot.score >= 120) {
    return { level: "watch", label: "持续观察" };
  }
  return { level: "healthy", label: "健康" };
}

export function deriveHotspotTrend(
  hotspot: Pick<ParameterHotspot, "id">,
  timeWindow: HomepageTimeWindow
): HotspotTrend {
  const seed = hashString(`${hotspot.id}|${timeWindow}`);
  const rng = createLcg(seed);
  const delta = Math.round((rng() * 2 - 1) * 25);

  if (Math.abs(delta) < 5) {
    return { delta, direction: "flat" };
  }
  return { delta, direction: delta > 0 ? "up" : "down" };
}

export function classifyHotspotArchetype(hotspot: Pick<ParameterHotspot, "scoreBreakdown">): HotspotArchetype {
  const entries = Object.entries(hotspot.scoreBreakdown) as Array<[keyof HotspotScoreBreakdown, number]>;
  const max = Math.max(...entries.map(([, value]) => value));

  if (max === 0) {
    return "risk-heavy";
  }

  const winners = entries.filter(([, value]) => value === max).map(([key]) => key);
  return archetypeForDimension(TIE_BREAK_ORDER.find((key) => winners.includes(key)) ?? "risk");
}

export function generateHotspotActions(
  hotspot: Pick<ParameterHotspot, "module" | "projectCode" | "highRiskCount" | "changeCount" | "title" | "scoreBreakdown">
): HotspotActionPair {
  const templates = HOTSPOT_ACTION_TEMPLATES[classifyHotspotArchetype(hotspot)];

  return {
    primary: renderActionTemplate(templates.primary, hotspot),
    ...(templates.secondary ? { secondary: renderActionTemplate(templates.secondary, hotspot) } : {})
  };
}

export function computeEyebrow(
  hotspot: Pick<ParameterHotspot, "module" | "projectCode" | "lastChangedAt">,
  state: Pick<PrototypeState, "parameters">
): string {
  if (hotspot.module !== "项目参数") {
    const projectCount = new Set(
      state.parameters.filter((parameter) => parameter.module === hotspot.module).map((parameter) => parameter.projectId)
    ).size;

    return `${hotspot.projectCode} · ${projectCount} 项目`;
  }

  return hotspot.lastChangedAt ? `最近变更 ${hotspot.lastChangedAt}` : "多次变更";
}

function renderActionTemplate(
  template: ActionTemplate,
  hotspot: Pick<ParameterHotspot, "module" | "projectCode" | "highRiskCount" | "changeCount" | "title">
): HotspotActionSpec {
  const slots: Record<string, string> = {
    module: hotspot.module,
    projectCode: hotspot.projectCode,
    highRiskCount: String(hotspot.highRiskCount),
    changeCount: String(hotspot.changeCount),
    title: hotspot.title
  };
  const fillLabel = fillTemplate(template.labelTemplate, slots, false).replace(/\s*·\s*0 项$/, "");
  const fillPath = fillTemplate(template.pathTemplate, slots, true);

  return { label: fillLabel, path: fillPath };
}

function fillTemplate(template: string, slots: Record<string, string>, encode: boolean): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = slots[key] ?? "";
    return encode ? encodeURIComponent(value) : value;
  });
}

function archetypeForDimension(dimension: keyof HotspotScoreBreakdown): HotspotArchetype {
  switch (dimension) {
    case "risk":
      return "risk-heavy";
    case "drift":
      return "drift-anomaly";
    case "workflow":
      return "workflow-stuck";
    case "frequency":
      return "change-surge";
    case "impact":
      return "impact-wide";
  }
}

function hashString(input: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

function createLcg(seed: number): () => number {
  let state = seed >>> 0 || 1;

  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
