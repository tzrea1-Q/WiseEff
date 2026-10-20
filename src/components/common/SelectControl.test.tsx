import { createRef, useState } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SelectControl } from "./SelectControl";
import { ModalDialog } from "./ModalDialog";

describe("SelectControl", () => {
  it("preserves a selected hidden value without listing it", async () => {
    const user = userEvent.setup(), onValueChange = vi.fn();
    render(<SelectControl ariaLabel="技能" value="manual" onValueChange={onValueChange}
      options={[{ value: "auto", label: "充电（推荐）" }, { value: "manual", label: "充电", hidden: true }]} />);
    const trigger = screen.getByRole("combobox", { name: "技能" });
    expect(trigger).toHaveTextContent("充电");
    await user.click(trigger);
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option")).toHaveTextContent("充电（推荐）");
    await user.click(screen.getByRole("option"));
    expect(onValueChange).toHaveBeenCalledWith("auto");
  });
  it.each([false, true])("restores focus after selection loading without stealing a new focus target (%s)", async (moveFocus) => {
    const user = userEvent.setup();
    const ref = createRef<HTMLButtonElement>();
    let finishLoading!: () => void;
    function Example() {
      const [value, setValue] = useState("a");
      const [pending, setPending] = useState(false);
      finishLoading = () => setPending(false);
      return <><SelectControl ref={ref} ariaLabel="项目" value={value} disabled={pending}
        options={[{ value: "a", label: "项目 A" }, { value: "b", label: "项目 B" }]}
        onValueChange={(next) => { setValue(next); setPending(true); }} /><input aria-label="下一项" /></>;
    }
    render(<Example />);
    const trigger = screen.getByRole("combobox", { name: "项目" });
    expect(ref.current).toBe(trigger);
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "项目 B" }));
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute("data-value", "b");
    const next = screen.getByRole("textbox", { name: "下一项" });
    if (moveFocus) await user.click(next);
    act(() => finishLoading());
    await waitFor(() => expect(moveFocus ? next : trigger).toHaveFocus());
  });

  it("round trips empty values and prefix-like business IDs without collisions", async () => {
    const onValueChange = vi.fn();
    function Example() {
      const [value, setValue] = useState("");
      return <ModalDialog open className="confirm-dialog" onDismiss={() => undefined}>
        {({ titleId }) => <><h2 id={titleId}>项目关联</h2><label htmlFor="choice">关联项目</label><p id="choice-help">可取消关联。</p><SelectControl id="choice" value={value} options={[{ value: "", label: "不关联" }, { value: "select-control:", label: "前缀项目" }, { value: "__empty__", label: "普通项目" }]} onValueChange={(next) => { setValue(next); onValueChange(next); }} ariaDescribedBy="choice-help" ariaInvalid ariaRequired className="custom-trigger" size="sm" /></>}
      </ModalDialog>;
    }
    render(<Example />);
    const user = userEvent.setup();
    const trigger = screen.getByRole("combobox", { name: "关联项目" });
    expect(trigger).toHaveTextContent("不关联");
    expect(trigger).toHaveAttribute("data-value", "");
    expect(trigger).toHaveAttribute("aria-required", "true");
    expect(trigger).toHaveAttribute("aria-invalid", "true");
    expect(trigger).toHaveAccessibleDescription("可取消关联。");
    expect(trigger).toHaveAttribute("data-size", "sm");
    expect(trigger).toHaveClass("custom-trigger");
    await user.click(trigger);
    expect(screen.getByRole("listbox")).toHaveClass("select-menu--modal", "max-h-64");
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

  it("preserves placeholder, disabled state and callback ref cleanup when no empty option exists", () => {
    const cleanupRef = vi.fn();
    const ref = vi.fn((node: HTMLButtonElement | null) => node ? cleanupRef : undefined);
    const { unmount } = render(<SelectControl ref={ref} ariaLabel="选择模块" value="" options={[{ value: "module", label: "模块" }]} onValueChange={vi.fn()} placeholder="请选择模块" disabled />);
    const trigger = screen.getByRole("combobox", { name: "选择模块" });
    expect(trigger).toHaveTextContent("请选择模块");
    expect(trigger).toBeDisabled();
    expect(ref).toHaveBeenCalledWith(trigger);
    unmount();
    expect(cleanupRef).toHaveBeenCalledOnce();
  });
});
