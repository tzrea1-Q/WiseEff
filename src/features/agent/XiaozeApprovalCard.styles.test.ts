import { describe, expect, it } from "vitest";

import { declarationFor, hasRule, readStylesheet } from "../../test/cssAssertions";

/**
 * GOV-01: the Xiaoze approval card portals to <body>, so it must outrank the
 * chat popup or the scrim buries it. These checks pin the stacking scale and
 * the approval-specific overrides so a future edit cannot silently drop the
 * card back under the popup.
 */
function stylesheet(): string {
  return readStylesheet("src/styles.css");
}

describe("Xiaoze approval card stacking", () => {
  it("declares the approval layer above the chat popup and below the toast", () => {
    const styles = stylesheet();
    const value = (name: string) => Number(declarationFor(styles, ":root", name));

    const popup = value("--z-xiaoze-popup");
    const approval = value("--z-xiaoze-approval");
    const toast = value("--z-toast");

    expect(Number.isNaN(approval)).toBe(false);
    expect(approval).toBeGreaterThan(popup);
    expect(toast).toBeGreaterThan(approval);
  });

  it("routes the approval overlay and content through the approval layer", () => {
    const css = stylesheet();

    // One rule set only: the data-attribute selectors own the stacking (the
    // legacy .xiaoze-approval-* class pair was removed as duplicate wiring).
    expect(
      declarationFor(
        css,
        '[data-slot="alert-dialog-overlay"]:has(+ [data-testid="xiaoze-approval-card"])',
        "z-index"
      )
    ).toBe("var(--z-xiaoze-approval)");
    expect(declarationFor(css, '[data-testid="xiaoze-approval-card"]', "z-index")).toBe(
      "var(--z-xiaoze-approval)"
    );
    expect(hasRule(css, ".xiaoze-approval-overlay")).toBe(false);
    expect(hasRule(css, ".xiaoze-approval-dialog")).toBe(false);
  });
});
