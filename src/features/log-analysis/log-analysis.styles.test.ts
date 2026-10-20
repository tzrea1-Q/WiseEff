import { describe, expect, it } from "vitest";

import { declarationsFor, readStylesheet } from "@/test/cssAssertions";

describe("log topic chart layout", () => {
  it("uses compact muted reason rows and monospace file names", () => {
    const css = readStylesheet("src/features/log-analysis/log-analysis.css");
    const list = declarationsFor(css, ".log-skill-reasons"), file = declarationsFor(css, ".log-skill-reason-file");
    expect(list.gap).toBe("var(--space-1)");
    expect(list["padding-left"]).toBe("var(--space-4)");
    expect(list["font-size"]).toBe("var(--text-xs)");
    expect(list.color).toBe("var(--text-muted)");
    expect(file["font-family"]).toBe("var(--font-mono)");
    expect(file.color).toBe("var(--text-muted)");
  });
  it("keeps the count and minimum bar tracks at their existing tokenized heights", () => {
    const tokens = declarationsFor(readStylesheet("src/styles.css"), ":root");
    const bar = declarationsFor(readStylesheet("src/features/log-analysis/log-analysis.css"), ".topic-line-chart__bar");

    expect(bar["grid-template-rows"]).toBe("var(--leading-sm) minmax(var(--space-12), 1fr) auto");
    expect(tokens["--leading-sm"]).toBe("18px");
    expect(tokens["--space-12"]).toBe("48px");
  });
});
