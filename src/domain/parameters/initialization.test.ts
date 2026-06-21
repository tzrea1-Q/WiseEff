import { describe, expect, it } from "vitest";
import type { PowerManagementConfig } from "../../powerManagementConfig";
import {
  applyInitializationDraftToConfig,
  buildInitializationDraft,
  canSubmitInitializationDraft,
  getInitializationCandidateParameters
} from "./initialization";

const config: PowerManagementConfig = {
  projects: [
    { id: "aurora", name: "Aurora", code: "AUR" },
    { id: "nebula", name: "Nebula", code: "NEB" },
    { id: "atlas", name: "Atlas", code: "ATL" }
  ],
  parameterModules: [
    { name: "Battery Safety", description: "", owner: "", scope: "" },
    { name: "Charging Policy", description: "", owner: "", scope: "" }
  ],
  parameterLibrary: [
    {
      id: "battery-temp-target",
      name: "battery_temp_target_c",
      description: "Battery target temperature",
      explanation: "",
      configFormat: "JSON",
      module: "Battery Safety",
      range: "20 - 60",
      unit: "C",
      risk: "High",
      valueKind: "scalar",
      values: {
        aurora: { currentValue: "38", recommendedValue: "35", updatedAt: "today" },
        nebula: { currentValue: "40", recommendedValue: "36", updatedAt: "today" },
        atlas: { currentValue: "42", recommendedValue: "37", updatedAt: "today" }
      }
    },
    {
      id: "charge-current",
      name: "fast_charge_current_ma",
      description: "Fast charge current",
      explanation: "",
      configFormat: "JSON",
      module: "Charging Policy",
      range: "0 - 5000",
      unit: "mA",
      risk: "Medium",
      valueKind: "scalar",
      values: {
        aurora: { currentValue: "3800", recommendedValue: "3200", updatedAt: "today" },
        nebula: { currentValue: "3600", recommendedValue: "3000", updatedAt: "today" },
        atlas: { currentValue: "3400", recommendedValue: "", updatedAt: "today" }
      }
    }
  ],
  debugParameters: []
};

describe("project parameter initialization", () => {
  it("uses the primary source for duplicate parameters and records alternatives", () => {
    const candidates = getInitializationCandidateParameters(config, {
      primarySourceProjectId: "aurora",
      supplementSourceProjectIds: ["nebula", "atlas"],
      selectedModules: ["Battery Safety"],
      selectedRisks: ["High"]
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      parameterId: "battery-temp-target",
      sourceProjectId: "aurora",
      sourceRole: "primary",
      recommendedValue: "35",
      alternativeSourceProjectIds: ["nebula", "atlas"],
      currentValueState: "pending_project_confirmation"
    });
  });

  it("flags missing recommended values without removing the parameter", () => {
    const candidates = getInitializationCandidateParameters(config, {
      primarySourceProjectId: "atlas",
      supplementSourceProjectIds: [],
      selectedModules: ["Charging Policy"],
      selectedRisks: ["Medium"]
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].needsRecommendedValueConfirmation).toBe(true);
  });

  it("builds a draft from selected candidate ids", () => {
    const draft = buildInitializationDraft(config, {
      id: "init-demo",
      projectId: "zephyr",
      projectName: "Zephyr",
      projectCode: "ZEP",
      ownerUserId: "u-owner",
      createdBy: "u-creator",
      now: "2026-05-20T12:00:00.000Z",
      sourceProjectIds: ["aurora", "nebula"],
      primarySourceProjectId: "aurora",
      supplementSourceProjectIds: ["nebula"],
      selectedModules: ["Battery Safety", "Charging Policy"],
      selectedRisks: ["High", "Medium"],
      selectedParameterIds: ["battery-temp-target"]
    });

    expect(draft.parameterSnapshots).toHaveLength(1);
    expect(draft.parameterSnapshots[0].parameterId).toBe("battery-temp-target");
    expect(canSubmitInitializationDraft(draft).ok).toBe(true);
  });

  it("does not allow submitting a draft with zero selected parameters", () => {
    const draft = buildInitializationDraft(config, {
      id: "init-empty",
      projectId: "zephyr",
      projectName: "Zephyr",
      projectCode: "ZEP",
      ownerUserId: "u-owner",
      createdBy: "u-creator",
      now: "2026-05-20T12:00:00.000Z",
      sourceProjectIds: ["aurora"],
      primarySourceProjectId: "aurora",
      supplementSourceProjectIds: [],
      selectedModules: ["Battery Safety"],
      selectedRisks: ["High"],
      selectedParameterIds: []
    });

    expect(canSubmitInitializationDraft(draft)).toEqual({
      ok: false,
      reason: "请至少选择一个参数后再提交初始化审阅。"
    });
  });
});

describe("applyInitializationDraftToConfig", () => {
  it("adds the new project and writes recommended values with pending current values", () => {
    const draft = buildInitializationDraft(config, {
      id: "init-demo",
      projectId: "zephyr",
      projectName: "Zephyr",
      projectCode: "ZEP",
      ownerUserId: "u-owner",
      createdBy: "u-creator",
      now: "2026-05-20T12:00:00.000Z",
      sourceProjectIds: ["aurora"],
      primarySourceProjectId: "aurora",
      supplementSourceProjectIds: [],
      selectedModules: ["Battery Safety"],
      selectedRisks: ["High"],
      selectedParameterIds: ["battery-temp-target"]
    });

    const next = applyInitializationDraftToConfig(config, draft);

    expect(next.projects).toContainEqual({ id: "zephyr", name: "Zephyr", code: "ZEP" });
    expect(next.parameterLibrary.find((parameter) => parameter.id === "battery-temp-target")?.values.zephyr).toEqual({
      currentValue: "待项目确认",
      recommendedValue: "35",
      updatedAt: "just now"
    });
    expect(next.parameterLibrary.find((parameter) => parameter.id === "charge-current")?.values.zephyr).toBeUndefined();
  });
});
