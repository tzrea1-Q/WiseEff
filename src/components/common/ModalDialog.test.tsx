import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { ModalDialog } from "./ModalDialog";

afterEach(cleanup);

function Harness({
  onDismiss,
  dismissible = true
}: {
  onDismiss?: () => void;
  dismissible?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        打开
      </button>
      <button type="button">背景按钮</button>
      <ModalDialog
        open={open}
        onDismiss={
          dismissible
            ? () => {
                onDismiss?.();
                setOpen(false);
              }
            : undefined
        }
        className="confirm-dialog"
        describedBy
      >
        {({ titleId, descriptionId }) => (
          <>
            <h2 id={titleId}>测试弹窗</h2>
            <p id={descriptionId}>弹窗说明</p>
            <button type="button">第一项</button>
            <button type="button">第二项</button>
          </>
        )}
      </ModalDialog>
    </div>
  );
}

describe("ModalDialog", () => {
  it("names and describes the dialog from the card, not the backdrop", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "打开" }));

    const dialog = screen.getByRole("dialog", { name: "测试弹窗" });
    expect(dialog).toHaveClass("confirm-dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("弹窗说明");
  });

  it("moves focus into the dialog on open and back to the trigger on close", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "打开" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "测试弹窗" });
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps Tab inside the dialog", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "打开" }));

    const dialog = screen.getByRole("dialog", { name: "测试弹窗" });
    const first = screen.getByRole("button", { name: "第一项" });
    const last = screen.getByRole("button", { name: "第二项" });

    last.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("does not dismiss when the press starts inside the card and ends on the backdrop", () => {
    const onDismiss = vi.fn();
    render(<Harness onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "打开" }));

    const dialog = screen.getByRole("dialog", { name: "测试弹窗" });
    const backdrop = dialog.parentElement!;

    fireEvent.pointerDown(dialog);
    fireEvent.pointerUp(backdrop);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "测试弹窗" })).toBeInTheDocument();

    fireEvent.pointerDown(backdrop);
    fireEvent.pointerUp(backdrop);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("ignores Escape and backdrop dismissal when no dismiss handler is given", () => {
    render(<Harness dismissible={false} />);
    fireEvent.click(screen.getByRole("button", { name: "打开" }));

    const dialog = screen.getByRole("dialog", { name: "测试弹窗" });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerDown(dialog.parentElement!);
    fireEvent.pointerUp(dialog.parentElement!);
    expect(screen.getByRole("dialog", { name: "测试弹窗" })).toBeInTheDocument();
  });

  it("ignores an Escape already consumed by another layer", () => {
    const onDismiss = vi.fn();
    render(<Harness onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "打开" }));

    // A Radix dialog that routes Escape into a confirmation calls preventDefault
    // while the event is still travelling towards window; the freshly mounted
    // confirmation must not treat that same event as its own dismissal.
    const consumed = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true });
    consumed.preventDefault();
    fireEvent(window, consumed);

    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "测试弹窗" })).toBeInTheDocument();
  });

  it("lets Escape reach only the top-most dialog", () => {
    const outer = vi.fn();
    const inner = vi.fn();

    function Stacked() {
      return (
        <>
          <ModalDialog open onDismiss={outer} className="confirm-dialog outer">
            {({ titleId }) => <h2 id={titleId}>外层弹窗</h2>}
          </ModalDialog>
          <ModalDialog open onDismiss={inner} className="confirm-dialog inner">
            {({ titleId }) => <h2 id={titleId}>内层弹窗</h2>}
          </ModalDialog>
        </>
      );
    }

    render(<Stacked />);
    fireEvent.keyDown(window, { key: "Escape" });

    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it("invokes the latest onDismiss even before the keydown effect re-subscribes", async () => {
    const closeImmediately = vi.fn();
    const openConfirm = vi.fn();
    let markDirty: () => void = () => {};

    function StaleDismissHarness() {
      const [dirty, setDirty] = useState(false);
      markDirty = () => setDirty(true);
      return (
        <ModalDialog open onDismiss={dirty ? openConfirm : closeImmediately} className="confirm-dialog">
          {({ titleId }) => (
            <>
              <h2 id={titleId}>测试弹窗</h2>
              {dirty ? <span>已变脏</span> : null}
            </>
          )}
        </ModalDialog>
      );
    }

    render(<StaleDismissHarness />);

    // Dispatch Escape from the MutationObserver that sees the dirty commit —
    // the same window as findByRole resolving — before useEffect rebinds.
    await new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        if (!document.body.textContent?.includes("已变脏")) {
          return;
        }
        observer.disconnect();
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        resolve();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      markDirty();
    });

    expect(closeImmediately).not.toHaveBeenCalled();
    expect(openConfirm).toHaveBeenCalledTimes(1);
  });
});
