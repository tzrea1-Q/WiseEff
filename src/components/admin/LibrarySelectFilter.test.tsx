import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LibrarySelectFilter } from "./LibrarySelectFilter";

const options = [
  { value: "all", label: "全部" },
  { value: "high", label: "高" }
] as const;

describe("LibrarySelectFilter", () => {
  it("renders options and reports selection changes", () => {
    const onChange = vi.fn();
    render(
      <LibrarySelectFilter
        ariaLabel="风险等级"
        value="all"
        options={options}
        onChange={onChange}
      />
    );

    fireEvent.change(screen.getByLabelText("风险等级"), { target: { value: "high" } });
    expect(onChange).toHaveBeenCalledWith("high");
  });
});
