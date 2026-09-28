import { describe, expect, it } from "vitest";

import {
  buildBindingCompareOverview,
  buildBindingProjectComparison,
  bindingComparePeerDisplayLabel,
  defaultBindingCompareTargetId
} from "./bindingProjectComparison";

describe("buildBindingProjectComparison", () => {
  it("synthesizes base and preserves every binding instance, including siblings in one project", () => {
    const comparison = buildBindingProjectComparison({
      baseProjectId: "proj-source",
      baseProjectName: "Source",
      baseRawValue: "<3590>",
      peers: [
        {
          bindingId: "binding-aurora-1",
          projectId: "proj-aurora",
          projectName: "Aurora 量产平台",
          sourceIdentity: "source:board.dts#/charger@6e/gpio_int",
          rawValue: "<3590>"
        },
        {
          bindingId: "binding-aurora-2",
          projectId: "proj-aurora",
          projectName: "Aurora 量产平台",
          sourceIdentity: "source:overlay.dtso#/charger@6e/gpio_int",
          rawValue: "<3600>",
          definitionRevisionId: "definition-revision-fixed",
          effectiveRevisionId: "binding-revision-effective"
        },
        {
          bindingId: "binding-nebula-1",
          projectId: "proj-nebula",
          projectName: "Nebula 高频调试项目",
          rawValue: "<3500>"
        }
      ],
      targetBindingId: "binding-aurora-2"
    });

    expect(comparison.rows.map((row) => row.projectId)).toEqual([
      "proj-source",
      "proj-aurora",
      "proj-aurora",
      "proj-nebula"
    ]);
    expect(comparison.rows.map((row) => row.bindingId)).toEqual([
      undefined,
      "binding-aurora-1",
      "binding-aurora-2",
      "binding-nebula-1"
    ]);
    expect(comparison.rows[2]?.isTarget).toBe(true);
    expect(comparison.baseRow?.isBase).toBe(true);
    expect(comparison.targetRow?.bindingId).toBe("binding-aurora-2");
    expect(comparison.targetRow).toEqual(expect.objectContaining({
      definitionRevisionId: "definition-revision-fixed",
      effectiveRevisionId: "binding-revision-effective"
    }));
    expect(comparison.coverage).toEqual({ configured: 4, total: 4 });
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

  it("rejects conflicting duplicate binding identities instead of selecting the first row", () => {
    expect(() => buildBindingProjectComparison({
      baseProjectId: "proj-source",
      baseProjectName: "Source",
      baseRawValue: "<3590>",
      peers: [
        { bindingId: "binding-duplicate", projectId: "proj-aurora", projectName: "Aurora", rawValue: "<1>" },
        { bindingId: "binding-duplicate", projectId: "proj-aurora", projectName: "Aurora", rawValue: "<2>" }
      ],
      targetBindingId: "binding-duplicate"
    })).toThrow("duplicate canonical binding comparison identity");
  });

  it("rejects duplicate binding identities when only the pinned revisions conflict", () => {
    expect(() => buildBindingProjectComparison({
      baseProjectId: "proj-source",
      baseProjectName: "Source",
      baseRawValue: "<3590>",
      peers: [
        {
          bindingId: "binding-revision-conflict",
          projectId: "proj-aurora",
          projectName: "Aurora",
          rawValue: "<1>",
          definitionRevisionId: "definition-revision-a",
          effectiveRevisionId: "binding-revision-a"
        },
        {
          bindingId: "binding-revision-conflict",
          projectId: "proj-aurora",
          projectName: "Aurora",
          rawValue: "<1>",
          definitionRevisionId: "definition-revision-b",
          effectiveRevisionId: "binding-revision-a"
        }
      ],
      targetBindingId: "binding-revision-conflict"
    })).toThrow("duplicate canonical binding comparison identity");
  });

  it("requires an explicit instance choice when legacy peers lack stable identity", () => {
    expect(defaultBindingCompareTargetId([
      { projectId: "project-a", projectName: "A", rawValue: "<1>" },
      { projectId: "project-b", projectName: "B", rawValue: "<2>" }
    ])).toBeNull();
    expect(defaultBindingCompareTargetId([
      { projectId: "project-a", projectName: "A", rawValue: "<1>" }
    ])).toBe("project-a");
    expect(defaultBindingCompareTargetId([
      { bindingId: "binding-a", projectId: "project-a", projectName: "A", rawValue: "<1>" },
      { bindingId: "binding-b", projectId: "project-b", projectName: "B", rawValue: "<2>" }
    ])).toBeNull();
  });

  it("prefers a readable source reference over opaque occurrence identities", () => {
    expect(bindingComparePeerDisplayLabel({
      projectId: "project-a",
      projectName: "A",
      rawValue: "<1>",
      sourceIdentity: "occurrence-uuid",
      sourceOccurrenceId: "occurrence-uuid",
      sourceRef: "charger.dts!/charger0"
    })).toBe("charger.dts!/charger0");
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
