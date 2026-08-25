import { describe, expect, it } from "vitest";
import { declarationsFor, readStylesheet } from "@/test/cssAssertions";

describe("FeedbackDialog header layout", () => {
  it("keeps the close button in the header's top-right slot", () => {
    const header = declarationsFor(readStylesheet("src/styles.css"), ".feedback-dialog-header");

    expect(header.display).toBe("flex");
    expect(header["flex-direction"]).toBe("row");
    expect(header["justify-content"]).toBe("space-between");
  });
});
