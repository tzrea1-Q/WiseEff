import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readStyles() {
  return readFileSync(resolve(__dirname, "../../styles.css"), "utf8");
}

/** Pull the non-card project-admin library rules (min-width: 641px). */
function desktopProjectAdminBlock(styles: string) {
  const match = styles.match(
    /\/\*\s*Table column sizing for any non-card shell[\s\S]*?@media\s*\(min-width:\s*641px\)\s*\{([\s\S]*?)\n\}/
  );
  return match?.[1] ?? "";
}

describe("ProjectAdminTable layout CSS", () => {
  it("gives the project list a table min-width so narrow shells can scroll horizontally", () => {
    const block = desktopProjectAdminBlock(readStyles());

    expect(block.length).toBeGreaterThan(0);
    expect(block).toMatch(
      /\.project-admin-library-(?:table\s+\.parameters-table-scroll\s*>\s*table|grid)\s*[,{][^}]*min-width:\s*(?:9\d{2}|1[0-2]\d{2})px/
    );
  });

  it("uses a dedicated always-visible horizontal rail with a painted thumb", () => {
    const styles = readStyles();
    const block = desktopProjectAdminBlock(styles);

    expect(block).toMatch(
      /\.param-admin-shell\s+\.project-admin-library-table\s+\.parameters-table-scroll::-webkit-scrollbar\s*\{[^}]*display:\s*none/
    );
    expect(block).toMatch(/\.project-admin-library-table\s+\.project-admin-h-rail\s*\{[^}]*height:\s*16px/);
    expect(block).toMatch(/\.project-admin-library-table\s+\.project-admin-h-rail-thumb\s*\{/);
    expect(styles).toMatch(/\.project-admin-h-rail\s*\{[^}]*display:\s*none/);
  });

  it("centers and tightens the project-admin status column", () => {
    const block = desktopProjectAdminBlock(readStyles());
    const statusRule =
      block.match(
        /\.project-admin-library-grid th:nth-child\(4\),\s*\.project-admin-library-grid td:nth-child\(4\)\s*\{[^}]*\}/
      )?.[0] ?? "";

    expect(statusRule).toMatch(/text-align:\s*center/);
    expect(statusRule).toMatch(/max-width:\s*104px/);
    expect(statusRule).toMatch(/min-width:\s*88px/);
    expect(block).toMatch(
      /\.project-admin-library-grid th:nth-child\(4\)\s+\.param-admin-library-head-cell\s*\{[^}]*justify-content:\s*center/
    );
  });

  it("tightens the project-admin conflict column", () => {
    const block = desktopProjectAdminBlock(readStyles());
    const conflictRule =
      block.match(
        /\.project-admin-library-grid th:nth-child\(5\),\s*\.project-admin-library-grid td:nth-child\(5\)\s*\{[^}]*\}/
      )?.[0] ?? "";

    expect(conflictRule).toMatch(/text-align:\s*center/);
    expect(conflictRule).toMatch(/max-width:\s*72px/);
    expect(conflictRule).toMatch(/min-width:\s*56px/);
  });

  it("does not let nowrap cells shrink below content with min-width: 0", () => {
    const block = desktopProjectAdminBlock(readStyles());
    const cellRule =
      block.match(/\.project-admin-library-grid th,\s*\.project-admin-library-grid td\s*\{[^}]*\}/)?.[0] ?? "";
    const actionsRule =
      block.match(
        /\.project-admin-library-grid th:last-child,\s*\.project-admin-library-grid td:last-child\s*\{[^}]*\}/
      )?.[0] ?? "";

    expect(cellRule).toMatch(/white-space:\s*nowrap/);
    expect(cellRule).not.toMatch(/min-width:\s*0/);
    expect(actionsRule).not.toMatch(/min-width:\s*0/);
  });

  it("keeps project-admin columns visible when ParametersTable hides slots 3 and 6", () => {
    const styles = readStyles();
    const hideBlock =
      styles.match(/@media\s*\(max-width:\s*1180px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

    expect(hideBlock).toMatch(
      /\.parameters-table-grid:not\(\.project-admin-library-grid\)\s+th:nth-child\(3\)/
    );
    expect(hideBlock).toMatch(
      /\.parameters-table-grid:not\(\.project-admin-library-grid\)\s+td:nth-child\(6\)/
    );
    expect(hideBlock).not.toMatch(/(?<!:not\()\.parameters-table-grid\s+th:nth-child\(3\)/);
  });
});
