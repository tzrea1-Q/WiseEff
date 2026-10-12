import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MultiSelectDropdown } from "./MultiSelectDropdown";

afterEach(() => {
  cleanup();
});

describe("MultiSelectDropdown", () => {
  it("opts into the shared compact filter contract without changing multiselect behavior", () => {
    const onChange = vi.fn();
    render(<MultiSelectDropdown compact label="类型" value={[]} options={[{ value: "business", label: "业务分类" }]} onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: /类型/ });
    expect(trigger).toHaveAttribute("data-compact-control", "filter");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("checkbox", { name: "业务分类" }));
    expect(onChange).toHaveBeenCalledWith(["business"]);
  });
  it("shows the selected count in the trigger", () => {
    render(
      <MultiSelectDropdown
        label="模块"
        value={["a", "b"]}
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
          { value: "c", label: "C" }
        ]}
        onChange={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: /模块 \(2\)/ })).toBeInTheDocument();
  });

  it("opens the menu and checks an option", () => {
    const onChange = vi.fn();
    render(
      <MultiSelectDropdown
        label="模块"
        value={[]}
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" }
        ]}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /模块/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "A" }));

    expect(onChange).toHaveBeenCalledWith(["a"]);
  });

  it("unchecks an already selected option", () => {
    const onChange = vi.fn();
    render(
      <MultiSelectDropdown
        label="模块"
        value={["a"]}
        options={[{ value: "a", label: "A" }]}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /模块/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "A" }));

    expect(onChange).toHaveBeenCalledWith([]);
  });
});
