import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { declarationsFor, parseCssRules, readStylesheet } from "./cssAssertions";
import { scanCssContent } from "../../scripts/check-ui-standards";

const styles = readStylesheet("src/styles.css");

describe("shared consistency contracts", () => {
  it("keeps all workbench table and shared column-filter typography on scale, including inherited header controls", () => {
    const rules = parseCssRules(styles).filter((rule) => /dts-parameter-workbench-table|parameters-column-filter/.test(rule.selector));
    const fontRules = rules.filter((rule) => rule.declarations["font-size"]);
    expect(fontRules.length).toBeGreaterThan(0);
    expect(fontRules.filter((rule) => !/^var\(--text-(?:xs|sm|base|md|lg|xl|2xl)\)$/.test(rule.declarations["font-size"]))
      .map((rule) => `${rule.selector}: ${rule.declarations["font-size"]}`)).toEqual([]);
    expect(declarationsFor(styles, ".dts-parameter-workbench-table__head")["font-size"]).toBe("var(--text-sm)");
    expect(declarationsFor(styles, ".dts-parameter-workbench-table")["font-size"]).toBe("var(--text-base)");
    expect(declarationsFor(styles, ".parameters-column-filter")["font-size"]).toBe("var(--text-xs)");
    expect(declarationsFor(styles, ".parameters-column-filter__trigger")["font-size"]).toBe("var(--text-xs)");
    expect(declarationsFor(styles, ".parameters-column-filter__trigger span")["font-size"]).toBe("var(--text-xs)");
    expect(declarationsFor(styles, ".dts-parameter-workbench-table__provenance small")["font-size"]).toBe("var(--text-xs)");
  });
  it("preserves the bounded configuration pane height through the routed content wrapper", () => {
    const configuration = readStylesheet("src/components/project-configuration-workbench/configuration-workbench.css");
    const content = declarationsFor(configuration, ".main-content:has(.param-admin-shell--configuration-workbench) > .page-content");
    expect(content.height).toBe("100%");
    expect(content["min-height"]).toBe("0");
    for (const selector of [".param-admin-shell--configuration-workbench", ".project-admin-layout--configuration-workbench", ".configuration-workbench"]) {
      expect(declarationsFor(configuration, selector).height).toBe("100%");
    }
    expect(declarationsFor(configuration, ".configuration-workbench")["grid-template-rows"]).toBe("auto minmax(0, 1fr) 44px");
  });

  it("preserves source canvas metrics, full-grid insets and the upward task dock shadow", () => {
    const configuration = readStylesheet("src/components/project-configuration-workbench/configuration-workbench.css");
    expect(declarationsFor(configuration, ".configuration-workbench__config-select select").padding).toBe("0 calc(var(--space-6) + var(--space-1)) 0 var(--space-2)");
    expect(declarationsFor(configuration, ".configuration-workbench__source-state").padding).toBe("calc(var(--space-6) + var(--space-1))");
    expect(declarationsFor(configuration, ".configuration-workbench__code").font).toBe("var(--text-sm) / 1.75 var(--font-code)");
    expect(declarationsFor(styles, ":root")["--font-code"]).toBe('"SFMono-Regular", Consolas, "Liberation Mono", monospace');
    expect(declarationsFor(configuration, ".configuration-workbench__tasks.is-open")["box-shadow"]).toBe("var(--shadow-sheet-above)");
    expect(declarationsFor(styles, ":root")["--shadow-sheet-above"]).toBe("0 -12px 30px color-mix(in srgb, var(--text) 16%, transparent)");
    const compactMain = parseCssRules(styles).find((rule) => rule.selector === ".main-content" && rule.atRules.length > 0);
    expect(compactMain?.declarations.padding).toBe("var(--space-4) var(--space-3) calc(var(--space-16) + var(--space-12) + var(--space-2))");
    expect(declarationsFor(readStylesheet("src/features/parameter-home/parameter-home.css"), ".parameter-home__chart-fallback").margin).toBe("calc(-1 * var(--stroke-hairline))");
  });
  it("keeps entire touched page stylesheets and row actions free of raw visual values", () => {
    const home = declarationsFor(readStylesheet("src/features/parameter-home/parameter-home.css"), ".parameter-home");
    expect(home["--ph-panel-radius"]).toBe("var(--radius-lg)");
    expect(home["--ph-section-gap"]).toBe("var(--space-5)");
    for (const file of [
      "src/components/common/row-action-menu.css",
      "src/components/project-configuration-workbench/configuration-workbench.css",
      "src/features/log-analysis/log-analysis.css",
      "src/features/parameter-home/parameter-home.css",
      "src/features/parameter-review/parameter-review.css",
      "src/features/parameter-catalog/parameter-catalog.css"
    ]) {
      const css = readStylesheet(file);
      expect(scanCssContent(file, css), file).toEqual([]);
      expect(css, file).not.toMatch(/\bfont\s*:[^;{}]*\d(?:px|rem|em)\b/);
    }
  });

  it("keeps changed shared-shell and typography rules free of raw visual values", () => {
    const selectors = [
      ".button",
      ".button, .button-size-md",
      ".button.sm, .button-size-sm",
      ".button.lg, .button-size-lg",
      ".button-size-xs",
      ".button-icon",
      ".button-icon.button-size-xs",
      ".button-icon.button-size-sm",
      ".button-icon.button-size-lg",
      ".app-shell.sidebar-is-collapsed",
      ".sidebar",
      ".brand-block",
      ".brand-title",
      ".sidebar-collapsed",
      ".sidebar-collapsed .brand-block",
      ".sidebar-collapsed .sidebar-toggle",
      ".sidebar-collapsed .utility-nav",
      ".sidebar-collapsed :is(.feedback-entry)",
      ".sidebar-collapsed :is(.primary-nav-action, .nav-item)",
      ".primary-nav-action",
      ".nav-scroll",
      ".nav-group-label",
      ".nav-item",
      ".nav-item.active",
      ".utility-nav",
      ".feedback-entry",
      ".topbar",
      ".topbar-title",
      ".topbar .topbar-page-actions .project-chip__trigger, .topbar .topbar-page-actions .device-pill, .topbar .topbar-page-actions .dirty-indicator",
      ".topbar .topbar-page-actions [role=\"group\"] button",
      ".auth-pending-notice h2",
      ".main-content",
      ".page-content",
      ".workbench-sheet-head h2",
      ".parameters-table-heading h2",
      ".permission-denied-page, .no-entry-page, .user-permissions-page, .organization-page",
      ".user-permissions-modal h3",
      ".reload-configuration-panel__header h3",
      ".reload-configuration-panel__section-title h3",
      ".reload-configuration-form__control.mono, .reload-configuration-form [data-slot=\"select-trigger\"]",
      ".workspace-header__title",
      ".parameter-detail-dialog__header h2",
      ".parameter-detail-panel__head h3",
      ".submission-dialog h2, .submission-round-detail h2",
      ".feedback-attachment-preview-dialog-head-text h2",
      ".param-admin-header-text h1",
      ".xiaoze-welcome__title",
      ".param-admin-panel__section h3",
      ".project-operations-not-found h2",
      ".dts-search-panel__head h3",
      ".dts-structure-browser-panel__head h3",
      ".dts-node-tree-view__item code, .dts-structure-browser-panel__detail h4 code",
      ".dts-structure-browser-panel__detail h4",
      ".structured-value-editor button",
      ".dts-parameter-workbench-table__sort",
      ".dts-parameter-workbench-table",
      ".dts-parameter-workbench-table__head",
      ".dts-parameter-workbench-table__provenance",
      ".dts-parameter-workbench-table__provenance small",
      ".dts-parameter-workbench-table__module small",
      ".dts-parameter-workbench-table__identity small",
      ".dts-parameter-workbench-table__governance-badge, .dts-parameter-workbench-table__draft-badge",
      ".dts-parameter-workbench-table__enablement-notice",
      '.dts-parameter-workbench-table__row > [role="cell"]::before',
      ".parameters-column-filter",
      ".parameters-column-filter__trigger",
      ".parameters-column-filter__trigger span",
      ".config-set-baseline-panel__section h3",
      ".governance-confirm-dialog h2, .delete-project-dialog h2",
      ".structured-diff-view__file, .structured-diff-view__changeset h4",
      ".param-admin-confirm-dialog .submission-dialog-head h2",
      ".audit-event-detail-head h3",
      ".audit-center-page",
      ".audit-event-detail-panel-title",
      ".param-admin-shell",
      ".project-init-header h2",
      ".project-init-step-copy--scope h3",
      ".project-init-step-copy h3",
      ".project-init-step-copy--source h3",
      ".project-init-source-empty-toggle",
      ".project-init-detail-button",
      ".parameter-import-paste-dialog__header h3",
      ".platform-console-page",
      ".knowledge-markdown-preview h1",
      ".knowledge-markdown-preview h2",
      ".knowledge-markdown-preview h3, .knowledge-markdown-preview h4"
    ];
    const rules = parseCssRules(styles);
    for (const selector of selectors) {
      const matching = rules.filter((rule) => rule.selector === selector);
      expect(matching.length, selector).toBeGreaterThan(0);
      for (const rule of matching) {
        const css = `${rule.selector} { ${Object.entries(rule.declarations).map(([property, value]) => `${property}: ${value};`).join(" ")} }`;
        expect(scanCssContent("src/styles.css", css), selector).toEqual([]);
      }
    }
  });

  it("uses one size table for legacy and shared buttons", () => {
    for (const [size, legacy, height] of [["md", ".button", "var(--space-8)"], ["sm", ".button.sm", "calc(var(--space-6) + var(--space-1))"], ["lg", ".button.lg", "calc(var(--space-8) + var(--space-1))"]]) {
      const shared = declarationsFor(styles, `.button-size-${size}`);
      const original = declarationsFor(styles, legacy);
      expect(original["min-height"]).toBe(height);
      expect(shared["min-height"]).toBe(original["min-height"]);
      expect(shared["font-size"]).toBe(original["font-size"]);
      expect(shared["line-height"]).toBe(original["line-height"]);
      expect(shared.padding).toBe(original.padding);
    }
    expect(declarationsFor(styles, ".topbar-title")["font-size"]).toBe("var(--text-xl)");
    expect(declarationsFor(styles, ".topbar-title")["line-height"]).toBe("var(--leading-xl)");
  });

  it("aligns shell chrome and page roots without a second gutter", () => {
    expect(declarationsFor(styles, ".topbar").padding).toBe("var(--space-3) var(--page-gutter)");
    expect(declarationsFor(styles, ".main-content").padding).toBe("var(--page-gutter) var(--page-gutter) calc(var(--space-16) + var(--space-12))");
    for (const root of [".organization-page", ".user-permissions-page", ".audit-center-page", ".param-admin-shell", ".platform-console-page"]) {
      expect(declarationsFor(styles, root).padding).toBe("0");
    }
    const navigation = declarationsFor(styles, ".nav-item");
    expect(navigation.gap).toBe("var(--space-3)");
    expect(navigation.padding).toBe("var(--space-2) var(--space-3)");
    expect(navigation["min-height"]).toBe("var(--space-10)");
    expect(declarationsFor(styles, ".nav-group-label").padding).toBe("var(--space-2) var(--space-3)");
    expect(declarationsFor(styles, ".nav-item.active")["box-shadow"]).toBe("var(--shadow-1)");
  });

  it("keeps expanded and collapsed navigation spacing on the token grid", () => {
    for (const selector of [".sidebar", ".sidebar-collapsed", ".brand-block", ".sidebar-collapsed .brand-block", ".nav-scroll", ".utility-nav", ".primary-nav-action", ".feedback-entry", ".sidebar-collapsed .utility-nav", ".sidebar-collapsed :is(.feedback-entry)", ".sidebar-collapsed :is(.primary-nav-action, .nav-item)"]) {
      for (const [property, value] of Object.entries(declarationsFor(styles, selector))) {
        if (/^(?:padding|margin|gap)/.test(property)) expect(value, `${selector} ${property}`).not.toMatch(/[\d.]+(?:px|rem|em)\b/);
      }
    }
  });

  it("keeps app heading and button typography on the documented scale", () => {
    const offScale: string[] = [];
    const files = readdirSync("src", { recursive: true }).filter((file) =>
      typeof file === "string" && file.endsWith(".css") && !file.startsWith("linear-template/"));
    for (const file of files) {
      for (const rule of parseCssRules(readStylesheet(`src/${file}`))) {
        const size = rule.declarations["font-size"];
        const appHeadingOrButton = rule.selectors.some((selector) =>
          /(?:title|heading|\bh[1-6]\b|button|btn)/.test(selector)
          && !/^\.(?:hero-copy|entry-card|dark-ai-band|ai-scenario-slide)\b/.test(selector));
        if (appHeadingOrButton && size && !/^var\(--text-(?:xs|sm|base|md|lg|xl|2xl)\)$/.test(size)) {
          offScale.push(`${file}: ${rule.selectors.join(", ")} => ${size}`);
        }
      }
    }
    expect(offScale).toEqual([]);
  });

  it("keeps specialized toolbar, select and line-number actions on the same scale", () => {
    expect(declarationsFor(styles, ".dts-parameter-workbench-table__sort")["font-size"]).toBe("var(--text-xs)");
    for (const selector of [".topbar .topbar-page-actions .project-chip__trigger", '.reload-configuration-form [data-slot="select-trigger"]', ".project-init-source-empty-toggle"]) {
      expect(declarationsFor(styles, selector)["font-size"]).toMatch(/^var\(--text-(?:xs|sm|base|md|lg|xl|2xl)\)$/);
    }
    for (const [file, selector] of [
      ["src/features/parameter-home/parameter-home.css", ".parameter-home__insight-toggle"],
      ["src/features/log-analysis/log-analysis.css", ".rawlog-line__num"]
    ]) {
      expect(declarationsFor(readStylesheet(file), selector)["font-size"]).toMatch(/^var\(--text-(?:xs|sm|base|md|lg|xl|2xl)\)$/);
    }
  });

  it("uses red text, not a solid destructive fill, in the row menu", () => {
    const menu = readStylesheet("src/components/common/row-action-menu.css");
    const destructive = declarationsFor(menu, ".row-action-menu__item[data-destructive]");
    expect(destructive.color).toBe("var(--danger)");
    expect(destructive.background).toBeUndefined();
    expect(declarationsFor(menu, ".row-action-menu__item[data-destructive][data-highlighted]").background).toBe("var(--danger-soft)");
  });
});
