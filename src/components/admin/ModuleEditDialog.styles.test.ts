import { describe, expect, it } from "vitest";
import { declarationsFor, readStylesheet } from "../../test/cssAssertions";

describe("ModuleEditDialog driver-group layout", () => {
  it("uses a consistent section stack and gives the category picker visible chrome", () => {
    const styles = readStylesheet("src/styles.css");
    const section = declarationsFor(
      styles,
      ".param-admin-module-edit-dialog .module-edit-section"
    );
    const picker = declarationsFor(
      readStylesheet("src/components/common/select-control.css"),
      ".select-control"
    );
    expect(section["border-radius"]).toBe("var(--radius-md)");
    expect(picker.background).toBe("var(--surface)");
    expect(picker["border-radius"]).toBe("var(--radius-sm)");
    expect(picker.border).toBe("var(--stroke-hairline) solid var(--border)");
    expect(picker.font).toBe("400 var(--text-sm) / var(--leading-sm) var(--font-sans)");
  });
});
