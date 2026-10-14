import { describe, expect, it } from "vitest";
import { declarationsFor, readStylesheet } from "./test/cssAssertions";

const css = readStylesheet("src/styles.css");

describe("topbar control styles", () => {
  it("keeps the global search field compact in the topbar", () => {
    const searchbox = declarationsFor(css, ".searchbox");
    expect(searchbox.padding).toBe("0 var(--space-3)");
  });
});
