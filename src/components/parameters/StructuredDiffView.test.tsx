import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DtsCompareBaselineResult } from "@/application/ports/DtsStructuredRepository";
import { aggregateStructuredChangeSet } from "@/application/parameters/structuredChangeSet";
import { StructuredDiffView } from "./StructuredDiffView";

afterEach(() => {
  cleanup();
});

function sampleCompare(): DtsCompareBaselineResult {
  return {
    baselineId: "bl-1",
    members: [
      {
        fileId: "f-board",
        fileName: "board.dts",
        status: "version_changed",
        structuralDiff: [
          {
            kind: "prop_changed",
            nodePath: "demo_integer",
            prop: "single_value",
            before: "<42>",
            after: "<150>"
          },
          { kind: "node_added", nodePath: "demo_bool/sub_module" },
          { kind: "node_removed", nodePath: "orphaned" }
        ]
      },
      {
        fileId: "f-thermal",
        fileName: "thermal.dts",
        status: "version_changed",
        structuralDiff: [
          {
            kind: "prop_added",
            nodePath: "thermal_zone",
            prop: "polling_delay",
            after: "<1000>"
          },
          {
            kind: "prop_removed",
            nodePath: "thermal_zone",
            prop: "legacy_limit",
            before: "<50>"
          }
        ]
      }
    ]
  };
}

describe("StructuredDiffView", () => {
  it("renders node/property-level added/removed/changed rows, not a line text diff", () => {
    render(<StructuredDiffView result={sampleCompare()} />);

    const region = screen.getByRole("region", { name: /结构化差异/i });
    expect(within(region).getByText("board.dts")).toBeInTheDocument();
    expect(within(region).getByText("thermal.dts")).toBeInTheDocument();

    expect(screen.getByText(/属性变更/)).toBeInTheDocument();
    expect(screen.getByText(/demo_integer/)).toBeInTheDocument();
    expect(screen.getByText(/single_value/)).toBeInTheDocument();
    expect(screen.getByText("<42>")).toBeInTheDocument();
    expect(screen.getByText("<150>")).toBeInTheDocument();

    expect(screen.getByText(/节点新增/)).toBeInTheDocument();
    expect(screen.getByText(/demo_bool\/sub_module/)).toBeInTheDocument();
    expect(screen.getByText(/节点删除/)).toBeInTheDocument();
    expect(screen.getByText(/orphaned/)).toBeInTheDocument();

    expect(screen.getByText(/属性新增/)).toBeInTheDocument();
    expect(screen.getByText(/polling_delay/)).toBeInTheDocument();
    expect(screen.getByText(/属性删除/)).toBeInTheDocument();
    expect(screen.getByText(/legacy_limit/)).toBeInTheDocument();

    // Must not fall back to text-line diff markers / dual line numbers.
    expect(document.querySelector(".submission-preview-diff")).toBeNull();
    expect(document.querySelector(".submission-preview-diff-row")).toBeNull();
  });

  it("shows an empty state when compare returns no structural changes (hex/multi-group equivalence)", () => {
    render(
      <StructuredDiffView
        result={{
          baselineId: "bl-eq",
          members: [
            {
              fileId: "f-1",
              fileName: "board.dts",
              status: "version_changed",
              structuralDiff: []
            }
          ]
        }}
      />
    );

    expect(screen.getByText(/无结构化差异|无节点\/属性级变更/i)).toBeInTheDocument();
    expect(screen.queryByText(/属性变更/)).not.toBeInTheDocument();
  });

  it("surfaces change-set mapped vs unmapped buckets when a changeSet is provided", () => {
    const result = sampleCompare();
    const changeSet = aggregateStructuredChangeSet(result, [
      {
        id: "param-int",
        sourceFileName: "board.dts",
        sourceNodePath: "demo_integer/single_value"
      },
      {
        id: "param-poll",
        sourceFileName: "thermal.dts",
        sourceNodePath: "thermal_zone/polling_delay"
      }
    ]);

    render(<StructuredDiffView result={result} changeSet={changeSet} />);

    const changeSetRegion = screen.getByRole("region", { name: /变更集/i });
    expect(within(changeSetRegion).getByText(/已映射 2 项/)).toBeInTheDocument();
    expect(within(changeSetRegion).getByText("param-int")).toBeInTheDocument();
    expect(within(changeSetRegion).getByText(/未映射 \d+ 项/)).toBeInTheDocument();
    expect(within(changeSetRegion).getByLabelText("未映射变更")).toBeInTheDocument();
  });
});
