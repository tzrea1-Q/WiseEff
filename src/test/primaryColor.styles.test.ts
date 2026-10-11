import { describe, expect, it } from "vitest";

import { declarationsFor, parseCssRules, readStylesheet } from "./cssAssertions";

describe("primary color contract", () => {
  it.each([
    ["light", "#0052cc", "#003d9b", "#003d9b"],
    ["dark", "#4c8dff", "#3a72d9", "#4c8dff"]
  ])("separates resting, pressed and selected-navigation colors in %s mode", (theme, primary, pressed, selected) => {
    const styles = readStylesheet("src/styles.css");
    const tokens = {
      ...declarationsFor(styles, ":root"),
      ...(theme === "dark" ? declarationsFor(styles, ".dark") : {})
    };
    const resolve = (token: string): string => {
      const value = tokens[token];
      const alias = value?.match(/^var\((--[\w-]+)\)$/)?.[1];
      return alias ? resolve(alias) : value;
    };

    expect(resolve("--primary")).toBe(primary);
    expect(resolve("--app-primary")).toBe(primary);
    expect(resolve("--accent-pressed")).toBe(pressed);
    expect(resolve("--nav-selected")).toBe(selected);
  });

  it("lets Bridge primary actions inherit their colors instead of redefining them", () => {
    const rules = parseCssRules(readStylesheet("src/styles.css"));
    for (const rule of rules.filter((entry) => entry.selectors.some((selector) => selector.includes(".local-device-bridge-panel__install-cta")))) {
      expect(rule.declarations.background, rule.selector).toBeUndefined();
      expect(rule.declarations["background-color"], rule.selector).toBeUndefined();
      expect(rule.declarations.color, rule.selector).toBeUndefined();
      expect(rule.declarations["border-color"], rule.selector).toBeUndefined();
    }
  });
});
