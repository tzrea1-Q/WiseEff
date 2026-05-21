import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

  it("keeps categorical filters out of the standalone filter bar", () => {
    render(
      <ComparisonFilterBar
        filters={filters}
        moduleOptions={["Battery Safety"]}
        visibleCount={2}
        totalCount={8}
        onQueryChange={() => undefined}
        onDriftOnlyChange={() => undefined}
        onRiskChange={() => undefined}
        onModulesChange={() => undefined}
        onReset={() => undefined}
      />
    );

    expect(screen.getByPlaceholderText("搜索参数键、模块或含义")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "仅看差异" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /重要性/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /模块/ })).not.toBeInTheDocument();
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
