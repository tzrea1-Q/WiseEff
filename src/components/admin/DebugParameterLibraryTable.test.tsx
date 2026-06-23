import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DebugParameterLibraryTable } from "./DebugParameterLibraryTable";

describe("DebugParameterLibraryTable", () => {
  it("renders catalog table with row actions", () => {
    render(
      <DebugParameterLibraryTable
        parameters={[
          {
            id: "p1",
            name: "Fast charge",
            key: "debug.fast",
            module: "Battery",
            risk: "High",
            bindings: [],
            enabled: true,
            archivedAt: null
          }
        ]}
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
    expect(screen.getByRole("button", { name: "修改" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "路径绑定" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "归档 Fast charge" })).toBeInTheDocument();
  });
});
