import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { ModalDialog, type ModalDialogRenderProps } from "../../components/common/ModalDialog";
import { Sheet, SheetContent, SheetTitle } from "../../components/ui/sheet";
import { declarationsFor, hasRule, readStylesheet } from "../../test/cssAssertions";

/**
 * TD-091: the hint is absolutely positioned beside the FAB with pointer-events
 * enabled so users can click through to open chat. When any dialog/sheet is open
 * it must not intercept drawer footer actions — suppress via CSS, not unmount,
 * so the per-page "already shown" storage contract stays intact.
 */
describe("XiaozeToggleHint dialog suppression", () => {
  it("disables pointer hit-testing and hides the hint while a dialog is open", () => {
    const styles = readStylesheet("src/styles.css");
    const selector = 'body:has([role="dialog"]) .xiaoze-toggle-hint';

    expect(hasRule(styles, selector)).toBe(true);

    const suppressed = declarationsFor(styles, selector);
    expect(suppressed["pointer-events"]).toBe("none");
    expect(suppressed.visibility).toBe("hidden");
  });

  it("relies on role=dialog from the shared modal and sheet primitives", () => {
    render(
      createElement(ModalDialog, {
        open: true,
        onDismiss: vi.fn(),
        className: "test-dialog",
        children: ({ titleId }: ModalDialogRenderProps) =>
          createElement("h2", { id: titleId }, "共享模态框"),
      })
    );
    expect(screen.getByRole("dialog", { name: "共享模态框" })).toBeInTheDocument();
    cleanup();

    render(
      createElement(ConfirmDialog, {
        open: true,
        title: "确认操作",
        description: "确认说明",
        confirmLabel: "确认",
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      })
    );
    expect(screen.getByRole("dialog", { name: "确认操作" })).toBeInTheDocument();
    cleanup();

    render(
      createElement(
        Sheet,
        { open: true },
        createElement(
          SheetContent,
          { showCloseButton: false },
          createElement(SheetTitle, null, "共享抽屉")
        )
      )
    );
    expect(screen.getByRole("dialog", { name: "共享抽屉" })).toBeInTheDocument();
  });
});
