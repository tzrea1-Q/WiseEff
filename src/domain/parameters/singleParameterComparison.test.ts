import { describe, expect, it } from "vitest";
import type { ParameterRecord } from "@/domain/parameters/types";
import type { ComparisonProject } from "./singleParameterComparison";
import { buildSingleParameterProjectComparison } from "./singleParameterComparison";

const projects: ComparisonProject[] = [
  { id: "aurora", code: "AUR-Prod", name: "Aurora Production" },
  { id: "nebula", code: "NEB-RD", name: "Nebula Lab" },
  { id: "atlas", code: "ATL-Intl", name: "Atlas Intl" },
  { id: "orion", code: "ORI-New", name: "Orion New" }
];

function parameter(patch: Partial<ParameterRecord>): ParameterRecord {
  return {
    id: `${patch.projectId ?? "aurora"}-${patch.name ?? "fast_charge_current_limit_ma"}`,
    name: patch.name ?? "fast_charge_current_limit_ma",
    description: patch.description ?? "Fast charge current limit",
    explanation: patch.explanation ?? "Limits fast charging current.",
    configFormat: patch.configFormat ?? "charging.fast_charge_current_limit_ma=3850",
    module: patch.module ?? "Charging Policy",
    projectId: patch.projectId ?? "aurora",
    currentValue: patch.currentValue ?? "3850",
    recommendedValue: patch.recommendedValue ?? "3200",
    range: patch.range ?? "2500 - 4500",
    unit: patch.unit ?? "mA",
    risk: patch.risk ?? "High",
    valueKind: patch.valueKind ?? "scalar",
    updatedAt: patch.updatedAt ?? "today 10:00",
    updatedAtTs: patch.updatedAtTs ?? "2026-05-21T02:00:00.000Z",
    history: patch.history ?? []
  };
}

describe("buildSingleParameterProjectComparison", () => {
  it("compares one parameter by name across every project", () => {
    const data = buildSingleParameterProjectComparison({
      parameters: [
        parameter({ projectId: "aurora", currentValue: "3850" }),
        parameter({ projectId: "nebula", currentValue: "4200", recommendedValue: "4000" }),
        parameter({ projectId: "atlas", currentValue: "3000", risk: "Medium" })
      ],
      projects,
      parameterName: "fast_charge_current_limit_ma",
      baseProjectId: "aurora",
      targetProjectId: "nebula"
    });

    expect(data.rows.map((row) => row.projectCode)).toEqual(["AUR-Prod", "NEB-RD", "ATL-Intl", "ORI-New"]);
    expect(data.baseRow?.currentValue).toBe("3850 mA");
    expect(data.targetRow?.currentValue).toBe("4200 mA");
    expect(data.rows.find((row) => row.projectId === "orion")).toMatchObject({
      status: "missing",
      currentValue: "未配置"
    });
    expect(data.coverage).toEqual({ configured: 3, missing: 1, total: 4 });
  });

  it("calculates numeric absolute and percentage deltas for the emphasized target", () => {
    const data = buildSingleParameterProjectComparison({
      parameters: [
        parameter({ projectId: "aurora", currentValue: "3850" }),
        parameter({ projectId: "nebula", currentValue: "4200" })
      ],
      projects,
      parameterName: "fast_charge_current_limit_ma",
      baseProjectId: "aurora",
      targetProjectId: "nebula"
    });

    expect(data.delta).toEqual({
      kind: "numeric",
      direction: "up",
      amount: 350,
      percent: 9.1,
      unit: "mA",
      label: "+350 mA (+9.1%)"
    });
  });

  it("reports text changes without numeric delta", () => {
    const data = buildSingleParameterProjectComparison({
      parameters: [
        parameter({ projectId: "aurora", name: "charge_mode", currentValue: "adaptive", unit: "" }),
        parameter({ projectId: "nebula", name: "charge_mode", currentValue: "aggressive", unit: "" })
      ],
      projects,
      parameterName: "charge_mode",
      baseProjectId: "aurora",
      targetProjectId: "nebula"
    });

    expect(data.delta).toEqual({
      kind: "text",
      status: "changed",
      label: "adaptive -> aggressive"
    });
  });

  it("summarizes multiline text changes instead of expanding the whole value in the delta label", () => {
    const baseValue = `fast-charge-profile-matrix =
  "0", "5000", "1500", "40", "entry",
  "1", "9000", "3000", "43", "balanced",
  "2", "11000", "4200", "46", "burst";`;
    const targetValue = `fast-charge-profile-matrix =
  "0", "5000", "1500", "40", "entry",
  "1", "9000", "3000", "43", "balanced",
  "2", "12000", "4300", "48", "boost";`;

    const data = buildSingleParameterProjectComparison({
      parameters: [
        parameter({ projectId: "aurora", name: "dts_fast_charge_profile_matrix", currentValue: baseValue, unit: "profile", valueKind: "complex" }),
        parameter({ projectId: "nebula", name: "dts_fast_charge_profile_matrix", currentValue: targetValue, unit: "profile", valueKind: "complex" })
      ],
      projects,
      parameterName: "dts_fast_charge_profile_matrix",
      baseProjectId: "aurora",
      targetProjectId: "nebula"
    });

    expect(data.delta).toEqual({
      kind: "text",
      status: "changed",
      label: "配置存在差异，查看下方 diff"
    });
    expect(data.baseRow?.currentValue).toBe(baseValue);
    expect(data.targetRow?.currentValue).toBe(targetValue);
  });

  it("treats blank configured current values as unavailable instead of same text", () => {
    const data = buildSingleParameterProjectComparison({
      parameters: [
        parameter({ projectId: "aurora", currentValue: "" }),
        parameter({ projectId: "nebula", currentValue: " " })
      ],
      projects,
      parameterName: "fast_charge_current_limit_ma",
      baseProjectId: "aurora",
      targetProjectId: "nebula"
    });

    expect(data.baseRow?.currentValue).toBe("未配置");
    expect(data.targetRow?.currentValue).toBe("未配置");
    expect(data.delta).toEqual({ kind: "missing", label: "对比值不可用" });
  });

  it("flags target missing and unit mismatch states", () => {
    const missing = buildSingleParameterProjectComparison({
      parameters: [parameter({ projectId: "aurora", currentValue: "3850" })],
      projects,
      parameterName: "fast_charge_current_limit_ma",
      baseProjectId: "aurora",
      targetProjectId: "nebula"
    });

    expect(missing.delta).toEqual({ kind: "missing", label: "目标项目尚未配置该参数" });

    const unitMismatch = buildSingleParameterProjectComparison({
      parameters: [
        parameter({ projectId: "aurora", currentValue: "3850", unit: "mA" }),
        parameter({ projectId: "nebula", currentValue: "4.2", unit: "A" })
      ],
      projects,
      parameterName: "fast_charge_current_limit_ma",
      baseProjectId: "aurora",
      targetProjectId: "nebula"
    });

    expect(unitMismatch.rows.find((row) => row.projectId === "nebula")?.unitMismatch).toBe(true);
    expect(unitMismatch.delta).toEqual({ kind: "unit-mismatch", label: "单位不一致：mA vs A" });
  });
});
