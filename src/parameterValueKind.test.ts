import { describe, expect, it } from "vitest";
import { initialState } from "./mockData";
import {
  complexEditorRows,
  isComplexParameter,
  isComplexParameterValue
} from "./parameterValueKind";

describe("parameterValueKind", () => {
  it("detects multiline and long values as complex", () => {
    expect(isComplexParameterValue("3200")).toBe(false);
    expect(isComplexParameterValue("a".repeat(81))).toBe(true);
    expect(isComplexParameterValue("line-one\nline-two")).toBe(true);
  });

  it("detects complex parameters from config format or stored values", () => {
    const scalar = initialState.configDraft.parameterLibrary.find((parameter) => parameter.name === "fast_charge_current_limit_ma");
    const complex = initialState.configDraft.parameterLibrary.find((parameter) => parameter.name === "battery_thermal_derate_curve");

    expect(scalar).toBeDefined();
    expect(complex).toBeDefined();
    expect(isComplexParameter(scalar!)).toBe(false);
    expect(isComplexParameter(complex!)).toBe(true);
  });

  it("caps complex editor row height", () => {
    expect(complexEditorRows("one\ntwo\nthree")).toBe(6);
    expect(complexEditorRows(Array.from({ length: 20 }, (_, index) => `line-${index}`).join("\n"))).toBe(16);
  });
});
