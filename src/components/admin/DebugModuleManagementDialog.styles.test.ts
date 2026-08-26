import { describe, expect, it } from "vitest";
import { declarationsFor, readStylesheet } from "../../test/cssAssertions";

describe("debug module management more-menu portal styling", () => {
  it("styles the portaled menu and its items inside the module dialog", () => {
    const styles = readStylesheet("src/styles.css");
    const menu = declarationsFor(styles, ".param-admin-module-dialog .dropdown-menu");
    const item = declarationsFor(styles, ".param-admin-module-dialog .dropdown-item");

    expect(menu.position).toBe("absolute");
    expect(menu["z-index"]).toBe("var(--z-sticky)");
    expect(menu.background).toBe("var(--surface)");
    expect(item.display).toBe("flex");
    expect(item.cursor).toBe("pointer");

    const portaledMenu = declarationsFor(styles, ".param-admin-module-more-menu-list");
    expect(portaledMenu.position).toBe("fixed");
    expect(portaledMenu["z-index"]).toBe("var(--z-modal-backdrop-nested)");
    expect(portaledMenu.overflow).toBe("visible");

    const portaledItem = declarationsFor(styles, ".param-admin-module-more-menu-list .dropdown-item");
    expect(portaledItem.display).toBe("flex");
    expect(portaledItem["white-space"]).toBe("nowrap");
  });
});
