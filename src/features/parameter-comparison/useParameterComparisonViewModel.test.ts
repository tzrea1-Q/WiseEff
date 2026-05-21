import { describe, expect, it } from "vitest";
import { derivePowerManagementRuntimeState, initialState, projects } from "@/mockData";
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

    expect(viewModel.baseProject).toEqual(projects[0]);
    expect(viewModel.targetProject).toEqual(projects[1]);
    expect(viewModel.comparisonData.filteredRows.length).toBeGreaterThan(0);
  });

  it("uses runtime config draft projects for comparison options and selected projects", () => {
    const runtimeProject = { id: "zephyr", name: "Zephyr Runtime", code: "ZEP" };
    const runtimeConfig = {
      ...initialState.configDraft,
      projects: [...initialState.configDraft.projects, runtimeProject],
      parameterLibrary: initialState.configDraft.parameterLibrary.map((parameter) =>
        parameter.id === "battery-temp-target"
          ? {
              ...parameter,
              values: {
                ...parameter.values,
                [runtimeProject.id]: {
                  currentValue: "待项目确认",
                  recommendedValue: "36",
                  updatedAt: "just now"
                }
              }
            }
          : parameter
      )
    };
    const runtimeState = {
      ...initialState,
      configDraft: runtimeConfig,
      parameters: derivePowerManagementRuntimeState(runtimeConfig).parameters
    };

    const viewModel = buildParameterComparisonViewModel({
      state: runtimeState,
      comparisonSelection: {
        baseProjectId: runtimeProject.id,
        targetProjectId: projects[0].id
      },
      filters: {
        driftOnly: false,
        modules: [],
        query: "",
        risk: []
      }
    });

    expect(viewModel.projects).toContainEqual(runtimeProject);
    expect(viewModel.baseProject).toEqual(runtimeProject);
    expect(viewModel.targetProject).toEqual(projects[0]);
    expect(viewModel.comparisonData.rows).toHaveLength(1);
  });
});

describe("fallbackComparisonProjectId", () => {
  it("returns a different project id for the first project", () => {
    expect(fallbackComparisonProjectId(projects[0].id)).not.toBe(projects[0].id);
  });

  it("returns another id from the provided runtime project list", () => {
    const runtimeProjects = [
      { id: "aurora-runtime", name: "Aurora Runtime", code: "AUR-R" },
      { id: "zephyr-runtime", name: "Zephyr Runtime", code: "ZEP-R" }
    ];

    expect(fallbackComparisonProjectId("aurora-runtime", runtimeProjects)).toBe("zephyr-runtime");
  });
});
