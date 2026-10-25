import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MultiSelectDropdown } from "./MultiSelectDropdown";
import userEvent from "@testing-library/user-event";

afterEach(() => {
  cleanup();
});

describe("MultiSelectDropdown", () => {
  it("searches options without dropping a hidden selection and closes when disabled", async () => {
    const onChange = vi.fn();
    const props = { label: "成员", value: ["a"], options: [{ value: "a", label: "Alice" }, { value: "b", label: "Bob" }], onChange, searchable: true };
    const view = render(<MultiSelectDropdown {...props} />);
    await userEvent.click(screen.getByRole("button", { name: "成员 (1)" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "搜索成员" }), "Bob");
    expect(screen.queryByRole("checkbox", { name: "Alice" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Bob" }));
    expect(onChange).toHaveBeenCalledWith(["a", "b"]);
    view.rerender(<MultiSelectDropdown {...props} disabled />);
    expect(screen.getByRole("button", { name: "成员 (1)" })).toBeDisabled();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
  it("returns focus on Escape and does not submit its parent form from option search", async () => {
    const onSubmit = vi.fn((event) => event.preventDefault());
    render(<form onSubmit={onSubmit}><MultiSelectDropdown label="团队" searchable value={[]} options={[{ value: "a", label: "A" }]} onChange={vi.fn()} /></form>);
    const trigger = screen.getByRole("button", { name: "团队" });
    await userEvent.click(trigger);
    await userEvent.type(screen.getByRole("searchbox", { name: "搜索团队" }), "A{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
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
