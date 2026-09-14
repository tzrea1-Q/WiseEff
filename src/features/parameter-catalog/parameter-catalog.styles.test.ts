import { describe, expect, it } from "vitest";

import { declarationsFor, readStylesheet } from "@/test/cssAssertions";

const stylesheet = "src/features/parameter-catalog/parameter-catalog.css";

describe("parameter catalog layout contract", () => {
  it("gives the definition table the main work area beside a bounded module navigator", () => {
    const styles = readStylesheet(stylesheet);
    const page = declarationsFor(styles, ".parameter-catalog");
    const workspace = declarationsFor(styles, ".parameter-catalog__workspace");
    const desktop = declarationsFor(
      styles,
      ".parameter-catalog[data-catalog-layout=\"desktop\"] .parameter-catalog__workspace"
    );
    const pane = declarationsFor(styles, ".parameter-catalog__pane");
    const navigator = declarationsFor(styles, ".parameter-catalog__navigator");
    const table = declarationsFor(styles, ".parameter-catalog table");

    expect(page["overflow-x"]).toBe("hidden");
    expect(page["min-width"]).toBe("0");
    expect(page["max-width"]).toBe("100%");
    expect(workspace["grid-template-columns"]).toBe("minmax(0, 1fr)");
    // The table keeps all remaining width; detail is not a permanent peer track.
    expect(desktop["grid-template-columns"]).toBe("minmax(15rem, 20rem) minmax(0, 1fr)");
    expect(desktop["grid-template-columns"]).not.toContain("1.05fr");
    expect(pane["min-width"]).toBe("0");
    expect(pane.overflow).toBe("auto");
    expect(navigator["min-width"]).toBe("0");
    expect(navigator.overflow).toBe("auto");
    // A readable floor plus horizontal scroll, so columns are never crushed.
    expect(table["min-width"]).toBe("48rem");
  });

  it("hides overflow panes at narrow viewports instead of stacking mixed views", () => {
    const styles = readStylesheet(stylesheet);
    const tabletTimeline = declarationsFor(
      styles,
      ".parameter-catalog[data-catalog-layout=\"tablet\"] .parameter-catalog__pane--timeline"
    );
    const mobileDetail = declarationsFor(
      styles,
      ".parameter-catalog[data-catalog-layout=\"mobile\"] .parameter-catalog__pane--detail"
    );
    const mobileTimeline = declarationsFor(
      styles,
      ".parameter-catalog[data-catalog-layout=\"mobile\"] .parameter-catalog__pane--timeline"
    );
    const mobileNavigator = declarationsFor(
      styles,
      ".parameter-catalog[data-catalog-layout=\"mobile\"] .parameter-catalog__navigator"
    );
    const identity = declarationsFor(styles, ".parameter-catalog__identity");

    expect(tabletTimeline.display).toBe("none");
    expect(mobileDetail.display).toBe("none");
    expect(mobileTimeline.display).toBe("none");
    expect(mobileNavigator["max-height"]).toBe("16rem");
    expect(identity["overflow-wrap"]).toBe("anywhere");
    expect(identity["word-break"]).toBe("break-word");
  });
});
