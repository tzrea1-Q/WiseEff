import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ComparisonFilterBar } from "../components/ComparisonFilterBar";
import type { ComparisonFilters } from "../types";

const filters: ComparisonFilters = {
  driftOnly: true,
  risk: [],
  modules: [],
  query: ""
};

describe("ComparisonFilterBar", () => {
  afterEach(() => {
    cleanup();
  });

  it("updates search and drift-only state", () => {
    const onQueryChange = vi.fn();
    const onDriftOnlyChange = vi.fn();
    render(
      <ComparisonFilterBar
        filters={filters}
        moduleOptions={["Battery Safety"]}
        visibleCount={2}
        totalCount={8}
        onQueryChange={onQueryChange}
        onDriftOnlyChange={onDriftOnlyChange}
        onRiskChange={() => undefined}
        onModulesChange={() => undefined}
        onReset={() => undefined}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("搜索参数键、模块或含义"), { target: { value: "voltage" } });
    fireEvent.click(screen.getByRole("switch", { name: "仅看差异" }));

    expect(onQueryChange).toHaveBeenCalledWith("voltage");
    expect(onDriftOnlyChange).toHaveBeenCalledWith(false);
  });

  it("toggles risk and module options", () => {
    const onRiskChange = vi.fn();
    const onModulesChange = vi.fn();
    render(
      <ComparisonFilterBar
        filters={filters}
        moduleOptions={["Battery Safety"]}
        visibleCount={2}
        totalCount={8}
        onQueryChange={() => undefined}
        onDriftOnlyChange={() => undefined}
        onRiskChange={onRiskChange}
        onModulesChange={onModulesChange}
        onReset={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /重要性/ }));
    fireEvent.click(within(screen.getByRole("listbox", { name: "重要性筛选" })).getByRole("option", { name: "High" }));
    fireEvent.click(screen.getByRole("button", { name: /模块/ }));
    fireEvent.click(within(screen.getByRole("listbox", { name: "模块筛选" })).getByRole("option", { name: "Battery Safety" }));

    expect(onRiskChange).toHaveBeenCalledWith(["High"]);
    expect(onModulesChange).toHaveBeenCalledWith(["Battery Safety"]);
  });

  it("renders active filter chips and clears individual filters", () => {
    const onDriftOnlyChange = vi.fn();
    const onRiskChange = vi.fn();
    const onModulesChange = vi.fn();
    const onQueryChange = vi.fn();
    render(
      <ComparisonFilterBar
        filters={{ driftOnly: false, risk: ["High"], modules: ["Battery Safety"], query: "temp" }}
        moduleOptions={["Battery Safety"]}
        visibleCount={2}
        totalCount={8}
        onQueryChange={onQueryChange}
        onDriftOnlyChange={onDriftOnlyChange}
        onRiskChange={onRiskChange}
        onModulesChange={onModulesChange}
        onReset={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "移除显示已同步项筛选" }));
    fireEvent.click(screen.getByRole("button", { name: "移除 High 筛选" }));
    fireEvent.click(screen.getByRole("button", { name: "移除 Battery Safety 筛选" }));
    fireEvent.click(screen.getByRole("button", { name: "移除 temp 筛选" }));

    expect(onDriftOnlyChange).toHaveBeenCalledWith(true);
    expect(onRiskChange).toHaveBeenCalledWith([]);
    expect(onModulesChange).toHaveBeenCalledWith([]);
    expect(onQueryChange).toHaveBeenCalledWith("");
  });
});
