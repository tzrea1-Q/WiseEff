import { describe, expect, it } from "vitest";

import { declarationsFor, hasRule, readStylesheet } from "@/test/cssAssertions";

const stylesheet = "src/features/parameter-catalog/parameter-catalog.css";

describe("parameter catalog layout contract", () => {
  it("keeps a usable selection target without introducing padding or selection-border label drift", () => {
    const styles = readStylesheet(stylesheet);
    const select = declarationsFor(styles, ".parameter-catalog__tree-select");

    expect(select["min-height"]).toBe("var(--module-navigator-disclosure-size)");
  });

  it("gives the definition table the main work area beside a bounded module navigator", () => {
    const styles = readStylesheet(stylesheet);
    const template = readStylesheet("src/components/layout/navigator-workbench.css");
    const workspace = declarationsFor(template, ".navigator-workbench__body");
    const pane = declarationsFor(template, ".navigator-workbench__task");
    expect(workspace["grid-template-columns"]).toBe("min(var(--navigator-workbench-navigator-width), var(--navigator-workbench-navigator-cap)) minmax(0, 1fr)");
    expect(hasRule(styles, ".parameter-catalog__workspace")).toBe(false);
    expect(hasRule(styles, ".parameter-catalog__navigator")).toBe(false);
    expect(hasRule(styles, ".parameter-catalog__pane")).toBe(false);
    expect(pane["max-height"]).toBe("var(--navigator-workbench-pane-height)");
  });

  it("keeps secondary table cells single-line without shrinking status or actions", () => {
    const styles = readStylesheet(stylesheet);
    const lifecycle = declarationsFor(styles, ".parameter-catalog__table .parameter-catalog__lifecycle");
    const actions = declarationsFor(styles, ".parameter-catalog__table th:last-child");
    expect(lifecycle.width).toBe("var(--pcat-table-status-width)");
    expect(actions.width).toBe("var(--pcat-table-actions-width)");
  });

  it("fits the first row inside the compact task pane when its content width is below the table floor", () => {
    const table = declarationsFor(readStylesheet(stylesheet), ".parameter-catalog .parameter-catalog__table");
    expect(table["min-width"]).toBe("min(100%, var(--pcat-table-min-width))");
  });

  it("keeps narrow-screen navigation and identity text manageable", () => {
    const template = readStylesheet("src/components/layout/navigator-workbench.css");
    const navigator = declarationsFor(template, ".navigator-workbench__navigator");
    expect(navigator["max-height"]).toBe("var(--navigator-workbench-pane-height)");
  });
});
