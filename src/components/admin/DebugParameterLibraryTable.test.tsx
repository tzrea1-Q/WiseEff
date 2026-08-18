import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { buildDebugModuleTree } from "@/debugAdminModules";
import { DebugParameterLibraryTable } from "./DebugParameterLibraryTable";

const parameters = [
  {
    id: "p1",
    name: "Fast charge",
    key: "debug.fast",
    module: "Battery",
    risk: "High" as const,
    bindings: [],
    enabled: true,
    archivedAt: null
  },
  {
    id: "p2",
    name: "Alpha limit",
    key: "debug.alpha",
    module: "Battery",
    risk: "Low" as const,
    bindings: [],
    enabled: true,
    archivedAt: null
  }
];

const moduleNodes = buildDebugModuleTree([
  {
    id: "p1",
    name: "Fast charge",
    description: "",
    detailedDescription: "",
    writeFormatExample: "",
    writeFormatHint: "",
    module: "Battery",
    enabled: true,
    bindings: []
  }
]);

describe("DebugParameterLibraryTable", () => {
  it("renders catalog table with row actions", () => {
    render(
      <DebugParameterLibraryTable
        parameters={parameters}
        moduleNodes={moduleNodes}
        runtimeMode="api"
        search={{ q: "", risk: "all", modules: [], coverage: "all", sort: "name-asc" }}
        onUpdateSearch={vi.fn()}
        onEditDefinition={vi.fn()}
        onEditBindings={vi.fn()}
        onArchive={vi.fn()}
        onCreate={vi.fn()}
      />
    );

    expect(screen.getByRole("table", { name: "可调参数目录" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "修改" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "路径绑定" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "归档 Fast charge" })).toBeInTheDocument();
  });

  it("uses DataTable sort with aria-sort and keeps archive actions", async () => {
    const onUpdateSearch = vi.fn();
    const onArchive = vi.fn();
    render(
      <DebugParameterLibraryTable
        parameters={parameters}
        moduleNodes={moduleNodes}
        runtimeMode="api"
        search={{ q: "", risk: "all", modules: [], coverage: "all", sort: "name-asc" }}
        onUpdateSearch={onUpdateSearch}
        onEditDefinition={vi.fn()}
        onEditBindings={vi.fn()}
        onArchive={onArchive}
      />
    );

    const nameHeader = screen.getByRole("columnheader", { name: /参数名/ });
    expect(nameHeader).toHaveAttribute("aria-sort", "ascending");
    await userEvent.click(within(nameHeader).getByRole("button", { name: /参数名/ }));
    expect(onUpdateSearch).toHaveBeenCalledWith({ sort: "name-desc" });

    await userEvent.click(screen.getByRole("button", { name: "归档 Fast charge" }));
    expect(onArchive).toHaveBeenCalledWith("p1");
  });
});
