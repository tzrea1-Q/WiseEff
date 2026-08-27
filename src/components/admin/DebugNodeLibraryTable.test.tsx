import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { legacyModuleIdFromName } from "@/domain/modules/moduleTree";
import { buildDebugModuleTree } from "@/debugAdminModules";
import { DebugNodeLibraryTable } from "./DebugNodeLibraryTable";
import type { DebugNodeRegistryEntry } from "@/domain/debugging/types";

const nodes = [
  {
    id: "node-1",
    name: "Fast charge current",
    description: "Charge current node",
    detailedDescription: "",
    writeFormatExample: "",
    writeFormatHint: "",
    module: "Battery Charging",
    enabled: true,
    bindings: [{ protocol: "hdc" as const, nodePath: "/sys/hdc/current", accessMode: "RW" as const, enabled: true }]
  },
  {
    id: "node-2",
    name: "Cycle count",
    description: "Battery cycle count",
    detailedDescription: "",
    writeFormatExample: "",
    writeFormatHint: "",
    module: "Battery Health",
    enabled: true,
    bindings: [{ protocol: "hdc" as const, nodePath: "/sys/hdc/cycles", accessMode: "RO" as const, enabled: true }]
  }
];

const moduleNodes = buildDebugModuleTree(nodes);
const chargingModuleId = legacyModuleIdFromName("Battery Charging");

function renderTable(
  override: Partial<ComponentProps<typeof DebugNodeLibraryTable>> = {}
) {
  const onUpdateSearch = override.onUpdateSearch ?? vi.fn();
  const onEdit = override.onEdit ?? vi.fn();
  render(
    <DebugNodeLibraryTable
      nodes={nodes}
      moduleNodes={moduleNodes}
      search={{ q: "", protocol: "all", modules: [], sort: "name-asc" }}
      onUpdateSearch={onUpdateSearch}
      onEdit={onEdit}
      onEditBindings={override.onEditBindings ?? vi.fn()}
      onDisable={override.onDisable ?? vi.fn()}
      onDelete={override.onDelete ?? vi.fn()}
      {...override}
    />
  );
  return { onUpdateSearch, onEdit };
}

describe("DebugNodeLibraryTable", () => {
  it("renders module filter and narrows rows by selected modules", () => {
    renderTable();

    expect(screen.getByText("Fast charge current")).toBeInTheDocument();
    expect(screen.getByText("Cycle count")).toBeInTheDocument();
    const moduleHeader = screen.getByRole("columnheader", { name: /模块/ });
    expect(within(moduleHeader).getByRole("button", { name: "筛选模块", expanded: false })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "模块", expanded: false })).not.toBeInTheDocument();
  });

  it("filters table rows when module selection is active", () => {
    renderTable({
      search: { q: "", protocol: "all", modules: [chargingModuleId], sort: "name-asc" }
    });

    expect(screen.getByText("Fast charge current")).toBeInTheDocument();
    expect(screen.queryByText("Cycle count")).not.toBeInTheDocument();
    expect(screen.getByText("1 / 2 项")).toBeInTheDocument();
  });

  it("calls onUpdateSearch when a module is toggled", () => {
    const { onUpdateSearch } = renderTable();

    const moduleHeader = screen.getByRole("columnheader", { name: /模块/ });
    fireEvent.click(within(moduleHeader).getByRole("button", { name: "筛选模块", expanded: false }));
    fireEvent.click(screen.getByLabelText("Battery Charging"));

    expect(onUpdateSearch).toHaveBeenCalledWith({ modules: [chargingModuleId] });
  });

  it("uses DataTable sort with aria-sort on the name column", async () => {
    const { onUpdateSearch } = renderTable();
    const nameHeader = screen.getByRole("columnheader", { name: /节点名/ });

    expect(nameHeader).toHaveAttribute("aria-sort", "ascending");
    await userEvent.click(within(nameHeader).getByRole("button", { name: /节点名/ }));
    expect(onUpdateSearch).toHaveBeenCalledWith({ sort: "name-desc" });
  });

  it("activates a row with the keyboard and keeps import/export heading actions", async () => {
    const { onEdit } = renderTable({
      onExport: vi.fn(),
      onImport: vi.fn()
    });

    expect(screen.getByRole("button", { name: "导出目录" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导入目录" })).toBeInTheDocument();

    const row = screen.getByRole("row", { name: /Cycle count/ });
    row.focus();
    await userEvent.keyboard("{Enter}");
    expect(onEdit).toHaveBeenCalledWith("node-2");
  });

  it("does not open edit when a row action is clicked", async () => {
    const onEdit = vi.fn();
    const onEditBindings = vi.fn();
    renderTable({ onEdit, onEditBindings });

    await userEvent.click(
      within(screen.getByRole("row", { name: /Fast charge current/ })).getByRole("button", { name: "路径绑定" })
    );

    expect(onEditBindings).toHaveBeenCalledWith("node-1");
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("calls onDelete from the row action without opening the editor", async () => {
    const onDelete = vi.fn();
    const onEdit = vi.fn();
    renderTable({ onDelete, onEdit });

    await userEvent.click(
      within(screen.getByRole("row", { name: /Fast charge current/ })).getByRole("button", { name: /删除 Fast charge current/ })
    );

    expect(onDelete).toHaveBeenCalledWith("node-1");
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("allows deleting an unused disabled node while keeping disablement unavailable", () => {
    const disabledNode = { ...nodes[0], id: "node-disabled", name: "Disabled unused node", enabled: false };
    renderTable({
      nodes: [disabledNode],
      moduleNodes: buildDebugModuleTree([disabledNode])
    });

    const row = screen.getByRole("row", { name: /Disabled unused node/ });
    expect(within(row).getByRole("button", { name: /删除 Disabled unused node/ })).toBeEnabled();
    expect(within(row).getByRole("button", { name: /禁用 Disabled unused node/ })).toBeDisabled();
  });

  it("paginates when the catalog exceeds one page", () => {
    const manyNodes: DebugNodeRegistryEntry[] = Array.from({ length: 51 }, (_, index) => ({
      id: `node-${index + 1}`,
      name: `Node ${String(index + 1).padStart(2, "0")}`,
      description: "",
      detailedDescription: "",
      writeFormatExample: "",
      writeFormatHint: "",
      module: "Battery Charging",
      enabled: true,
      bindings: []
    }));

    renderTable({
      nodes: manyNodes,
      moduleNodes: buildDebugModuleTree(manyNodes)
    });

    expect(screen.getByRole("button", { name: "下一页" })).toBeInTheDocument();
    expect(screen.getByText(/1 \/ 2/)).toBeInTheDocument();
  });
});
