import type { RiskLevel } from "../mockData";

export type ComparisonRowStatus = "drift" | "synced";

export type ComparisonRow = {
  key: string;
  module: string;
  description: string;
  baseValue: string;
  targetValue: string;
  baseNumeric: number | null;
  targetNumeric: number | null;
  unit: string;
  status: ComparisonRowStatus;
  risk: RiskLevel;
  structuredDiff?: { before: Record<string, unknown>; after: Record<string, unknown> };
};

export type ComparisonProjectSelection = {
  baseProjectId: string;
  targetProjectId: string;
};

export type RiskFilter = "All" | RiskLevel;

export type ComparisonFilters = {
  driftOnly: boolean;
  risk: RiskLevel[];
  modules: string[];
  query: string;
};
