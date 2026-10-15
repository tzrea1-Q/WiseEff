import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LibrarySelectFilter } from "./LibrarySelectFilter";

const options = [
  { value: "all", label: "全部" },
  { value: "high", label: "高" }
] as const;

describe("LibrarySelectFilter", () => {
  it("renders options and reports selection changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <LibrarySelectFilter
        ariaLabel="风险等级"
        value="all"
        options={options}
        onChange={onChange}
      />
    );

    await user.click(screen.getByRole("combobox", { name: "风险等级" }));
    await user.click(screen.getByRole("option", { name: "高", exact: true }));
    expect(onChange).toHaveBeenCalledWith("high");
  });
});
