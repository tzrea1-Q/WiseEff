import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ColumnFilter } from "./ColumnFilter";

describe("ColumnFilter", () => {
  it("opens a compact header menu and toggles checkbox values", async () => {
    const onToggle = vi.fn();
    const onClear = vi.fn();

    render(
      <ColumnFilter
        label="模块"
        groupLabel="模块筛选"
        values={["Charging Policy", "Battery Safety"]}
        selectedValues={["Battery Safety"]}
        onToggle={onToggle}
        onClear={onClear}
      />
    );

    const trigger = screen.getByRole("button", { name: "筛选模块" });
    expect(trigger).toHaveClass("active");

    await userEvent.click(trigger);
    const menu = screen.getByRole("group", { name: "模块筛选" });

    await userEvent.click(within(menu).getByRole("checkbox", { name: "Charging Policy" }));
    await userEvent.click(within(menu).getByRole("button", { name: "清除" }));

    expect(onToggle).toHaveBeenCalledWith("Charging Policy");
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
