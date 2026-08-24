import { describe, expect, it } from "vitest";

import { declarationFor, readStylesheet } from "../../test/cssAssertions";

describe("Xiaoze welcome panel layout", () => {
  it("uses a font-independent width for the welcome copy", () => {
    const styles = readStylesheet("src/styles.css");

    expect(declarationFor(styles, ":root", "--xiaoze-welcome-copy-width")).toBe("270px");
    expect(declarationFor(styles, ".xiaoze-welcome__subtitle", "max-width")).toBe(
      "var(--xiaoze-welcome-copy-width)"
    );
  });
});
