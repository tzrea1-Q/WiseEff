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
