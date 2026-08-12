import { describe, expect, it } from "vitest";
import { declarationFor, declarationsFor, readStylesheet } from "./test/cssAssertions";

const css = readStylesheet("src/styles.css");

describe("topbar control styles", () => {
  it("keeps the global search field compact in the topbar", () => {
    const searchbox = declarationsFor(css, ".searchbox");

    expect(searchbox.height).toBe("32px");
    expect(searchbox.padding).toBe("0 12px");
    expect(declarationFor(css, ".searchbox input", "height")).toBe("100%");
  });

  it("constrains the project selector to the narrow topbar width", () => {
    const mobile = declarationsFor(css, ".topbar-project-select", {
      within: "(max-width: 900px)"
    });

    expect(mobile.width).toBe("100%");
    expect(mobile["max-width"]).toBe("100%");
    expect(mobile["min-width"]).toBe("0");
  });
});
