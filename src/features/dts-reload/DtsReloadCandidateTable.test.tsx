import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import type { DtsReloadCandidate } from "@/domain/dtsReload/types";
import {
  DtsReloadCandidateTable,
  DTS_RELOAD_CANDIDATE_PAGE_SIZE
} from "./DtsReloadCandidateTable";

function candidate(overrides: Partial<DtsReloadCandidate> = {}): DtsReloadCandidate {
  return {
    bindingId: "binding-1",
    projectId: "project-1",
    propertyKey: "watchdog_time",
    displayName: "Watchdog",
    module: "charger",
    nodePath: "/amba/i2c@1/dev@6E",
    baselineValue: "<6000>",
    description: "Watchdog timeout.",
    valueShapeKind: "cells",
    resolvedValueShape: { kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 },
    unit: "ms",
    constraints: {},
    debuggable: true,
    ...overrides
  };
}

const compatible = candidate({
  bindingId: "binding-2",
  propertyKey: "compatible",
  displayName: "Compatible",
  module: "uart",
  nodePath: "/amba/uart@2",
  baselineValue: '"sc8562"',
  valueShapeKind: "string-list",
  resolvedValueShape: { kind: "string-list" }
});

function renderTable(
  overrides: Partial<ComponentProps<typeof DtsReloadCandidateTable>> = {}
) {
  const rows = overrides.rows ?? [candidate(), compatible];
  return render(
    <DtsReloadCandidateTable
      rows={rows}
      selectedBindingIds={[]}
      nameQuery=""
      onNameQueryChange={vi.fn()}
      listedCount={rows.length}
      totalCount={rows.length}
      moduleFilterOptions={["charger", "uart"]}
      selectedModuleFilters={[]}
      onToggleModuleFilter={vi.fn()}
      onClearModuleFilter={vi.fn()}
      onToggle={vi.fn()}
      onEdit={vi.fn()}
      {...overrides}
    />
  );
}

describe("DtsReloadCandidateTable", () => {
  it("renders the DataTable shell with sort, filter, and actions", () => {
    renderTable();

    const table = screen.getByRole("table", { name: "可调试参数" });
    expect(within(table).getByRole("columnheader", { name: /参数/ })).toHaveAttribute("aria-sort", "none");
    expect(within(table).getByRole("columnheader", { name: /模块/ })).toHaveAttribute("aria-sort", "none");
    expect(within(table).getByRole("columnheader", { name: /库基线/ })).toHaveAttribute("aria-sort", "none");
    expect(within(table).getByRole("columnheader", { name: "操作" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "筛选模块" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑 Watchdog" })).toBeInTheDocument();
  });

  it("sorts by 参数 and sets aria-sort on the column header", async () => {
    const user = userEvent.setup();
    renderTable();

    const parameterHeader = screen.getByRole("columnheader", { name: /参数/ });
    await user.click(within(parameterHeader).getByRole("button", { name: /参数/ }));

    expect(parameterHeader).toHaveAttribute("aria-sort", "ascending");
    const bodyRows = screen.getAllByRole("row").slice(1);
    expect(within(bodyRows[0]!).getByText("Compatible")).toBeInTheDocument();
    expect(within(bodyRows[1]!).getByText("Watchdog")).toBeInTheDocument();
  });

  it("paginates when the candidate list exceeds the page size", async () => {
    const user = userEvent.setup();
    const rows = Array.from({ length: DTS_RELOAD_CANDIDATE_PAGE_SIZE + 2 }, (_, index) =>
      candidate({
        bindingId: `binding-${index + 1}`,
        displayName: `参数 ${String(index + 1).padStart(2, "0")}`,
        propertyKey: `param_${index + 1}`
      })
    );
    renderTable({ rows, listedCount: rows.length, totalCount: rows.length, pageSize: 10 });

    expect(screen.getByText("参数 01")).toBeInTheDocument();
    expect(screen.queryByText("参数 11")).not.toBeInTheDocument();
    expect(screen.getByText(/1 \/ 2/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getByText("参数 11")).toBeInTheDocument();
    expect(screen.queryByText("参数 01")).not.toBeInTheDocument();
  });

  it("toggles a focused row with Enter and Space", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    renderTable({ onToggle });

    const watchdogRow = screen.getByRole("row", { name: /Watchdog/ });
    watchdogRow.focus();
    expect(watchdogRow).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(onToggle).toHaveBeenCalledWith("binding-1");

    await user.keyboard(" ");
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it("does not toggle when the edit action is clicked", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onEdit = vi.fn();
    renderTable({ onToggle, onEdit, rows: [candidate()] });

    await user.click(screen.getByRole("button", { name: "编辑 Watchdog" }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ bindingId: "binding-1" }));
    expect(onToggle).not.toHaveBeenCalled();
  });
});
