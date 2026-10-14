import { describe, expect, it } from "vitest";
import { declarationsFor, readStylesheet } from "../../test/cssAssertions";

describe("DtsBindingHistoryDiffDialog design-system styles", () => {

  it("uses the dialog-title typography token for its heading", () => {
    const heading = declarationsFor(
      readStylesheet("src/styles.css"),
      ".parameter-history-diff-dialog__head h2",
    );

    expect(heading["font-size"]).toBe("var(--text-lg)");
  });
});
