import { describe, expect, it } from "vitest";

import { declarationsFor, hasRule, readStylesheet } from "@/test/cssAssertions";

const stylesheet = "src/features/parameter-catalog/parameter-catalog.css";

describe("parameter catalog layout contract", () => {
  it("keeps a usable selection target without introducing padding or selection-border label drift", () => {
    const styles = readStylesheet(stylesheet);
    const select = declarationsFor(styles, ".parameter-catalog__tree-select");
    const selectedRow = declarationsFor(styles, ".parameter-catalog__tree-row.is-selected");

    expect(select["min-height"]).toBe("var(--module-navigator-disclosure-size)");
    expect(select["grid-column"]).toBe("2 / -1");
    expect(select.padding).toBe("0");
    expect(select.border).toBe("0");
    expect(selectedRow["border-left"]).toBeUndefined();
  });

  it("gives the definition table the main work area beside a bounded module navigator", () => {
    const styles = readStylesheet(stylesheet);
    const template = readStylesheet("src/components/layout/navigator-workbench.css");
    const page = declarationsFor(styles, ".parameter-catalog");
    const workspace = declarationsFor(template, ".navigator-workbench__body");
    const pane = declarationsFor(template, ".navigator-workbench__task");
    const navigation = declarationsFor(template, ".navigator-workbench__navigation");
    const table = declarationsFor(styles, ".parameter-catalog table");

    expect(page["overflow-x"]).toBe("hidden");
    expect(page["min-width"]).toBe("0");
    expect(page["max-width"]).toBe("100%");
    expect(workspace["grid-template-columns"]).toBe("min(var(--navigator-workbench-navigator-width), var(--navigator-workbench-navigator-cap)) minmax(0, 1fr)");
    expect(hasRule(styles, ".parameter-catalog__workspace")).toBe(false);
    expect(hasRule(styles, ".parameter-catalog__navigator")).toBe(false);
    expect(hasRule(styles, ".parameter-catalog__pane")).toBe(false);
    expect(pane["min-width"]).toBe("0");
    expect(pane.overflow).toBe("auto");
    expect(pane["max-height"]).toBe("var(--navigator-workbench-pane-height)");
    expect(navigation.overflow).toBe("auto");
    // A readable floor plus horizontal scroll, so columns are never crushed.
    expect(table["min-width"]).toBe("48rem");
  });

  it("keeps secondary table cells single-line without shrinking status or actions", () => {
    const styles = readStylesheet(stylesheet);
    const secondaryCells = declarationsFor(
      styles,
      '.parameter-catalog__table td:not(.parameter-catalog__lifecycle):not([data-label="操作"])'
    );
    const lifecycle = declarationsFor(styles, ".parameter-catalog__table .parameter-catalog__lifecycle");
    const actions = declarationsFor(styles, ".parameter-catalog__table th:last-child");

    expect(secondaryCells["white-space"]).toBe("nowrap");
    expect(secondaryCells.overflow).toBe("hidden");
    expect(secondaryCells["text-overflow"]).toBe("ellipsis");
    expect(lifecycle.width).toBe("var(--pcat-table-status-width)");
    expect(actions.width).toBe("var(--pcat-table-actions-width)");
  });

  it("keeps narrow-screen navigation and identity text manageable", () => {
    // The detail and timeline are disclosed in one dialog at every viewport, so
    // there is no inline detail/timeline pane left to hide here.
    const styles = readStylesheet(stylesheet);
    const inlineDetailPane = styles.includes(".parameter-catalog__pane--detail");
    const template = readStylesheet("src/components/layout/navigator-workbench.css");
    const navigator = declarationsFor(template, ".navigator-workbench__navigator");
    const identity = declarationsFor(styles, ".parameter-catalog__identity");

    expect(inlineDetailPane).toBe(false);
    expect(navigator["max-height"]).toBe("var(--navigator-workbench-pane-height)");
    expect(identity["overflow-wrap"]).toBe("anywhere");
    expect(identity["word-break"]).toBe("break-word");
  });
});
