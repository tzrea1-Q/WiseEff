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
      onDisable={override.onDisable ?? vi.fn()}
      onDelete={override.onDelete ?? vi.fn()}
      {...override}
    />
  );
  return { onUpdateSearch, onEdit };
}

describe("DebugNodeLibraryTable", () => {
  it("uses one editor entry and keeps only node lifecycle actions in the overflow", async () => {
    const onEdit = vi.fn();
    renderTable({ onEdit });
    const row = screen.getByRole("row", { name: /Fast charge current/ });
    await userEvent.click(within(row).getByRole("button", { name: "编辑", exact: true }));
    expect(onEdit).toHaveBeenCalledWith("node-1");
    await userEvent.click(within(row).getByRole("button", { name: /：更多$/ }));
    expect(screen.queryByRole("menuitem", { name: "路径绑定" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "禁用 Fast charge current" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "删除 Fast charge current" })).toBeInTheDocument();
  });
  it("retains existing rows during a catalog refresh", () => {
    renderTable({ loading: true });
    expect(screen.getByText("Fast charge current")).toBeInTheDocument();
    expect(screen.queryByLabelText("正在加载可调节点")).not.toBeInTheDocument();
    expect(screen.getByLabelText("协议筛选")).toBeDisabled();
  });
  it("exposes protocol, access and full paths without opening the binding editor", () => {
    renderTable();
    const row = screen.getByRole("row", { name: /Fast charge current/ });
    expect(within(row).getByText("HDC")).toBeInTheDocument();
    expect(within(row).getByText("读写")).toBeInTheDocument();
    expect(within(row).getByTitle("/sys/hdc/current")).toHaveTextContent("/sys/hdc/current");
    expect(within(row).getByText("未配置")).toBeInTheDocument();
    expect(within(row).getByTitle("Charge current node")).toBeInTheDocument();
  });
  it("keeps destructive actions in the overflow menu without opening the row editor", async () => {
    const onDelete = vi.fn();
    const onEdit = vi.fn();
    renderTable({ onDelete, onEdit });
    const row = screen.getByRole("row", { name: /Fast charge current/ });
    expect(within(row).queryByRole("button", { name: /删除/ })).not.toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: /：更多$/ }));
    expect(onDelete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("menuitem", { name: "删除 Fast charge current" }));
    expect(onDelete).toHaveBeenCalledWith("node-1");
    expect(onEdit).not.toHaveBeenCalled();
  });
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

    expect(screen.getByRole("button", { name: "导出全部节点" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导入节点" })).toBeInTheDocument();

    const row = screen.getByRole("row", { name: /Cycle count/ });
    row.focus();
    await userEvent.keyboard("{Enter}");
    expect(onEdit).toHaveBeenCalledWith("node-2");
  });

  it("does not open edit when a row action is clicked", async () => {
    const onEdit = vi.fn();
    const onDisable = vi.fn();
    renderTable({ onEdit, onDisable });

    await userEvent.click(within(screen.getByRole("row", { name: /Fast charge current/ })).getByRole("button", { name: /：更多$/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "禁用 Fast charge current" }));

    expect(onDisable).toHaveBeenCalledWith("node-1");
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("calls onDelete from the row action without opening the editor", async () => {
    const onDelete = vi.fn();
    const onEdit = vi.fn();
    renderTable({ onDelete, onEdit });

    await userEvent.click(within(screen.getByRole("row", { name: /Fast charge current/ })).getByRole("button", { name: /：更多$/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: /删除 Fast charge current/ }));

    expect(onDelete).toHaveBeenCalledWith("node-1");
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("allows deleting an unused disabled node while keeping disablement unavailable", async () => {
    const disabledNode = { ...nodes[0], id: "node-disabled", name: "Disabled unused node", enabled: false };
    renderTable({
      nodes: [disabledNode],
      moduleNodes: buildDebugModuleTree([disabledNode])
    });

    const row = screen.getByRole("row", { name: /Disabled unused node/ });
    await userEvent.click(within(row).getByRole("button", { name: /：更多$/ }));
    expect(screen.getByRole("menuitem", { name: /删除 Disabled unused node/ })).not.toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("menuitem", { name: /禁用 Disabled unused node/ })).toHaveAttribute("aria-disabled", "true");
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
