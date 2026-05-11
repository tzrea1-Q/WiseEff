import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TimeWindowSelect } from "./TimeWindowSelect";

describe("TimeWindowSelect", () => {
  it("renders three default options", () => {
    render(<TimeWindowSelect value="today" onChange={() => {}} />);

    expect(screen.getByRole("button", { name: "今日" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "7 日" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "30 日" })).toBeInTheDocument();
  });

  it("marks the current value with aria-pressed=true", () => {
    render(<TimeWindowSelect value="7d" onChange={() => {}} />);

    expect(screen.getByRole("button", { name: "今日" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "7 日" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "30 日" })).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onChange when user clicks another option", async () => {
    const onChange = vi.fn();

    render(<TimeWindowSelect value="today" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "7 日" }));

    expect(onChange).toHaveBeenCalledWith("7d");
  });

  it("groups buttons with role=group and aria-label", () => {
    render(<TimeWindowSelect value="today" onChange={() => {}} />);

    expect(screen.getByRole("group", { name: /时间窗口/ })).toBeInTheDocument();
  });

  it("does not call onChange when clicking the currently selected option", async () => {
    const onChange = vi.fn();

    render(<TimeWindowSelect value="today" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "今日" }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("supports custom options", () => {
    render(
      <TimeWindowSelect
        value="today"
        onChange={() => {}}
        options={[
          { value: "today", label: "本日" },
          { value: "7d", label: "一周" }
        ]}
      />
    );

    expect(screen.getByRole("button", { name: "本日" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "一周" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "30 日" })).not.toBeInTheDocument();
  });
});
