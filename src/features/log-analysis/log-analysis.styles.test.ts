import { describe, expect, it } from "vitest";

import { declarationsFor, readStylesheet } from "@/test/cssAssertions";

describe("log analysis styles", () => {
  it("uses existing design tokens for evidence spacing, type and border", () => {
    const css = readStylesheet("src/features/log-analysis/log-analysis.css");
    const evidence = declarationsFor(css, ".evidence-card__body code");
    expect(evidence.padding).toBe("var(--space-2)");
    expect(evidence["font-size"]).toBe("var(--text-xs)");
    expect(evidence["border-radius"]).toBe("var(--radius-md)");
  });
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
});
