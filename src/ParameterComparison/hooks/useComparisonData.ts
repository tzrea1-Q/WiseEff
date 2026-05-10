import type { PrototypeState } from "../../mockData";
import { parseNumeric } from "../utils/deltaCalc";
import { sortComparisonRows } from "../utils/rowSort";
import type { ComparisonFilters, ComparisonRow } from "../types";

export type ComparisonMetrics = {
  total: number;
  drift: number;
  synced: number;
  highRisk: number;
};

export type UseComparisonDataInput = {
  state: PrototypeState;
  baseProjectId: string;
  targetProjectId: string;
  filters: ComparisonFilters;
};

function formatValue(value: string | null, unit: string) {
  if (value === null || value.trim() === "") {
    return "未配置";
  }

  return `${value} ${unit}`.trim();
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function matchesQuery(row: ComparisonRow, query: string) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return true;
  }

  return [row.key, row.module, row.description, row.baseValue, row.targetValue].some((value) =>
    normalize(value).includes(normalizedQuery)
  );
}

export function useComparisonData({ state, baseProjectId, targetProjectId, filters }: UseComparisonDataInput) {
  const baseParameters = state.parameters.filter((parameter) => parameter.projectId === baseProjectId);
  const targetParameters = state.parameters.filter((parameter) => parameter.projectId === targetProjectId);
  const targetByName = new Map(targetParameters.map((parameter) => [parameter.name, parameter]));

  const rows = sortComparisonRows(
    baseParameters.map((baseParameter) => {
      const targetParameter = targetByName.get(baseParameter.name);
      const targetValue = targetParameter?.currentValue ?? null;
      const status = targetParameter && targetParameter.currentValue === baseParameter.currentValue ? "synced" : "drift";

      return {
        key: baseParameter.name,
        module: baseParameter.module,
        description: baseParameter.description,
        baseValue: formatValue(baseParameter.currentValue, baseParameter.unit),
        targetValue: formatValue(targetValue, targetParameter?.unit ?? baseParameter.unit),
        baseNumeric: parseNumeric(baseParameter.currentValue),
        targetNumeric: parseNumeric(targetValue),
        unit: baseParameter.unit,
        status,
        risk: baseParameter.risk
      };
    })
  );

  const filteredRows = rows.filter(
    (row) =>
      (!filters.driftOnly || row.status === "drift") &&
      (filters.risk.length === 0 || filters.risk.includes(row.risk)) &&
      (filters.modules.length === 0 || filters.modules.includes(row.module)) &&
      matchesQuery(row, filters.query)
  );

  return {
    rows,
    filteredRows,
    moduleOptions: Array.from(new Set(rows.map((row) => row.module))).sort((left, right) => left.localeCompare(right)),
    metrics: {
      total: rows.length,
      drift: rows.filter((row) => row.status === "drift").length,
      synced: rows.filter((row) => row.status === "synced").length,
      highRisk: rows.filter((row) => row.status === "drift" && row.risk === "High").length
    } satisfies ComparisonMetrics
  };
}
