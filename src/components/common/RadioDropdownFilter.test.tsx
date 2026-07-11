import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RadioDropdownFilter } from "./RadioDropdownFilter";

const options = [
  { value: "all", label: "全部覆盖" },
  { value: "full", label: "完整覆盖" }
] as const;

describe("RadioDropdownFilter", () => {
  it("opens the menu and selects an option", () => {
    const onChange = vi.fn();
    render(
      <RadioDropdownFilter
        label="覆盖"
        value="all"
        options={options}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "覆盖 ▾" }));
    fireEvent.click(screen.getByLabelText("完整覆盖"));

    expect(onChange).toHaveBeenCalledWith("full");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
