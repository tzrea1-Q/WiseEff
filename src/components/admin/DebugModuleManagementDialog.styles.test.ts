import { describe, expect, it } from "vitest";
import { declarationsFor, readStylesheet } from "../../test/cssAssertions";

describe("debug module management more-menu portal styling", () => {
  it("styles the portaled menu and its items inside the module dialog", () => {
    const styles = readStylesheet("src/styles.css");
    const menu = declarationsFor(styles, ".param-admin-module-dialog .dropdown-menu");
    expect(menu["z-index"]).toBe("var(--z-sticky)");

    const sharedStyles = readStylesheet("src/components/common/select-control.css");
    for (const selector of [".dropdown-menu", ".row-action-menu__content"]) {
      const sharedMenu = declarationsFor(sharedStyles, selector);
      expect(sharedMenu.background).toBe("var(--surface)");
      expect(sharedMenu["border-radius"]).toBe("var(--radius-md)");
      expect(sharedMenu.font).toBe("400 var(--text-sm) / var(--leading-sm) var(--font-sans)");
    }

    const portaledMenu = declarationsFor(
      readStylesheet("src/components/common/row-action-menu.css"),
      ".row-action-menu__content--modal"
    );
    expect(portaledMenu["z-index"]).toBe("var(--z-modal-backdrop-nested)");
  });
});
