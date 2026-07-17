import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function blockFor(selector: string) {
  const css = readFileSync("src/styles.css", "utf8");
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}

describe("topbar control styles", () => {
  it("keeps the global search field compact in the topbar", () => {
    const searchboxStyles = blockFor(".searchbox");
    const searchInputStyles = blockFor(".searchbox input");

    expect(searchboxStyles).toContain("height: 32px;");
    expect(searchboxStyles).toContain("padding: 0 12px;");
    expect(searchInputStyles).toContain("height: 100%;");
  });

  it("constrains the project selector to the narrow topbar width", () => {
    const css = readFileSync("src/styles.css", "utf8");
    const mobileRule = css.match(
      /@media \(max-width: 900px\)[\s\S]*?\.topbar-project-select\s*\{([^}]*)\}/,
    )?.[1] ?? "";

    expect(mobileRule).toContain("width: 100%;");
    expect(mobileRule).toContain("max-width: 100%;");
    expect(mobileRule).toContain("min-width: 0;");
  });
});
