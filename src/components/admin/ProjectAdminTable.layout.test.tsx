import { describe, expect, it } from "vitest";
import { declarationsFor, hasRule, readStylesheet } from "../../test/cssAssertions";

const css = readStylesheet("src/styles.css");

/** Non-card project-admin library rules live in the desktop (min-width: 641px) block. */
const desktop = { within: "(min-width: 641px)" } as const;

describe("ProjectAdminTable layout CSS", () => {
  it("gives the project list a table min-width so narrow shells can scroll horizontally", () => {
    const table = declarationsFor(
      css,
      ".param-admin-shell .project-admin-library-table .parameters-table-scroll > table",
      desktop
    );
    const minWidth = Number.parseInt(table["min-width"] ?? "", 10);

    expect(minWidth).toBeGreaterThanOrEqual(900);
    expect(minWidth).toBeLessThan(1300);
  });

  it("uses a dedicated always-visible horizontal rail with a painted thumb", () => {
    const scrollbar = declarationsFor(
      css,
      ".param-admin-shell .project-admin-library-table .parameters-table-scroll::-webkit-scrollbar",
      desktop
    );
    const rail = declarationsFor(css, ".project-admin-library-table .project-admin-h-rail", desktop);

    expect(scrollbar.display).toBe("none");
    expect(rail.height).toBe("16px");
    expect(hasRule(css, ".project-admin-library-table .project-admin-h-rail-thumb", desktop)).toBe(true);
    expect(declarationsFor(css, ".project-admin-h-rail").display).toBe("none");
  });

  it("centers and tightens the project-admin status column", () => {
    const statusRule = declarationsFor(css, ".project-admin-library-grid th:nth-child(4)", desktop);
    const statusHead = declarationsFor(
      css,
      ".project-admin-library-grid th:nth-child(4) .param-admin-library-head-cell",
      desktop
    );

    expect(statusRule["text-align"]).toBe("center");
    expect(statusRule["max-width"]).toBe("104px");
    expect(statusRule["min-width"]).toBe("88px");
    expect(statusHead["justify-content"]).toBe("center");
  });

  it("tightens the project-admin conflict column", () => {
    const conflictRule = declarationsFor(css, ".project-admin-library-grid th:nth-child(5)", desktop);

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
});
