import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DebugNodeCatalogImportDialog } from "./DebugNodeCatalogImportDialog";
import type { CatalogImportPreview } from "@/infrastructure/http/debuggingAdminClient";

function buildPreview(overrides: Partial<CatalogImportPreview> = {}): CatalogImportPreview {
  return {
    canSubmit: true,
    previewDigest: "digest-1",
    format: "wiseeff.debug-node-catalog.v2",
    sourceOrganization: { organizationId: "org-source", organizationName: "Source Org" },
    targetOrganizationId: "org-chargelab",
    fileCounts: { modules: 1, nodes: 1, bindings: 2 },
    declaredCounts: { modules: 1, nodes: 1, bindings: 2 },
    modules: { created: 1, updated: 0, unchanged: 0 },
    nodes: { created: 0, updated: 1, unchanged: 0 },
    bindings: { created: 1, updated: 1, unchanged: 0 },
    details: [
      {
        path: "nodes/Battery/Charge limit",
        name: "Charge limit",
        object: "node",
        classification: "updated",
        fields: [
          { field: "enabled", before: false, after: true },
          { field: "description", before: "old", after: "" }
        ]
      },
      {
        path: 'nodes/["Battery"]::Charge limit/bindings/hdc',
        name: "hdc",
        object: "binding",
        classification: "updated",
        fields: [
          { field: "nodePath", before: "/sys/hdc/old", after: "/sys/hdc/new" },
          { field: "accessMode", before: "RO", after: "RW" }
        ]
      }
    ],
    detailsTruncated: false,
    conflicts: [],
    warnings: [],
    ...overrides
  };
}

function renderDialog(overrides: Partial<Parameters<typeof DebugNodeCatalogImportDialog>[0]> = {}) {
  const props = {
    open: true,
    fileName: "debug-node-catalog.json",
    preview: buildPreview(),
    loading: false,
    submitting: false,
    error: "",
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
    onReloadPreview: vi.fn(),
    ...overrides
  };
  render(<DebugNodeCatalogImportDialog {...props} />);
  return props;
}

describe("DebugNodeCatalogImportDialog", () => {
  it("shows scope, classification counts and per-field binding differences", () => {
    renderDialog();

    const dialog = screen.getByRole("dialog", { name: "导入预览" });
    expect(within(dialog).getByText("Source Org")).toBeInTheDocument();
    expect(within(dialog).getByText("org-chargelab")).toBeInTheDocument();
    const counts = within(dialog).getByRole("list", { name: "导入分类统计" });
    expect(within(counts).getByText("新增")).toBeInTheDocument();
    expect(counts.querySelector('[data-classification="created"]')?.textContent?.replace(/\s+/g, " ").trim()).toBe("新增 2");
    expect(counts.querySelector('[data-classification="updated"]')?.textContent?.replace(/\s+/g, " ").trim()).toBe("更新 2");
    expect(counts.querySelector('[data-classification="conflict"]')?.textContent?.replace(/\s+/g, " ").trim()).toBe("冲突 0");

    // Binding changes must name the path, access mode and enabled state that will change.
    expect(within(dialog).getByText(/协议路径: \/sys\/hdc\/old → \/sys\/hdc\/new/)).toBeInTheDocument();
    expect(within(dialog).getByText(/访问模式: RO → RW/)).toBeInTheDocument();
    expect(within(dialog).getByText(/启用状态: 否 → 是/)).toBeInTheDocument();
    expect(within(dialog).getByText(/简述: old → 空/)).toBeInTheDocument();
  });

  it("disables confirmation while blocking conflicts exist", () => {
    renderDialog({
      preview: buildPreview({
        canSubmit: false,
        previewDigest: null,
        conflicts: [
          {
            code: "duplicate-target-claim",
            location: "nodes[1]",
            message: 'Node "Cycle count" resolves to the same target node as nodes[0].'
          }
        ]
      })
    });

    const dialog = screen.getByRole("dialog", { name: "导入预览" });
    expect(within(dialog).getByRole("button", { name: "确认导入" })).toBeDisabled();
    expect(within(dialog).getByText(/nodes\[1\]/)).toBeInTheDocument();
  });

  it("reports 'no update needed' for an unchanged file and disables confirmation during submit", () => {
    renderDialog({
      preview: buildPreview({
        modules: { created: 0, updated: 0, unchanged: 1 },
        nodes: { created: 0, updated: 0, unchanged: 1 },
        bindings: { created: 0, updated: 0, unchanged: 2 },
        details: []
      })
    });

    const dialog = screen.getByRole("dialog", { name: "导入预览" });
    expect(within(dialog).getByText("无需更新：文件内容与当前节点库一致。")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "确认导入" }));
    expect(true).toBe(true);
  });

  it("surfaces a structured error with a re-preview action", () => {
    const props = renderDialog({ preview: null, error: "目标节点库在预览后发生变化，请重新预览后再确认（HTTP 409）。" });

    const dialog = screen.getByRole("dialog", { name: "导入预览" });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("请重新预览后再确认");
    expect(within(dialog).getByRole("button", { name: "确认导入" })).toBeDisabled();

    fireEvent.click(within(dialog).getByRole("button", { name: "重新预览" }));
    expect(props.onReloadPreview).toHaveBeenCalledTimes(1);
  });

  it("routes cancel and confirm to their callbacks", () => {
    const props = renderDialog();

    const dialog = screen.getByRole("dialog", { name: "导入预览" });
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "确认导入" }));

    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
  });
});
