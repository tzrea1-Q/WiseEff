import { describe, expect, it } from "vitest";
import { initialState, projects } from "@/mockData";
import {
  buildParameterComparisonViewModel,
  fallbackComparisonProjectId
} from "./useParameterComparisonViewModel";

describe("buildParameterComparisonViewModel", () => {
  it("selects base and target projects and derives nonempty filtered rows", () => {
    const viewModel = buildParameterComparisonViewModel({
      state: initialState,
      comparisonSelection: {
        baseProjectId: projects[0].id,
        targetProjectId: projects[1].id
      },
      filters: {
        driftOnly: false,
        modules: [],
        query: "",
        risk: []
      }
    });

    expect(viewModel.baseProject).toBe(projects[0]);
    expect(viewModel.targetProject).toBe(projects[1]);
    expect(viewModel.comparisonData.filteredRows.length).toBeGreaterThan(0);
  });
});

describe("fallbackComparisonProjectId", () => {
  it("returns a different project id for the first project", () => {
    expect(fallbackComparisonProjectId(projects[0].id)).not.toBe(projects[0].id);
  });
});
