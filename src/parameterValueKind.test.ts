import { describe, expect, it } from "vitest";
import { initialState } from "./mockData";
import {
  complexEditorRows,
  getParameterValueSummary,
  isComplexParameter,
  isComplexParameterValue,
  shouldSummarizeComplexParameter
} from "./parameterValueKind";

describe("parameterValueKind", () => {
  it("uses valueKind to detect complex parameters", () => {
    const scalar = initialState.configDraft.parameterLibrary.find((parameter) => parameter.name === "fast_charge_current_limit_ma");
    const complex = initialState.configDraft.parameterLibrary.find((parameter) => parameter.name === "battery_thermal_derate_curve");

    expect(scalar).toBeDefined();
    expect(complex).toBeDefined();
    expect(scalar!.valueKind).toBe("scalar");
    expect(complex!.valueKind).toBe("complex");
    expect(isComplexParameter(scalar!)).toBe(false);
    expect(isComplexParameter(complex!)).toBe(true);
  });

  it("falls back to multiline content when valueKind is missing", () => {
    const multiline = "battery-thermal-derate-curve = <\n  0 38 3800 4350\n>;";
    expect(isComplexParameterValue(multiline)).toBe(true);
    expect(shouldSummarizeComplexParameter({ valueKind: "scalar" }, multiline)).toBe(true);
    expect(getParameterValueSummary(multiline).propertyName).toBe("battery-thermal-derate-curve");
  });

  it("caps complex editor row height", () => {
    expect(complexEditorRows("one\ntwo\nthree")).toBe(6);
    expect(complexEditorRows(Array.from({ length: 20 }, (_, index) => `line-${index}`).join("\n"))).toBe(16);
  });
});
