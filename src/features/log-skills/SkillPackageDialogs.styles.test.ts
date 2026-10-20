import { describe, expect, it } from "vitest";
import { declarationsFor, readStylesheet } from "@/test/cssAssertions";

const styles = readStylesheet("src/features/log-skills/skill-workspace.css");

describe("skill package dialogs", () => {
  it("keeps package introductions at the shared dialog body size", () => {
    expect(declarationsFor(styles, ".skill-authoring-dialog .skill-package-intro").font).toBe("400 var(--text-sm) / var(--leading-base) var(--font-sans)");
  });
  it("uses the shared spacing tokens for import, export and their actions", () => {
    expect(declarationsFor(styles, ".skill-authoring-dialog .skill-package-dialog-content").gap).toBe("var(--space-3)");
    expect(declarationsFor(styles, ".skill-package-dialog-content .dialog-actions")["margin-top"]).toBe("var(--space-3)");
  });

  it("uses the error tone and normal text size for issue rows and their paragraphs", () => {
    for (const selector of [".skill-authoring-dialog .skill-package-error", ".skill-package-error p"]) {
      expect(declarationsFor(styles, selector).color).toBe("var(--danger)");
      expect(declarationsFor(styles, selector).font).toBe("400 var(--text-sm) / var(--leading-base) var(--font-sans)");
    }
  });
});
