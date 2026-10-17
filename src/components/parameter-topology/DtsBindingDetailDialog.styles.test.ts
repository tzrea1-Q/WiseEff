import { describe, expect, it } from "vitest";
import { declarationsFor, readStylesheet } from "../../test/cssAssertions";

describe("DtsBindingDetailDialog unified inspector styles", () => {
  it("uses shared surface, text, typography and spacing tokens", () => {
    const styles = readStylesheet("src/components/parameter-topology/parameter-inspector.css");
    const card = declarationsFor(styles, ".dts-binding-detail-dialog.parameter-inspector");
    expect(card.background).toBe("var(--surface-raised)");
    expect(card.color).toBe("var(--text)");
    const body = declarationsFor(styles, ".parameter-inspector__content.dts-binding-detail-dialog__content");
    expect(body.padding).toBe("var(--space-6)");
    expect(declarationsFor(styles, ".parameter-inspector h2")["font-size"]).toBe("var(--text-lg)");
    expect(declarationsFor(styles, ".parameter-inspector__editor").gap).toBe("var(--space-2)");
  });
});
