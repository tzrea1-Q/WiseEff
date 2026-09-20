import { createRef, type FormEvent } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchField } from "./SearchField";

describe("SearchField", () => {
  it("renders a controlled search input", () => {
    const onValueChange = vi.fn();
    render(<SearchField value="gpio" onValueChange={onValueChange} placeholder="搜索参数" />);

    const input = screen.getByRole("searchbox", { name: "搜索参数" });
    expect(input).toHaveValue("gpio");
    fireEvent.change(input, { target: { value: "cpu" } });
    expect(onValueChange).toHaveBeenCalledWith("cpu");
  });

  it("clears the value and restores focus", () => {
    const onValueChange = vi.fn();
    const onClear = vi.fn();
    render(<SearchField value="gpio" onValueChange={onValueChange} ariaLabel="搜索参数" onClear={onClear} />);

    fireEvent.click(screen.getByRole("button", { name: "清空输入" }));
    expect(onValueChange).toHaveBeenCalledWith("");
    expect(onClear).toHaveBeenCalledOnce();
    expect(screen.getByRole("searchbox", { name: "搜索参数" })).toHaveFocus();
  });

  it("forwards the input ref", () => {
    const ref = createRef<HTMLInputElement>();
    render(<SearchField ref={ref} value="" onValueChange={() => undefined} ariaLabel="搜索" />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    ref.current?.focus();
    expect(ref.current).toHaveFocus();
  });

  it("exposes disabled and loading states", () => {
    render(<SearchField value="q" onValueChange={() => undefined} ariaLabel="搜索" disabled loading />);
    const input = screen.getByRole("searchbox", { name: "搜索" });
    expect(input).toBeDisabled();
    expect(input.parentElement).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("button", { name: "清空输入" })).not.toBeInTheDocument();
  });

  it("uses a safe default accessible name", () => {
    render(<SearchField value="" onValueChange={() => undefined} />);
    expect(screen.getByRole("searchbox", { name: "搜索" })).toBeInTheDocument();
  });

  it("passes keyboard events through without swallowing Enter", () => {
    const onKeyDown = vi.fn();
    render(<SearchField value="q" onValueChange={() => undefined} ariaLabel="搜索" onKeyDown={onKeyDown} />);
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });
    expect(onKeyDown).toHaveBeenCalledOnce();
  });

  it("does not steal form submit", () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <SearchField value="board" onValueChange={() => undefined} ariaLabel="检索知识库" name="q" />
        <button type="submit">检索</button>
      </form>
    );
    fireEvent.submit(screen.getByRole("button", { name: "检索" }).closest("form") as HTMLFormElement);
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});
