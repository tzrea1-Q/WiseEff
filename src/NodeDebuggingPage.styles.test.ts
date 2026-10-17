import { describe, expect, it } from "vitest";
import { declarationsFor, parseCssRules, readStylesheet } from "./test/cssAssertions";
import { scanCssContent } from "../scripts/check-ui-standards";

describe("NodeDebuggingPage table value presentation", () => {
  it("uses the shared body typography tokens for node paths", () => {
    const css = readStylesheet("src/node-debugging-refinement.css");
    const path = declarationsFor(css, ".node-detail-editor .node-detail-path__value");
    expect(path["font-size"]).toBe("var(--text-base)");
    expect(path["line-height"]).toBe("var(--leading-base)");
  });

  it("bounds the first-time Bridge installer so both debugging workbenches keep their task rows in view", () => {
    const context = declarationsFor(readStylesheet("src/styles.css"), ".debugging-workbench-content .navigator-workbench__context");

    expect(context["max-height"]).toBe("calc(3 * var(--space-16))");
  });

  it("uses visual tokens for debugging and reload page styles", () => {
    const pageRules = parseCssRules(readStylesheet("src/styles.css"))
      .filter((rule) => /\.node-|dts-reload|debug-detail|debug-value|debugging-(action|deploy|stash|workbench)|bridge-target-picker/.test(rule.selector));
    expect(pageRules.length).toBeGreaterThan(0);
    const styles = pageRules.map((rule) => `${rule.selector} { ${Object.entries(rule.declarations)
      .map(([property, value]) => `${property}: ${value};`).join(" ")} }`).join("\n");
    expect(scanCssContent("debugging-pages.css", styles)).toEqual([]);
    expect(scanCssContent("dts-reload-candidate-table.css", readStylesheet("src/features/dts-reload/dts-reload-candidate-table.css"))).toEqual([]);
    expect(scanCssContent("node-debugging-refinement.css", readStylesheet("src/node-debugging-refinement.css"))).toEqual([]);
  });
});
