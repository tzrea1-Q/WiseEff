import { describe, expect, it } from "vitest";
import { scanCssContent } from "../../../scripts/check-ui-standards";
import { parseCssRules, readStylesheet } from "@/test/cssAssertions";

describe("module governance workbench presentation", () => {
  it("uses tokens throughout the module governance surfaces and keeps the shell gutter", () => {
    const styles = readStylesheet("src/styles.css");
    const rules = parseCssRules(styles).filter((rule) =>
      /\.(parameter-module-mapping-panel|module-attribution-tree|canonical-driver-discovery)/.test(rule.selector));
    expect(rules.length).toBeGreaterThan(0);
    const pageStyles = rules.map((rule) => `${rule.selector} { ${Object.entries(rule.declarations)
      .map(([property, value]) => `${property}: ${value};`).join(" ")} }`).join("\n");
    expect(scanCssContent("module-governance.css", pageStyles)).toEqual([]);
    expect(scanCssContent("module-governance.css", readStylesheet("src/components/parameter-topology/module-governance.css"))).toEqual([]);
  });
});
