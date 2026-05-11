import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilterChipGroup } from "./FilterChipGroup";

afterEach(() => {
  cleanup();
});

describe("FilterChipGroup", () => {
  it("renders options and active state", () => {
    render(
      <FilterChipGroup
        ariaLabel="风险等级"
        value="high"
        options={[
          { value: "all", label: "全部" },
          { value: "high", label: "高" },
          { value: "medium", label: "中" },
          { value: "low", label: "低" }
        ]}
        onChange={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "高", pressed: true })).toBeInTheDocument();
  });

  it("calls onChange when clicking an inactive chip", () => {
    const onChange = vi.fn();
    render(
      <FilterChipGroup
        ariaLabel="风险等级"
        value="all"
        options={[
          { value: "all", label: "全部" },
          { value: "high", label: "高" }
        ]}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "高" }));

    expect(onChange).toHaveBeenCalledWith("high");
  });

  it("resets to all when clicking the active non-all chip", () => {
    const onChange = vi.fn();
    render(
      <FilterChipGroup
        ariaLabel="风险等级"
        value="high"
        options={[
          { value: "all", label: "全部" },
          { value: "high", label: "高" }
        ]}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "高" }));

    expect(onChange).toHaveBeenCalledWith("all");
  });
});
