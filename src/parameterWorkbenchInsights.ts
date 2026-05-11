import type { ParameterRecord, PrototypeState, RiskLevel } from "./mockData";

export type ParameterInsightItem = {
  id: string;
  projectId: string;
  name: string;
  module: string;
  currentValue: string;
  recommendedValue: string;
  unit: string;
  risk: RiskLevel;
  driftLabel: string;
  driftMagnitude: number;
};

export type ParameterWorkbenchInsightSnapshot = {
  driftedCount: number;
  highRiskCount: number;
  mediumRiskCount: number;
  topParameters: ParameterInsightItem[];
};

const riskRank: Record<RiskLevel, number> = {
  High: 3,
  Medium: 2,
  Low: 1
};

export function getParameterDriftMagnitude(parameter: ParameterRecord): number {
  const current = Number.parseFloat(parameter.currentValue);
  const recommended = Number.parseFloat(parameter.recommendedValue);

  if (!Number.isFinite(current) || !Number.isFinite(recommended)) {
    return parameter.currentValue === parameter.recommendedValue ? 0 : 25;
  }

  const baseline = Math.max(Math.abs(current), 1);
  return Math.round((Math.abs(recommended - current) / baseline) * 1000) / 10;
}

export function getParameterDriftLabel(parameter: ParameterRecord): string {
  const current = Number.parseFloat(parameter.currentValue);
  const recommended = Number.parseFloat(parameter.recommendedValue);

  if (!Number.isFinite(current) || !Number.isFinite(recommended)) {
    return parameter.currentValue === parameter.recommendedValue ? "一致" : "配置不同";
  }

  if (current === recommended) {
    return "0%";
  }

  const baseline = Math.max(Math.abs(current), 1);
  const signed = ((recommended - current) / baseline) * 100;
  return `${signed > 0 ? "+" : ""}${signed.toFixed(1)}%`;
}

export function deriveParameterWorkbenchInsightSnapshot(
  state: PrototypeState,
  activeProjectId: string,
  limit = 3
): ParameterWorkbenchInsightSnapshot {
  const driftedRows = state.parameters
    .filter((parameter) => parameter.projectId === activeProjectId)
    .filter((parameter) => parameter.currentValue !== parameter.recommendedValue)
    .map((parameter): ParameterInsightItem => ({
      id: parameter.id,
      projectId: parameter.projectId,
      name: parameter.name,
      module: parameter.module,
      currentValue: parameter.currentValue,
      recommendedValue: parameter.recommendedValue,
      unit: parameter.unit,
      risk: parameter.risk,
      driftLabel: getParameterDriftLabel(parameter),
      driftMagnitude: getParameterDriftMagnitude(parameter)
    }))
    .sort((left, right) => {
      const riskDelta = riskRank[right.risk] - riskRank[left.risk];
      if (riskDelta !== 0) {
        return riskDelta;
      }
      return right.driftMagnitude - left.driftMagnitude;
    });

  return {
    driftedCount: driftedRows.length,
    highRiskCount: driftedRows.filter((row) => row.risk === "High").length,
    mediumRiskCount: driftedRows.filter((row) => row.risk === "Medium").length,
    topParameters: driftedRows.slice(0, limit)
  };
}
