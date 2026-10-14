import { describe, expect, it } from "vitest";
import { declarationsFor, hasRule, readStylesheet } from "../../test/cssAssertions";

describe("DtsBindingCompareDialog styles after ModalDialog migration", () => {
  it("gives the portaled card its own chrome and pins scroll to the body", () => {
    const styles = readStylesheet("src/styles.css");
    const card = declarationsFor(styles, ".dts-binding-compare-dialog");
    expect(card["max-height"]).toBe("calc(100dvh - var(--space-12))");
    expect(card.padding).toBe("var(--space-4)");
    expect(card.background).toBe("var(--surface)");
    expect(card["box-shadow"]).toBe("var(--shadow-3)");
    expect(hasRule(styles, ".dts-binding-compare-dialog__overlay")).toBe(false);
    expect(
      hasRule(styles, ".modal-backdrop.dts-binding-compare-dialog__overlay", {
        within: "@media"
      })
    ).toBe(true);
  });
});
