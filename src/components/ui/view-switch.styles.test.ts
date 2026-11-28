import { describe, expect, it } from "vitest";
import { declarationsFor, readStylesheet } from "../../test/cssAssertions";

describe("ViewSwitch option toggle selection", () => {
  const styles = readStylesheet("src/components/ui/view-switch.css");

  it("raises the selected option with an accent label", () => {
    const selected = declarationsFor(styles, '.view-switch--toggle .view-switch__item[aria-checked="true"]');
    expect(selected["box-shadow"]).toBe("var(--shadow-1)");
    expect(selected.color).toBe("var(--accent)");
  });
});

describe("ViewSwitch page navigation", () => {
  const styles = readStylesheet("src/components/ui/view-switch.css");

  it("uses a hairline divider and reserves the primary underline for the current page", () => {
    const nav = declarationsFor(styles, ".view-switch--page");
    expect(nav["border-bottom"]).toBe("var(--stroke-hairline) solid var(--border)");
    expect(nav["--view-switch-rest-fill"]).toBe("transparent");
    expect(nav["--view-switch-selected-fill"]).toBe("transparent");
    expect(nav["--view-switch-selected-text"]).toBe("var(--accent)");
    const separatedGroup = declarationsFor(styles, ".view-switch__group ~ .view-switch__group");
    expect(separatedGroup["border-inline-start"]).toBe("var(--stroke-hairline) solid var(--border)");
    const selected = declarationsFor(styles, '.view-switch--page .view-switch__item[aria-current="page"]');
    expect(selected["border-block-end-color"]).toBe("var(--accent)");
  });
});
