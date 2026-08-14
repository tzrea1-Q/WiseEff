import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
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
    const modalDialog = readFileSync(resolve(__dirname, "../../components/common/ModalDialog.tsx"), "utf8");
    const confirmDialog = readFileSync(resolve(__dirname, "../../components/common/ConfirmDialog.tsx"), "utf8");
    const sheet = readFileSync(resolve(__dirname, "../../components/ui/sheet.tsx"), "utf8");

    expect(modalDialog).toContain('role="dialog"');
    expect(confirmDialog).toContain("<ModalDialog");
    expect(sheet).toContain("Dialog as SheetPrimitive");
    expect(sheet).toContain("SheetPrimitive.Content");
  });
});
