import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModuleEditDialog } from "./ModuleEditDialog";

afterEach(() => cleanup());

describe("ModuleEditDialog", () => {
  it("shows overlay coverage label and author button for uncovered compatible rows", () => {
    const onAuthorOverlaySchema = vi.fn();
    render(
      <ModuleEditDialog
        module={{
          name: "SC8562",
          description: "",
          scope: "",
          kind: "driver-group"
        }}
        existingNames={[]}
        canAdmin
        compatibleMappings={[
          { id: "m1", matchKind: "compatible", matchValue: "vendor,sc8562" },
          { id: "m2", matchKind: "compatible", matchValue: "vendor,other" }
        ]}
        compatibleCoverages={[
          {
            compatible: "vendor,sc8562",
            covered: true,
            pattern: "vendor,sc8562*",
            source: "manual",
            driverId: "driver:org/org-1/vendor,sc8562:v1"
          },
          { compatible: "vendor,other", covered: false }
        ]}
        onSave={vi.fn()}
        onCancel={vi.fn()}
        onRemoveCompatibleMapping={vi.fn()}
        onAddCompatibleMapping={vi.fn()}
        onAuthorOverlaySchema={onAuthorOverlaySchema}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "修改模块 SC8562" });
    expect(within(dialog).getByText(/组织覆盖 · vendor,sc8562\*/)).toBeInTheDocument();
    expect(within(dialog).getByText("未覆盖")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "编写解析 schema" }));
    expect(onAuthorOverlaySchema).toHaveBeenCalledWith("vendor,other");
  });

  it("renders per-compatible parse coverage next to matching rules", () => {
    render(
      <ModuleEditDialog
        module={{
          name: "SC8562",
          description: "",
          scope: "",
          kind: "driver-group"
        }}
        existingNames={[]}
        compatibleMappings={[
          { id: "m1", matchKind: "compatible", matchValue: "vendor,sc8562" },
          { id: "m2", matchKind: "compatible", matchValue: "vendor,other" }
        ]}
        compatibleCoverages={[
          { compatible: "vendor,sc8562", covered: true, pattern: "vendor,sc8562*" },
          { compatible: "vendor,other", covered: false }
        ]}
        onSave={vi.fn()}
        onCancel={vi.fn()}
        onRemoveCompatibleMapping={vi.fn()}
        onAddCompatibleMapping={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "修改模块 SC8562" });
    expect(within(dialog).getByText("compatible:vendor,sc8562")).toBeInTheDocument();
    expect(within(dialog).getByText(/已覆盖 · vendor,sc8562\*/)).toBeInTheDocument();
    expect(within(dialog).getByText("未覆盖")).toBeInTheDocument();
  });

  it("saves name and description changes", () => {
    const onSave = vi.fn();
    render(
      <ModuleEditDialog
        module={{ name: "Power", description: "旧", scope: "组织", kind: "business" }}
        existingNames={[]}
        showImportance
        showKind
        onSave={onSave}
        onCancel={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "修改模块 Power" });
    fireEvent.change(within(dialog).getByLabelText("模块展示描述"), {
      target: { value: "新描述" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Power",
        description: "新描述",
        scope: "组织",
        kind: "business",
        importance: "medium"
      })
    );
  });
});
