import { describe, expect, it } from "vitest";
import { declarationsFor, readStylesheet } from "../../test/cssAssertions";

describe("debug module management more-menu portal styling", () => {
  it("styles the portaled menu and its items inside the module dialog", () => {
    const styles = readStylesheet("src/styles.css");
    const menu = declarationsFor(styles, ".param-admin-module-dialog .dropdown-menu");
    expect(menu["z-index"]).toBe("var(--z-sticky)");
    expect(menu.background).toBe("var(--surface)");

    const portaledMenu = declarationsFor(styles, ".param-admin-module-more-menu-list");
    expect(portaledMenu["z-index"]).toBe("var(--z-modal-backdrop-nested)");
  });
});
