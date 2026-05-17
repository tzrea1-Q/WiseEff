import { buildComparisonData, type ComparisonMetrics } from "@/domain/parameters/comparison";
import type { PrototypeState } from "../../mockData";
import type { ComparisonFilters } from "../types";

export type { ComparisonMetrics };

export type UseComparisonDataInput = {
  state: PrototypeState;
  baseProjectId: string;
  targetProjectId: string;
  filters: ComparisonFilters;
};

export function useComparisonData({ state, baseProjectId, targetProjectId, filters }: UseComparisonDataInput) {
  return buildComparisonData({ parameters: state.parameters, baseProjectId, targetProjectId, filters });
}
