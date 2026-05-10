import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParamAdminSearch } from "../hooks/useParamAdminSearch";
import { initialState } from "../mockData";
import { ParameterLibraryList } from "./ParameterLibraryList";

afterEach(() => {
  cleanup();
});

const baseSearch: ParamAdminSearch = {
  q: "",
  risk: "all",
  modules: [],
  coverage: "all",
  sort: "updatedAt-desc"
};

function defaultProps(overrides: Partial<Parameters<typeof ParameterLibraryList>[0]> = {}) {
  return {
    parameters: initialState.configDraft.parameterLibrary,
    projects: initialState.configDraft.projects,
    selectedId: undefined,
    onSelect: vi.fn(),
    search: baseSearch,
    onUpdateSearch: vi.fn(),
    ...overrides
  };
}

describe("ParameterLibraryList search and risk filters", () => {
  it("renders all parameters", () => {
    render(<ParameterLibraryList {...defaultProps()} />);

    expect(screen.getAllByRole("option")).toHaveLength(initialState.configDraft.parameterLibrary.length);
  });

  it("filters by search.q", () => {
    render(<ParameterLibraryList {...defaultProps({ search: { ...baseSearch, q: "fast" } })} />);

    const rows = screen.getAllByRole("option");
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((row) => expect(row.textContent?.toLowerCase()).toContain("fast"));
  });

  it("filters by high risk", () => {
    render(<ParameterLibraryList {...defaultProps({ search: { ...baseSearch, risk: "high" } })} />);

    const rows = screen.getAllByRole("option");
    const expectedCount = initialState.configDraft.parameterLibrary.filter((parameter) => parameter.risk === "High").length;
    expect(rows).toHaveLength(expectedCount);
  });

  it("sends q updates from the search input", () => {
    const props = defaultProps();
    render(<ParameterLibraryList {...props} />);

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "charge" } });

    expect(props.onUpdateSearch).toHaveBeenCalledWith({ q: "charge" });
  });

  it("sends risk updates from chips", () => {
    const props = defaultProps();
    render(<ParameterLibraryList {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "高" }));

    expect(props.onUpdateSearch).toHaveBeenCalledWith({ risk: "high" });
  });

  it("renders an empty state when no parameters match", () => {
    render(<ParameterLibraryList {...defaultProps({ search: { ...baseSearch, q: "zzz-no-match" } })} />);

    expect(screen.getByText(/没有匹配/)).toBeInTheDocument();
  });
});
