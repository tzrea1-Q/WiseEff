import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ClassifyCompatibleDialog } from "./ClassifyCompatibleDialog";

afterEach(() => cleanup());

describe("ClassifyCompatibleDialog", () => {
  it("requires a business target and confirms with per-compatible group names", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ClassifyCompatibleDialog
        hints={[
          {
            compatible: "vendor,alpha",
            bindingCount: 3,
            projectCount: 1,
            suggestedGroupName: "alpha"
          }
        ]}
        modules={[
          {
            id: "mod-power",
            name: "Power",
            parentId: null,
            sortOrder: 0,
            description: "",
            scope: "",
            importance: "high",
            kind: "business",
            origin: "curated",
            sourceKey: null,
            effectiveImportance: "high",
            parameterCount: 2
          }
        ]}
        preview={{
          affectedBindings: 3,
          byProject: [],
          fromModules: [],
          toModuleId: null,
          emptiedModules: [],
          conflicts: []
        }}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    expect(screen.getByRole("dialog", { name: "归类到业务分类" })).toBeInTheDocument();
    expect(
      screen.getByText((_, node) => {
        return (
          node?.tagName === "P" &&
          (node.textContent ?? "").replace(/\s+/g, " ").trim() === "预计影响 3 个项目参数"
        );
      })
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("vendor,alpha 驱动组名称"), {
      target: { value: "Alpha Group" }
    });
    fireEvent.click(screen.getByRole("button", { name: "确认归类" }));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        businessModuleId: "mod-power",
        groups: [{ compatible: "vendor,alpha", driverGroupName: "Alpha Group" }]
      })
    );
  });
});
