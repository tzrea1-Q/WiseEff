import { describe, expect, it } from "vitest";
import { declarationsFor, hasRule, readStylesheet } from "../../test/cssAssertions";

const css = readStylesheet("src/styles.css");

/** Non-card project-admin library rules live in the desktop (min-width: 641px) block. */
const desktop = { within: "(min-width: 641px)" } as const;

describe("ProjectAdminTable layout CSS", () => {
  it("gives the project list a table min-width so narrow shells can scroll horizontally", () => {
    const table = declarationsFor(
      css,
      ".param-admin-shell .project-admin-library-table .data-table-scroll > table",
      desktop
    );
    const minWidth = Number.parseInt(table["min-width"] ?? "", 10);

    expect(minWidth).toBeGreaterThanOrEqual(900);
    expect(minWidth).toBeLessThan(1300);
  });

  it("uses a dedicated always-visible horizontal rail with a painted thumb", () => {
    const scrollbar = declarationsFor(
      css,
      ".param-admin-shell .project-admin-library-table .data-table-scroll::-webkit-scrollbar",
      desktop
    );
    const rail = declarationsFor(css, ".horizontal-drag-scroll-rail", desktop);

    expect(scrollbar.display).toBe("none");
    expect(rail.height).toBe("var(--space-4)");
    expect(hasRule(css, ".horizontal-drag-scroll-rail__thumb", desktop)).toBe(true);
    expect(declarationsFor(css, ".horizontal-drag-scroll-rail").display).toBe("none");
  });

  it("gives the focusable rail tokenized hover and keyboard-focus states", () => {
    const thumb = declarationsFor(css, ".horizontal-drag-scroll-rail__thumb", desktop);
    const hover = declarationsFor(css, ".horizontal-drag-scroll-rail:not([hidden]):hover", desktop);
    const focus = declarationsFor(css, ".horizontal-drag-scroll-rail:not([hidden]):focus-visible", desktop);
    const focusThumb = declarationsFor(
      css,
      ".horizontal-drag-scroll-rail:not([hidden]):focus-visible .horizontal-drag-scroll-rail__thumb",
      desktop
    );

    expect(thumb["--horizontal-drag-scroll-thumb-min-width"]).toBe("var(--space-10)");
    expect(thumb["min-width"]).toBe("var(--horizontal-drag-scroll-thumb-min-width)");
    expect(hover.background).toBe("var(--surface-muted)");
    expect(focus.outline).toBe("2px solid var(--ring)");
    expect(focusThumb.background).toBe("var(--accent)");
  });

  it("centers and tightens the project-admin status column", () => {
    const statusRule = declarationsFor(css, ".project-admin-library-grid th:nth-child(3)", desktop);
    expect(statusRule["text-align"]).toBe("center");
    expect(statusRule["max-width"]).toBe("104px");
    expect(statusRule["min-width"]).toBe("88px");
  });

  it("tightens the project-admin conflict column", () => {
    const conflictRule = declarationsFor(css, ".project-admin-library-grid th:nth-child(4)", desktop);

    expect(conflictRule["text-align"]).toBe("center");
    expect(conflictRule["max-width"]).toBe("72px");
    expect(conflictRule["min-width"]).toBe("56px");
  });

  it("does not let nowrap cells shrink below content with min-width: 0", () => {
    const cellRule = declarationsFor(css, ".project-admin-library-grid th", desktop);
    const actionsRule = declarationsFor(css, ".project-admin-library-grid th:last-child", desktop);

    expect(cellRule["white-space"]).toBe("nowrap");
    expect(cellRule["min-width"]).not.toBe("0");
    expect(actionsRule["min-width"]).not.toBe("0");
  });

  it("keeps project-admin columns visible when ParametersTable hides slots 3 and 6", () => {
    const narrow = { within: "(max-width: 1180px)" } as const;

    expect(
      hasRule(css, ".parameters-table-grid:not(.project-admin-library-grid) th:nth-child(3)", narrow)
    ).toBe(true);
    expect(
      hasRule(css, ".parameters-table-grid:not(.project-admin-library-grid) td:nth-child(6)", narrow)
    ).toBe(true);
    expect(hasRule(css, ".parameters-table-grid th:nth-child(3)", narrow)).toBe(false);
  });

  it("keeps the project list as a complete card at 390px", () => {
    const mobile = { within: "(max-width: 640px)" } as const;

    expect(
      declarationsFor(css, ".param-admin-shell .project-admin-library-table .data-table-scroll", mobile).overflow
    ).toBe("visible");
    expect(
      declarationsFor(css, ".param-admin-shell .project-admin-library-table .data-table-scroll > table", mobile)[
        "min-width"
      ]
    ).toBe("0");
    expect(
      declarationsFor(css, ".project-admin-library-table .horizontal-drag-scroll-rail", mobile).display
    ).toBe("none");
  });
});
