import { describe, expect, it } from "vitest";

import { declarationsFor, hasAtRule, parseCssRules } from "./cssAssertions";

describe("cssAssertions", () => {
  it("keeps declaration queries stable across whitespace and declaration order", () => {
    const compact = ".card{display:grid;gap:var(--space-2);}";
    const reformatted = `
      .card {
        gap: var(--space-2);
        display: grid;
      }
    `;

    const compactDeclarations = declarationsFor(compact, ".card");
    const reformattedDeclarations = declarationsFor(reformatted, ".card");

    expect(compactDeclarations).toEqual(reformattedDeclarations);
    expect(compactDeclarations).toEqual({
      display: "grid",
      gap: "var(--space-2)"
    });
  });

  it("queries named keyframes through parsed at-rule structure", () => {
    const css = "@keyframes pulse { from { opacity: 0; } to { opacity: 1; } }";

    expect(hasAtRule(css, "@keyframes pulse")).toBe(true);
    expect(hasAtRule(css, "@keyframes retiredPulse")).toBe(false);
    expect(parseCssRules(css).map((rule) => rule.selector)).toEqual(["from", "to"]);
  });
});
