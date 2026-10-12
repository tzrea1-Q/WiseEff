import { describe, expect, it } from "vitest";
import { declarationsFor, parseCssRules, readStylesheet } from "./test/cssAssertions";
import { scanCssContent } from "../scripts/check-ui-standards";

describe("NodeDebuggingPage table value presentation", () => {
  it("bounds the first-time Bridge installer so both debugging workbenches keep their task rows in view", () => {
    const context = declarationsFor(readStylesheet("src/styles.css"), ".debugging-workbench-content .navigator-workbench__context");

    expect(context["max-height"]).toBe("calc(3 * var(--space-16))");
    expect(context.overflow).toBe("auto");
    expect(context["overscroll-behavior"]).toBe("contain");
  });

  it("uses visual tokens for debugging and reload page styles", () => {
    const pageRules = parseCssRules(readStylesheet("src/styles.css"))
      .filter((rule) => /\.node-|dts-reload|debug-detail|debug-value|debugging-(action|deploy|stash|workbench)|bridge-target-picker/.test(rule.selector));
    expect(pageRules.length).toBeGreaterThan(0);
    const styles = pageRules.map((rule) => `${rule.selector} { ${Object.entries(rule.declarations)
      .map(([property, value]) => `${property}: ${value};`).join(" ")} }`).join("\n");
    expect(scanCssContent("debugging-pages.css", styles)).toEqual([]);
    expect(scanCssContent("dts-reload-candidate-table.css", readStylesheet("src/features/dts-reload/dts-reload-candidate-table.css"))).toEqual([]);
  });

  it("keeps multiline current values readable inside a bounded preview", () => {
    const styles = readStylesheet("src/styles.css");
    const preview = declarationsFor(styles, ".node-debugging-page .debug-value-preview");

    expect(preview.display).toBe("-webkit-box");
    expect(preview["white-space"]).toBe("pre-wrap");
    expect(preview["overflow-wrap"]).toBe("anywhere");
    expect(preview["-webkit-box-orient"]).toBe("vertical");
    expect(preview["-webkit-line-clamp"]).toBe("4");
    expect(preview.overflow).toBe("hidden");
    expect(preview["text-overflow"]).toBe("ellipsis");
  });
});
