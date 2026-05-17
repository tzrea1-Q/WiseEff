import { useMemo } from "react";
import { projects, type PrototypeState } from "@/mockData";
import { buildComparisonData } from "@/domain/parameters/comparison";
import type { ComparisonFilters, ComparisonProjectSelection } from "@/ParameterComparison/types";

export type ParameterComparisonViewModelInput = {
  state: PrototypeState;
  comparisonSelection: ComparisonProjectSelection;
  filters: ComparisonFilters;
};

export function fallbackComparisonProjectId(projectId: string) {
  return projects.find((project) => project.id !== projectId)?.id ?? projectId;
}

export function buildParameterComparisonViewModel({ state, comparisonSelection, filters }: ParameterComparisonViewModelInput) {
  const baseProject = projects.find((project) => project.id === comparisonSelection.baseProjectId) ?? projects[0];
  const targetProject = projects.find((project) => project.id === comparisonSelection.targetProjectId) ?? projects[1] ?? projects[0];
  const comparisonData = buildComparisonData({
    parameters: state.parameters,
    baseProjectId: baseProject.id,
    targetProjectId: targetProject.id,
    filters
  });
  return { projects, baseProject, targetProject, comparisonData };
}

export function useParameterComparisonViewModel(input: ParameterComparisonViewModelInput) {
  return useMemo(
    () => buildParameterComparisonViewModel(input),
    [
      input.comparisonSelection.baseProjectId,
      input.comparisonSelection.targetProjectId,
      input.filters.driftOnly,
      input.filters.modules,
      input.filters.query,
      input.filters.risk,
      input.state.parameters
    ]
  );
}
