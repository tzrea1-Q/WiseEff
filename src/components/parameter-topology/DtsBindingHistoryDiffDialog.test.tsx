import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DtsBindingHistoryDiffDialog } from "./DtsBindingHistoryDiffDialog";

const historyEntries = [
  {
    id: "revision-2",
    changedAt: "2026-01-02T00:00:00.000Z",
    actor: "陈晨",
    fromRawValue: "<1>",
    toRawValue: "<2>"
  }
];

describe("DtsBindingHistoryDiffDialog", () => {
  it("uses the shared modal contract for naming, focus, and safe dismissal", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            查看历史差异
          </button>
          {open ? (
            <DtsBindingHistoryDiffDialog
              propertyKey="gpio_int"
              historyEntries={historyEntries}
              onClose={() => setOpen(false)}
            />
          ) : null}
        </div>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "查看历史差异" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "gpio_int 历史差异" });
    expect(dialog).toHaveAccessibleDescription("按提交顺序查看历史修订带来的参数值变化。");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveClass("dts-binding-history-diff-dialog");
    expect(dialog.parentElement).toHaveClass(
      "modal-backdrop",
      "dts-binding-history-diff-dialog__overlay"
    );
    expect(dialog.contains(document.activeElement)).toBe(true);

    const first = within(dialog).getByRole("button", { name: "关闭历史差异" });
    const last = within(dialog).getByRole("button", { name: "关闭" });
    last.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(first).toHaveFocus();
    first.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();

    const backdrop = dialog.parentElement!;
    fireEvent.pointerDown(dialog);
    fireEvent.pointerUp(backdrop);
    expect(screen.getByRole("dialog", { name: "gpio_int 历史差异" })).toBeInTheDocument();

    fireEvent.pointerDown(backdrop);
    fireEvent.pointerUp(backdrop);
    expect(screen.queryByRole("dialog", { name: "gpio_int 历史差异" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "gpio_int 历史差异" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("shows both exact revision identities for a revision-only update", () => {
    render(
      <DtsBindingHistoryDiffDialog
        propertyKey="gpio_int"
        historyEntries={[{
          id: "revision-only-update",
          changedAt: "2026-01-03T00:00:00.000Z",
          fromRawValue: "<1>",
          toRawValue: "<2>",
          definitionRevisionId: "definition-revision-12",
          effectiveRevisionId: "effective-revision-13"
        }]}
        onClose={() => undefined}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "gpio_int 历史差异" });
    const card = within(dialog).getByRole("article", {
      name: "值的固定修订 definition-revision-12 / 事件有效修订 effective-revision-13 历史差异"
    });
    expect(card).toHaveTextContent("值的固定修订 definition-revision-12");
    expect(card).toHaveTextContent("事件有效修订 effective-revision-13");
  });
});
