import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SelectControl } from "./SelectControl";

describe("SelectControl", () => {
  it("round trips empty values and prefix-like business IDs without collisions", async () => {
    const onValueChange = vi.fn();
    function Example() {
      const [value, setValue] = useState("");
      return <><label htmlFor="choice">关联项目</label><p id="choice-help">可取消关联。</p><SelectControl id="choice" value={value} options={[{ value: "", label: "不关联" }, { value: "select-control:", label: "前缀项目" }, { value: "__empty__", label: "普通项目" }]} onValueChange={(next) => { setValue(next); onValueChange(next); }} ariaDescribedBy="choice-help" ariaRequired className="custom-trigger" size="sm" withinModal /></>;
    }
    render(<Example />);
    const user = userEvent.setup();
    const trigger = screen.getByRole("combobox", { name: "关联项目" });
    expect(trigger).toHaveTextContent("不关联");
    expect(trigger).toHaveAttribute("data-value", "");
    expect(trigger).toHaveAttribute("aria-required", "true");
    expect(trigger).toHaveAccessibleDescription("可取消关联。");
    expect(trigger).toHaveAttribute("data-size", "sm");
    expect(trigger).toHaveClass("custom-trigger");
    await user.click(trigger);
    expect(screen.getByRole("listbox")).toHaveClass("debug-admin-select-content--modal", "max-h-64");
    await user.click(screen.getByRole("option", { name: "前缀项目" }));
    expect(trigger).toHaveAttribute("data-value", "select-control:");
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "普通项目" }));
    expect(trigger).toHaveAttribute("data-value", "__empty__");
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "不关联" }));
    expect(trigger).toHaveAttribute("data-value", "");
    expect(onValueChange.mock.calls).toEqual([["select-control:"], ["__empty__"], [""]]);
  });

  it("preserves placeholder and disabled state when no empty option exists", () => {
    render(<SelectControl ariaLabel="选择模块" value="" options={[{ value: "module", label: "模块" }]} onValueChange={vi.fn()} placeholder="请选择模块" disabled />);
    const trigger = screen.getByRole("combobox", { name: "选择模块" });
    expect(trigger).toHaveTextContent("请选择模块");
    expect(trigger).toBeDisabled();
  });
});
