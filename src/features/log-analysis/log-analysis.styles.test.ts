import { describe, expect, it } from "vitest";

import { declarationsFor, readStylesheet } from "@/test/cssAssertions";

describe("logs navigator workbench layout", () => {
  it("leaves pane geometry to the shared template and consumes tokens for visual lengths", () => {
    const css = readStylesheet("src/features/log-analysis/log-analysis.css");
    expect(declarationsFor(css, ".logs-v2")["grid-template-columns"]).toBeUndefined();
    expect(declarationsFor(css, ".logs-v2-main")["grid-template-rows"]).toBeUndefined();
    expect(css.replace(/@media[^{]+\{/g, "").match(/\b[\d.]+(?:px|rem|em)\b/g)).toBeNull();
  });
});

describe("log topic chart layout", () => {
  it("keeps the count and minimum bar tracks at their existing tokenized heights", () => {
    const tokens = declarationsFor(readStylesheet("src/styles.css"), ":root");
    const bar = declarationsFor(readStylesheet("src/features/log-analysis/log-analysis.css"), ".topic-line-chart__bar");

    expect(bar["grid-template-rows"]).toBe("var(--leading-sm) minmax(var(--space-12), 1fr) auto");
    expect(tokens["--leading-sm"]).toBe("18px");
    expect(tokens["--space-12"]).toBe("48px");
  });
});
