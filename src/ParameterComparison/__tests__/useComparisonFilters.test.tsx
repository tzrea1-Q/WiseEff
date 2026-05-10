import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useComparisonFilters } from "../hooks/useComparisonFilters";

describe("useComparisonFilters", () => {
  it("defaults to drift-only filtering", () => {
    const { result } = renderHook(() => useComparisonFilters({ search: "", onSearchChange: () => undefined }));

    expect(result.current.filters).toEqual({
      driftOnly: true,
      risk: [],
      modules: [],
      query: ""
    });
  });

  it("initializes from the URL query string", () => {
    const { result } = renderHook(() =>
      useComparisonFilters({ search: "?driftOnly=0&risk=High,Medium&module=Battery%20Safety&q=temp", onSearchChange: () => undefined })
    );

    expect(result.current.filters.driftOnly).toBe(false);
    expect(result.current.filters.risk).toEqual(["High", "Medium"]);
    expect(result.current.filters.modules).toEqual(["Battery Safety"]);
    expect(result.current.filters.query).toBe("temp");
  });

  it("syncs updates to a query string", () => {
    const onSearchChange = vi.fn();
    const { result } = renderHook(() => useComparisonFilters({ search: "", onSearchChange }));

    act(() => {
      result.current.setQuery("voltage");
    });

    expect(result.current.filters.query).toBe("voltage");
    expect(onSearchChange).toHaveBeenLastCalledWith("?q=voltage");
  });

  it("can reset filters to defaults", () => {
    const onSearchChange = vi.fn();
    const { result } = renderHook(() =>
      useComparisonFilters({ search: "?driftOnly=0&risk=High&module=Battery%20Safety&q=temp", onSearchChange })
    );

    act(() => {
      result.current.resetFilters();
    });

    expect(result.current.filters).toEqual({ driftOnly: true, risk: [], modules: [], query: "" });
    expect(onSearchChange).toHaveBeenLastCalledWith("");
  });
});
