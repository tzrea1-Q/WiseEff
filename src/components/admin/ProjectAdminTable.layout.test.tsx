import { describe, expect, it } from "vitest";
import { declarationsFor, hasRule, parseCssRules, readStylesheet } from "../../test/cssAssertions";

const css = readStylesheet("src/components/layout/admin-list-page.css");
const shared = readStylesheet("src/styles.css");
const desktop = { within: "(min-width: 641px)" } as const;

describe("Admin list layout", () => {
  it("uses theme-aware muted text instead of the outline color for column headers", () => {
    expect(declarationsFor(css, ".admin-list-page th").color).toBe("var(--text-muted)");
  });

  it("keeps pilot, row-menu and confirmation styles free of raw visual values", () => {
    const pilotRules = parseCssRules(shared).filter((rule) => rule.selectors.some((selector) =>
      /^\.(project-admin-|project-operations-not-found|horizontal-drag-scroll-rail|governance-confirm-dialog(?: h2|__body|__error| \.confirm-dialog__scroll)?$|delete-project-dialog)/.test(selector)));
    const rules = [...pilotRules, ...parseCssRules(css), ...parseCssRules(readStylesheet("src/components/common/row-action-menu.css"))];
    expect(pilotRules.length).toBeGreaterThan(0);
    const rawValues = rules.flatMap((rule) => Object.entries(rule.declarations)
      .filter(([, value]) => /(?:#[\da-f]{3,8}\b|\b(?:rgb|hsl|oklch)a?\(|\b[1-9]\d*(?:\.\d+)?(?:px|rem|em)\b|\b0\.\d+(?:px|rem|em)\b)/i.test(value))
      .map(([property, value]) => `${rule.selector}: ${property}: ${value}`));
    expect(rawValues).toEqual([]);
  });

  it("uses the tokenized scroll minimum without adding another page gutter", () => {
    expect(declarationsFor(css, ".admin-list-page .data-table-scroll > table")["min-width"])
      .toBe("var(--admin-list-table-min-width)");
    const minimum = Number.parseInt(declarationsFor(shared, ":root")["--admin-list-table-min-width"], 10);
    expect(minimum).toBeGreaterThanOrEqual(900);
    expect(minimum).toBeLessThan(1300);
  });

  it("keeps cells on one line without crushing their content", () => {
    const cell = declarationsFor(css, ".admin-list-page td");
    expect(cell.padding).toBe("var(--space-2)");
  });

  it("bounds long names and reserves content width for actions", () => {
    const name = declarationsFor(css, ".admin-list-page td:first-child");
    expect(name["max-width"]).toBe("var(--admin-list-name-max-width)");
  });

  it("keeps the pilot's detail form on tokens rather than raw colors and dimensions", () => {
    const form = declarationsFor(shared, ".project-admin-form-dialog");
    expect(form.width).toBe("min(var(--admin-list-detail-width), calc(100vw - var(--space-12)))");
    expect(form["max-width"]).toBe("var(--admin-list-detail-width)");
    expect(declarationsFor(shared, ".project-admin-form-grid input:read-only").background).toBe("var(--surface-sunken)");
    expect(declarationsFor(shared, ".project-admin-form-grid label").gap).toBe("var(--space-2)");
    expect(declarationsFor(shared, ".project-admin-form-grid input")["min-height"]).toBe("var(--space-8)");
  });

  it("retains the shared visible rail and its keyboard-focus contrast", () => {
    const rail = declarationsFor(shared, ".horizontal-drag-scroll-rail", desktop);
    expect(rail.height).toBe("var(--space-4)");
    expect(hasRule(shared, ".horizontal-drag-scroll-rail__thumb", desktop)).toBe(true);
    const thumb = declarationsFor(shared, ".horizontal-drag-scroll-rail__thumb", desktop);
    expect(thumb["min-width"]).toBe("var(--horizontal-drag-scroll-thumb-min-width)");
    expect(declarationsFor(shared, ".horizontal-drag-scroll-rail:not([hidden]):hover", desktop).background)
      .toBe("var(--surface-muted)");
    expect(declarationsFor(shared, ".horizontal-drag-scroll-rail:not([hidden]):focus-visible", desktop).outline)
      .toBe("var(--view-switch-focus-width) solid var(--ring)");
    expect(declarationsFor(shared, ".horizontal-drag-scroll-rail:not([hidden]):focus-visible .horizontal-drag-scroll-rail__thumb", desktop).background)
      .toBe("var(--accent)");
  });
});
