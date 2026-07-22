import { describe, expect, it } from "vitest";

import {
  buildBindingCompareOverview,
  buildBindingProjectComparison
} from "./bindingProjectComparison";

describe("buildBindingProjectComparison", () => {
  it("synthesizes base, dedupes peers by projectId, and marks target", () => {
    const comparison = buildBindingProjectComparison({
      baseProjectId: "proj-source",
      baseProjectName: "Source",
      baseRawValue: "<3590>",
      peers: [
        { projectId: "proj-aurora", projectName: "Aurora 量产平台", rawValue: "<3590>" },
        { projectId: "proj-aurora", projectName: "Aurora 量产平台", rawValue: "<3600>" },
        { projectId: "proj-nebula", projectName: "Nebula 高频调试项目", rawValue: "<3500>" }
      ],
      targetProjectId: "proj-nebula"
    });

    expect(comparison.rows.map((row) => row.projectId)).toEqual([
      "proj-source",
      "proj-aurora",
      "proj-nebula"
    ]);
    expect(comparison.rows[1]?.rawValue).toBe("<3590>");
    expect(comparison.baseRow?.isBase).toBe(true);
    expect(comparison.targetRow?.projectId).toBe("proj-nebula");
    expect(comparison.coverage).toEqual({ configured: 3, total: 3 });
    expect(comparison.delta).toEqual({ kind: "changed", label: "值不同" });
  });

  it("reports equal delta when base and target raw values match", () => {
    const comparison = buildBindingProjectComparison({
      baseProjectId: "proj-source",
      baseProjectName: "Source",
      baseRawValue: "<3590>",
      peers: [{ projectId: "proj-aurora", projectName: "Aurora", rawValue: "<3590>" }],
      targetProjectId: "proj-aurora"
    });
    expect(comparison.delta).toEqual({ kind: "same", label: "值相同" });
  });

  it("reports missing target when no peer is selected", () => {
    const comparison = buildBindingProjectComparison({
      baseProjectId: "proj-source",
      baseProjectName: "Source",
      baseRawValue: "<3590>",
      peers: [{ projectId: "proj-aurora", projectName: "Aurora", rawValue: "<3590>" }],
      targetProjectId: null
    });
    expect(comparison.targetRow).toBeNull();
    expect(comparison.delta).toEqual({ kind: "missing", label: "目标项目尚未配置该参数" });
  });
});

describe("buildBindingCompareOverview", () => {
  it("summarizes same and different peers relative to base without listing raw values", () => {
    const comparison = buildBindingProjectComparison({
      baseProjectId: "proj-source",
      baseProjectName: "当前项目",
      baseRawValue: "<3590>",
      peers: [
        { projectId: "proj-aurora", projectName: "Aurora 量产平台", rawValue: "<3590>" },
        { projectId: "proj-nebula", projectName: "Nebula 高频调试项目", rawValue: "<3500>" }
      ],
      targetProjectId: "proj-nebula"
    });

    const overview = buildBindingCompareOverview(comparison.rows, comparison.baseRow.rawValue);
    expect(overview.summary).toBe("1 相同 · 1 不同");
    expect(overview.groups.map((group) => group.kind)).toEqual(["same", "changed"]);
    expect(overview.groups[0]?.projects.map((project) => project.projectName)).toEqual([
      "Aurora 量产平台"
    ]);
    expect(overview.groups[1]?.projects.map((project) => project.projectId)).toEqual(["proj-nebula"]);
  });

  it("reports 全部相同 when every peer matches the base value", () => {
    const comparison = buildBindingProjectComparison({
      baseProjectId: "proj-source",
      baseProjectName: "当前项目",
      baseRawValue: "<3590>",
      peers: [{ projectId: "proj-aurora", projectName: "Aurora", rawValue: "<3590>" }],
      targetProjectId: "proj-aurora"
    });
    expect(buildBindingCompareOverview(comparison.rows, comparison.baseRow.rawValue).summary).toBe(
      "全部相同"
    );
  });

  it("excludes the base project from overview groups", () => {
    const overview = buildBindingCompareOverview(
      [
        {
          projectId: "proj-source",
          projectName: "当前项目",
          rawValue: "<3590>",
          isBase: true,
          isTarget: false
        }
      ],
      "<3590>"
    );
    expect(overview.summary).toBe("暂无其他项目");
    expect(overview.groups).toEqual([]);
  });

  it("includes a 未配置 group for empty raw values", () => {
    const overview = buildBindingCompareOverview(
      [
        {
          projectId: "proj-source",
          projectName: "当前项目",
          rawValue: "<3590>",
          isBase: true,
          isTarget: false
        },
        {
          projectId: "proj-gap",
          projectName: "Gap",
          rawValue: "  ",
          isBase: false,
          isTarget: false
        }
      ],
      "<3590>"
    );
    expect(overview.summary).toBe("1 未配置");
    expect(overview.groups.map((group) => group.kind)).toEqual(["missing"]);
  });
});
