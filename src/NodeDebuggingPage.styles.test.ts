import { describe, expect, it } from "vitest";
import { declarationsFor, readStylesheet } from "./test/cssAssertions";

describe("NodeDebuggingPage table value presentation", () => {
  it("keeps multiline current values readable inside a bounded preview", () => {
    const styles = readStylesheet("src/styles.css");
    const preview = declarationsFor(styles, ".node-debugging-page .debug-value-preview");

    expect(preview.display).toBe("-webkit-box");
    expect(preview["white-space"]).toBe("pre-wrap");
    expect(preview["overflow-wrap"]).toBe("anywhere");
    expect(preview["-webkit-box-orient"]).toBe("vertical");
    expect(preview["-webkit-line-clamp"]).toBe("4");
    expect(preview.overflow).toBe("hidden");
    expect(preview["text-overflow"]).toBe("ellipsis");
  });
});
