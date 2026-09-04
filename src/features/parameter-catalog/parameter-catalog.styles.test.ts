import { describe, expect, it } from "vitest";

import { declarationsFor, readStylesheet } from "@/test/cssAssertions";

const stylesheet = "src/features/parameter-catalog/parameter-catalog.css";

describe("parameter catalog layout contract", () => {
  it("keeps the page from overflowing and uses a three-column desktop workspace", () => {
    const styles = readStylesheet(stylesheet);
    const page = declarationsFor(styles, ".parameter-catalog");
    const workspace = declarationsFor(styles, ".parameter-catalog__workspace");
    const desktop = declarationsFor(
      styles,
      ".parameter-catalog[data-catalog-layout=\"desktop\"] .parameter-catalog__workspace"
    );
    const pane = declarationsFor(styles, ".parameter-catalog__pane");

    expect(page["overflow-x"]).toBe("hidden");
    expect(page["min-width"]).toBe("0");
    expect(page["max-width"]).toBe("100%");
    expect(workspace["grid-template-columns"]).toBe("minmax(0, 1fr)");
    expect(desktop["grid-template-columns"]).toBe("minmax(0, 1.05fr) minmax(0, 1.2fr) minmax(0, 0.95fr)");
    expect(pane["min-width"]).toBe("0");
    expect(pane.overflow).toBe("auto");
  });

  it("hides overflow detail and timeline panes at tablet and mobile instead of stacking mixed views", () => {
    const styles = readStylesheet(stylesheet);
    const tabletDetail = declarationsFor(
      styles,
      ".parameter-catalog[data-catalog-layout=\"tablet\"] .parameter-catalog__pane--detail"
    );
    const tabletTimeline = declarationsFor(
      styles,
      ".parameter-catalog[data-catalog-layout=\"tablet\"] .parameter-catalog__pane--timeline"
    );
    const mobileDetail = declarationsFor(
      styles,
      ".parameter-catalog[data-catalog-layout=\"mobile\"] .parameter-catalog__pane--detail"
    );
    const identity = declarationsFor(styles, ".parameter-catalog__identity");

    expect(tabletDetail.display).toBe("none");
    expect(tabletTimeline.display).toBe("none");
    expect(mobileDetail.display).toBe("none");
    expect(identity["overflow-wrap"]).toBe("anywhere");
    expect(identity["word-break"]).toBe("break-word");
  });
});
