import { describe, expect, it } from "vitest";
import type { PowerManagementConfig } from "../../powerManagementConfig";
import {
  applyInitializationDraftToConfig,
  buildInitializationDraft,
  canSubmitInitializationDraft,
  getInitializationCandidateParameters,
  getInitializationScopeParameters,
  resolveInitializationConfig
} from "./initialization";

const config: PowerManagementConfig = {
  projects: [
    { id: "aurora", name: "Aurora", code: "AUR" },
    { id: "nebula", name: "Nebula", code: "NEB" },
    { id: "atlas", name: "Atlas", code: "ATL" }
  ],
  parameterModules: [
    { name: "Battery Safety", description: "", scope: "" },
    { name: "Charging Policy", description: "", scope: "" }
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

  it("includes the full parameter library in scope selection and marks non-source entries as library", () => {
    const scoped = getInitializationScopeParameters(config, {
      primarySourceProjectId: "aurora",
      supplementSourceProjectIds: ["nebula"]
    });

    expect(scoped).toHaveLength(2);
    expect(scoped.find((item) => item.parameterId === "battery-temp-target")).toMatchObject({
      sourceProjectId: "aurora",
      sourceRole: "primary",
      recommendedValue: "35"
    });
    expect(scoped.find((item) => item.parameterId === "charge-current")).toMatchObject({
      sourceProjectId: "aurora",
      sourceRole: "primary"
    });
  });

  it("uses definition recommended values for library-only scope entries when no source is selected", () => {
    const scoped = getInitializationScopeParameters(config, {
      primarySourceProjectId: "",
      supplementSourceProjectIds: []
    });

    expect(scoped).toHaveLength(2);
    expect(scoped.every((item) => item.sourceRole === "library")).toBe(true);
    expect(scoped.find((item) => item.parameterId === "battery-temp-target")?.recommendedValue).toBe("35");
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

  it("does not allow submitting a draft with zero selected parameters when sources are selected", () => {
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

  it("allows submitting an empty initialization draft without source projects", () => {
    const draft = buildInitializationDraft(config, {
      id: "init-empty",
      projectId: "zephyr",
      projectName: "Zephyr",
      projectCode: "ZEP",
      ownerUserId: "u-owner",
      createdBy: "u-creator",
      now: "2026-05-20T12:00:00.000Z",
      sourceProjectIds: [],
      primarySourceProjectId: "",
      supplementSourceProjectIds: [],
      selectedModules: [],
      selectedRisks: [],
      selectedParameterIds: []
    });

    expect(canSubmitInitializationDraft(draft)).toEqual({ ok: true });
  });

  it("includes every library parameter in the scope list", () => {
    const scope = getInitializationScopeParameters(config, {
      primarySourceProjectId: "aurora",
      supplementSourceProjectIds: ["nebula"]
    });

    expect(scope).toHaveLength(config.parameterLibrary.length);
    expect(scope.find((item) => item.parameterId === "battery-temp-target")).toMatchObject({
      sourceRole: "primary",
      recommendedValue: "35"
    });
  });

  it("marks parameters outside source projects as library scope entries", () => {
    const libraryOnlyConfig: PowerManagementConfig = {
      ...config,
      parameterLibrary: [
        ...config.parameterLibrary,
        {
          id: "orphan-definition",
          name: "orphan_param",
          description: "Only in library",
          explanation: "",
          configFormat: "JSON",
          module: "Battery Safety",
          range: "0 - 1",
          unit: "",
          risk: "Low",
          valueKind: "scalar",
          values: {
            nebula: { currentValue: "1", recommendedValue: "1", updatedAt: "today" }
          }
        }
      ]
    };

    const scope = getInitializationScopeParameters(libraryOnlyConfig, {
      primarySourceProjectId: "aurora",
      supplementSourceProjectIds: []
    });
    const orphan = scope.find((item) => item.parameterId === "orphan-definition");

    expect(orphan).toMatchObject({
      sourceRole: "library",
      recommendedValue: "1",
      needsRecommendedValueConfirmation: false
    });
  });

  it("builds snapshots for library-only selections without source projects", () => {
    const draft = buildInitializationDraft(config, {
      id: "init-library",
      projectId: "zephyr",
      projectName: "Zephyr",
      projectCode: "ZEP",
      ownerUserId: "u-owner",
      createdBy: "u-creator",
      now: "2026-05-20T12:00:00.000Z",
      sourceProjectIds: [],
      primarySourceProjectId: "",
      supplementSourceProjectIds: [],
      selectedModules: [],
      selectedRisks: [],
      selectedParameterIds: ["charge-current"]
    });

    expect(draft.parameterSnapshots).toHaveLength(1);
    expect(draft.parameterSnapshots[0]).toMatchObject({
      parameterId: "charge-current",
      sourceRole: "library",
      recommendedValue: "3200"
    });
  });
});

describe("resolveInitializationConfig", () => {
  it("rebuilds parameterLibrary from runtime parameters when configDraft library is empty", () => {
    const resolved = resolveInitializationConfig(
      { ...config, parameterLibrary: [] },
      config.parameterLibrary.flatMap((parameter) =>
        Object.entries(parameter.values).flatMap(([projectId, value]) =>
          value
            ? [
                {
                  id: `${projectId}-${parameter.id}`,
                  name: parameter.name,
                  description: parameter.description,
                  explanation: parameter.explanation,
                  configFormat: parameter.configFormat,
                  module: parameter.module,
                  range: parameter.range,
                  unit: parameter.unit,
                  risk: parameter.risk,
                  valueKind: parameter.valueKind,
                  projectId,
                  currentValue: value.currentValue,
                  recommendedValue: value.recommendedValue,
                  updatedAt: value.updatedAt,
                  updatedAtTs: value.updatedAt,
                  history: []
                }
              ]
            : []
        )
      )
    );

    const candidates = getInitializationCandidateParameters(resolved, {
      primarySourceProjectId: "aurora",
      supplementSourceProjectIds: [],
      selectedModules: [],
      selectedRisks: []
    });

    expect(resolved.parameterLibrary.length).toBeGreaterThan(0);
    expect(candidates.length).toBeGreaterThan(0);
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
