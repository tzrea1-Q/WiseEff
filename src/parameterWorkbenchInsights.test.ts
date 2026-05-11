import { describe, expect, it } from "vitest";
import { initialState, type ParameterRecord, type PrototypeState } from "./mockData";
import {
  deriveParameterWorkbenchInsightSnapshot,
  getParameterDriftLabel,
  getParameterDriftMagnitude
} from "./parameterWorkbenchInsights";

function cloneStateWithParameters(parameters: ParameterRecord[]): PrototypeState {
  return {
    ...initialState,
    parameters
  };
}

describe("parameter workbench insights", () => {
  it("counts drifted parameters for the active project", () => {
    const snapshot = deriveParameterWorkbenchInsightSnapshot(initialState, "aurora");
    const expectedRows = initialState.parameters.filter(
      (parameter) => parameter.projectId === "aurora" && parameter.currentValue !== parameter.recommendedValue
    );

    expect(snapshot.driftedCount).toBe(expectedRows.length);
    expect(snapshot.highRiskCount).toBe(expectedRows.filter((row) => row.risk === "High").length);
    expect(snapshot.mediumRiskCount).toBe(expectedRows.filter((row) => row.risk === "Medium").length);
    expect(snapshot.topParameters.length).toBeGreaterThan(0);
    expect(snapshot.topParameters.every((row) => row.projectId === "aurora")).toBe(true);
  });

  it("orders top parameters by risk first, then drift magnitude", () => {
    const snapshot = deriveParameterWorkbenchInsightSnapshot(initialState, "aurora");

    expect(snapshot.topParameters[0].risk).toBe("High");
    for (let index = 1; index < snapshot.topParameters.length; index += 1) {
      const previous = snapshot.topParameters[index - 1];
      const current = snapshot.topParameters[index];
      if (previous.risk === current.risk) {
        expect(previous.driftMagnitude).toBeGreaterThanOrEqual(current.driftMagnitude);
      }
    }
  });

  it("generates signed numeric drift labels", () => {
    expect(getParameterDriftLabel({ currentValue: "3850", recommendedValue: "3200" } as ParameterRecord)).toBe("-16.9%");
    expect(getParameterDriftLabel({ currentValue: "12", recommendedValue: "14" } as ParameterRecord)).toBe("+16.7%");
    expect(getParameterDriftMagnitude({ currentValue: "18", recommendedValue: "18" } as ParameterRecord)).toBe(0);
  });

  it("uses a readable label for non-numeric drift", () => {
    expect(getParameterDriftLabel({ currentValue: "auto", recommendedValue: "manual" } as ParameterRecord)).toBe("配置不同");
    expect(getParameterDriftMagnitude({ currentValue: "auto", recommendedValue: "manual" } as ParameterRecord)).toBe(25);
  });

  it("returns an empty insight when the active project has no drift", () => {
    const parameters = initialState.parameters.map((parameter) =>
      parameter.projectId === "aurora"
        ? { ...parameter, currentValue: parameter.recommendedValue }
        : parameter
    );
    const snapshot = deriveParameterWorkbenchInsightSnapshot(cloneStateWithParameters(parameters), "aurora");

    expect(snapshot.driftedCount).toBe(0);
    expect(snapshot.highRiskCount).toBe(0);
    expect(snapshot.mediumRiskCount).toBe(0);
    expect(snapshot.topParameters).toEqual([]);
  });
});
