import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { legacyModuleIdFromName } from "@/domain/modules/moduleTree";
import { buildDebugModuleTree } from "@/debugAdminModules";
import { DebugNodeLibraryTable } from "./DebugNodeLibraryTable";

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

describe("DebugNodeLibraryTable", () => {
  it("renders module filter and narrows rows by selected modules", () => {
    render(
      <DebugNodeLibraryTable
        nodes={nodes}
        moduleNodes={moduleNodes}
        search={{ q: "", protocol: "all", modules: [], sort: "name-asc" }}
        onUpdateSearch={vi.fn()}
        onEdit={vi.fn()}
        onEditBindings={vi.fn()}
        onDisable={vi.fn()}
      />
    );

    expect(screen.getByText("Fast charge current")).toBeInTheDocument();
    expect(screen.getByText("Cycle count")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /模块/ })).toBeInTheDocument();
  });

  it("filters table rows when module selection is active", () => {
    render(
      <DebugNodeLibraryTable
        nodes={nodes}
        moduleNodes={moduleNodes}
        search={{ q: "", protocol: "all", modules: [chargingModuleId], sort: "name-asc" }}
        onUpdateSearch={vi.fn()}
        onEdit={vi.fn()}
        onEditBindings={vi.fn()}
        onDisable={vi.fn()}
      />
    );

    expect(screen.getByText("Fast charge current")).toBeInTheDocument();
    expect(screen.queryByText("Cycle count")).not.toBeInTheDocument();
    expect(screen.getByText("1 / 2 项")).toBeInTheDocument();
  });

  it("calls onUpdateSearch when a module is toggled", () => {
    const onUpdateSearch = vi.fn();
    render(
      <DebugNodeLibraryTable
        nodes={nodes}
        moduleNodes={moduleNodes}
        search={{ q: "", protocol: "all", modules: [], sort: "name-asc" }}
        onUpdateSearch={onUpdateSearch}
        onEdit={vi.fn()}
        onEditBindings={vi.fn()}
        onDisable={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /模块/ }));
    fireEvent.click(screen.getByLabelText("Battery Charging"));

    expect(onUpdateSearch).toHaveBeenCalledWith({ modules: [chargingModuleId] });
  });
});
