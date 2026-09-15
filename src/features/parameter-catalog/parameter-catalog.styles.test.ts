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

  it("keeps narrow-screen navigation and identity text manageable", () => {
    // The detail and timeline are disclosed in one dialog at every viewport, so
    // there is no inline detail/timeline pane left to hide here.
    const styles = readStylesheet(stylesheet);
    const inlineDetailPane = styles.includes(".parameter-catalog__pane--detail");
    const mobileNavigator = declarationsFor(
      styles,
      ".parameter-catalog[data-catalog-layout=\"mobile\"] .parameter-catalog__navigator"
    );
    const identity = declarationsFor(styles, ".parameter-catalog__identity");

    expect(inlineDetailPane).toBe(false);
    expect(mobileNavigator["max-height"]).toBe("16rem");
    expect(identity["overflow-wrap"]).toBe("anywhere");
    expect(identity["word-break"]).toBe("break-word");
  });
});
