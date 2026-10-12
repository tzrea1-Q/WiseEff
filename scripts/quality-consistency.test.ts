import type { BrowserContext, Route } from "playwright/test";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { assertXiaozePlacement, requireMeasuredCategories, requireCompactControlHeights, requireReviewInboxStructure, shouldRequireXiaozeHint, requireTypographyScale, requirePageGutter, requireWorkbenchPresentation, requireNavigatorWorkbenchGeometry, requireRowActionVisibility } from "../e2e/quality/consistency-assertions";

describe("workbench optional descriptions and single-line keys", () => {
  const key = { text: "vendor,long-key", title: "vendor,long-key", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
  const empty = { rowCount: 1, descriptionHeaderCount: 0, descriptions: [], keys: [key] };
  it("accepts empty columns being absent and mixed descriptions being present", () => {
    expect(() => requireWorkbenchPresentation([empty], "/parameters")).not.toThrow();
    expect(() => requireWorkbenchPresentation([{ ...empty, rowCount: 2,
      descriptionHeaderCount: 1, descriptions: ["说明", ""], keys: [key, key]
    }], "/parameters")).not.toThrow();
  });
  it("rejects an empty description column, wrapping keys, missing tooltips, and empty measurements", () => {
    expect(() => requireWorkbenchPresentation([{ ...empty, descriptionHeaderCount: 1, descriptions: [""] }], "/parameters")).toThrow(/description/);
    expect(() => requireWorkbenchPresentation([{ ...empty, keys: [{ ...key, whiteSpace: "pre-wrap" }] }], "/parameters")).toThrow(/key/);
    expect(() => requireWorkbenchPresentation([{ ...empty, keys: [{ ...key, title: "" }] }], "/parameters")).toThrow(/key/);
    expect(() => requireWorkbenchPresentation([], "/parameters")).toThrow(/missing/);
  });
  it("collects visible workbench descriptions and full-key presentation from the DOM", () => {
    const measurements = collectMarkup(`
      <div role="table" class="dts-parameter-workbench-table">
        <span role="columnheader">展示描述</span>
        <div role="row" class="dts-parameter-workbench-table__row">
          <span data-label="参数名"><code title="vendor,long-key" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis">vendor,long-key</code></span>
          <span data-label="展示描述" title="说明">说明</span>
        </div>
      </div>
    `);
    expect(measurements.workbenchTables).toEqual([{
      rowCount: 1, descriptionHeaderCount: 1, descriptions: ["说明"], keys: [key]
    }]);
    expect(() => requireWorkbenchPresentation(measurements.workbenchTables, "/parameters")).not.toThrow();
  });
});

function collectMarkup(markup: string, portalMarkup = "") {
  const dom = new JSDOM(`<main>${markup}</main>${portalMarkup}`);
  vi.spyOn(dom.window.Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 100, y: 100, left: 100, top: 100, right: 200, bottom: 132, width: 100, height: 32, toJSON: () => ({})
  });
  dom.window.Element.prototype.checkVisibility = function () { return !this.closest("[hidden]"); };
  dom.window.Range.prototype.getBoundingClientRect = () => dom.window.document.documentElement.getBoundingClientRect();
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
  vi.stubGlobal("innerWidth", 1440);
  vi.stubGlobal("innerHeight", 900);
  try {
    return collectConsistencyMeasurements();
  } finally {
    vi.unstubAllGlobals();
    dom.window.close();
  }
}
import { collectConsistencyMeasurements } from "../e2e/quality/consistency-collector";
import { consistencyRoutes, viewSwitchStyleExpectations } from "../e2e/quality/consistency-routes";

describe("project configuration workbench coverage", () => {
  it.each([false, true])("measures real navigator and task row actions with navigator collapsed=%s", (collapsed) => {
    const row = `<div data-row-action-row><span data-row-action-status>活跃 v1</span>
      <div class="row-action-menu"><button>详情</button></div></div>`;
    const measurements = collectMarkup(`<div class="navigator-workbench">
      <div class="navigator-workbench__navigation" ${collapsed ? "hidden" : ""}>${row}</div>
      <div class="navigator-workbench__task">${row}</div></div>
      <div class="row-action-menu"><button>非行操作</button></div>`);
    expect(measurements.rowActions).toHaveLength(collapsed ? 1 : 2);
    expect(() => requireRowActionVisibility(measurements.rowActions, "/parameter-admin/projects/aurora/configuration"))
      .not.toThrow();
  });
  const paths = ["/configuration", "/files", "/config-sets", "/structure", "/conflicts"]
    .map((suffix) => `/parameter-admin/projects/aurora${suffix}`);
  it.each(paths)("requires shared config-set sections and content tabs on %s", (path) => {
    expect(viewSwitchStyleExpectations[path]).toEqual(["section", "tabs"]);
  });
  it.each(paths)("requires template geometry on %s in every source mode", (path) => {
    for (const mode of ["working", "history", "candidate", "unified-diff", "side-by-side"]) {
      const route = mode === "working" ? path : `${path}?sourceMode=${mode}`;
      expect(consistencyRoutes.find((item) => item.path === route)?.required)
        .toEqual(expect.arrayContaining(["navigatorWorkbenches", "rowActions", "viewSwitches", "viewSwitchSignatures"]));
    }
  });
  it.each([
    '<header class="configuration-workbench__source-head">board.dts</header>',
    '<div class="configuration-workbench__source-state">暂无历史版本</div>',
    '<div role="tree"><ul><li role="treeitem">节点</li></ul></div>',
    '<footer class="configuration-workbench__tasks"><button class="configuration-workbench__task-toggle">任务</button></footer>'
  ])("measures the first project task content without requiring a data table", (content) => {
    const measurements = collectMarkup(`<div class="navigator-workbench" data-workbench-page="project-configuration:aurora">
      <div class="navigator-workbench__body"><section class="navigator-workbench__task">${content}</section></div></div>`);
    expect(measurements.navigatorWorkbenches[0].firstRow?.height).toBe(32);
  });
  it("rejects missing task content and an inspector outside its token-owned slot", () => {
    const firstRow = { left: 300, top: 60, right: 500, bottom: 100, width: 200, height: 40 };
    const workbench = {
      pageKey: "project-configuration:aurora", collapsed: false,
      root: { left: 0, top: 0, right: 1440, bottom: 800, width: 1440, height: 800 },
      navigator: { left: 0, top: 60, right: 288, bottom: 800, width: 288, height: 740 },
      task: { left: 300, top: 60, right: 1440, bottom: 800, width: 1140, height: 740 },
      toolbar: { left: 0, top: 0, right: 1440, bottom: 50, width: 1440, height: 50 },
      primaryAction: { left: 1327, top: 12, right: 1427, bottom: 40, width: 100, height: 28 },
      inspector: { left: 1120, top: 60, right: 1440, bottom: 800, width: 320, height: 740 },
      inspectorOverlay: true, noticeCount: 0,
      navigatorCounts: [{ text: "2 个配置集", textRect: { left: 12, right: 80, width: 68 },
        clip: { left: 0, right: 288 }, clientWidth: 80, scrollWidth: 80 }], firstRow, firstRowClip: firstRow,
      viewport: { width: 1440, height: 900 }, pageOverflow: 0,
      contract: { navigatorWidth: 288, collapsedWidth: 40, gap: 12, toolbarPadding: 12, inspectorWidth: 320 }
    };
    expect(() => requireNavigatorWorkbenchGeometry([workbench], "/parameter-admin/projects/aurora/configuration")).not.toThrow();
    expect(() => requireNavigatorWorkbenchGeometry([{ ...workbench, firstRow: null }], "/configuration")).toThrow(/first row/);
    expect(() => requireNavigatorWorkbenchGeometry([{ ...workbench, inspector: null }], "/configuration?inspector=file"))
      .toThrow(/inspector/);
    expect(() => requireNavigatorWorkbenchGeometry([{ ...workbench,
      inspector: { ...workbench.inspector, width: 360 } }], "/configuration")).toThrow(/inspector/);
    expect(() => requireNavigatorWorkbenchGeometry([{ ...workbench, inspectorOverlay: false,
      task: { ...workbench.task, right: 1108, width: 808 } }], "/configuration")).not.toThrow();
  });
});
import { installConsistencyReadGuard } from "../e2e/quality/consistency";

describe("typography scale contract", () => {
  const measurements = () => ({
    typeScale: [11, 12, 13, 14, 16, 20, 24].map((fontSize) => ({ fontSize })),
    titles: [{ dom: "page title", fontSize: 20, pageTitle: true }, { dom: "section title", fontSize: 16, pageTitle: false }],
    buttons: [{ dom: "button", fontSize: 13 }]
  });

  it("accepts only the documented scale and its page-title step", () => {
    expect(() => requireTypographyScale(measurements(), "/audit")).not.toThrow();
    for (const fontSize of [0, 15, 18, NaN, Infinity]) {
      expect(() => requireTypographyScale({ ...measurements(), buttons: [{ dom: "off-scale button", fontSize }] }, "/audit"))
        .toThrow(/typography/);
    }
    expect(() => requireTypographyScale({ ...measurements(), titles: [{ dom: "small page title", fontSize: 16, pageTitle: true }] }, "/audit"))
      .toThrow(/page title/);
  });

  it("rejects empty collections, missing page titles and corrupted scale tokens", () => {
    for (const category of ["titles", "buttons", "typeScale"] as const) {
      expect(() => requireTypographyScale({ ...measurements(), [category]: [] }, "/audit")).toThrow(/missing consistency measurements/);
    }
    expect(() => requireTypographyScale({ ...measurements(), titles: [{ dom: "section", fontSize: 16, pageTitle: false }] }, "/audit"))
      .toThrow(/page title/);
    expect(() => requireTypographyScale({ ...measurements(), typeScale: [{ fontSize: NaN }] }, "/audit")).toThrow(/scale/);
  });
});

describe("shell-owned page gutter", () => {
  const edges = () => ["shell", "content", "page", "toolbar", "footer"].map((region) => ({
    dom: region, region, left: 280, expectedLeft: 280
  }));

  it("aligns every content, toolbar and footer edge to the shell token within one pixel", () => {
    expect(() => requirePageGutter(edges(), "/audit", true)).not.toThrow();
    expect(() => requirePageGutter(edges().map((edge) => ({ ...edge, left: 281 })), "/audit", true)).not.toThrow();
    for (const left of [282, 304, NaN, Infinity]) {
      expect(() => requirePageGutter(edges().map((edge) => edge.region === "page" ? { ...edge, left } : edge), "/audit", true))
        .toThrow(/gutter/);
    }
    expect(() => requirePageGutter(edges().map((edge) => ({ ...edge, expectedLeft: NaN })), "/audit", true)).toThrow(/gutter/);
  });

  it("fails on empty or missing regions and exempts only a footer absent from the DOM", () => {
    expect(() => requirePageGutter([], "/audit", false)).toThrow(/missing consistency measurements/);
    for (const region of ["shell", "content", "page", "toolbar", "footer"]) {
      expect(() => requirePageGutter(edges().filter((edge) => edge.region !== region), "/audit", true)).toThrow(/missing.*gutter/);
    }
    expect(() => requirePageGutter(edges().filter((edge) => edge.region !== "footer"), "/parameter-admin/projects/aurora", false))
      .not.toThrow();
    expect(() => requirePageGutter(edges().filter((edge) => edge.region !== "footer"), "/parameter-admin/projects/aurora/configuration", true))
      .toThrow(/missing.*footer/);
    expect(() => requirePageGutter(edges().map((edge) => edge.region === "footer" ? { ...edge, left: 304 } : edge), "/parameter-admin/projects/aurora/configuration", true))
      .toThrow(/gutter/);
    expect(() => requirePageGutter(edges().filter((edge) => edge.region !== "toolbar" && edge.region !== "footer"), "/parameter-admin/projects/aurora", false))
      .toThrow(/missing.*toolbar/);
  });

  it("records footer DOM presence even when a present footer is hidden", () => {
    expect(collectMarkup('<div class="page-content"><section>Page</section></div>').footerPresent).toBe(false);
    const measured = collectMarkup('<div class="page-content"><section>Page</section></div><footer class="app-footer" style="display:none">Footer</footer>');
    expect(measured.footerPresent).toBe(true);
    expect(measured.pageEdges.some((edge) => edge.region === "footer")).toBe(true);
    const misplaced = collectMarkup('<div class="page-content"><section>Page</section></div>', '<footer class="app-footer">Footer</footer>');
    expect(misplaced.footerPresent).toBe(true);
    expect(misplaced.pageEdges.some((edge) => edge.region === "footer")).toBe(true);
  });

  it("collects page insets, shell chrome, portal titles and disabled button typography", () => {
    const measured = collectMarkup(`
      <div class="page-content"><section style="padding-left:24px">
        <h2 style="font-size:16px">Section</h2><button style="font-size:12px" disabled>Action</button>
        <aside class="panel__title" style="font-size:14px">Panel title</aside>
      </section></div><footer class="app-footer">Footer</footer>
    `, '<header class="topbar"><div class="topbar-title" style="font-size:20px">Page</div></header><section role="dialog"><h2 style="font-size:16px">Confirmation</h2><button style="font-size:13px">Cancel</button></section>');
    expect(measured.titles.map((title) => title.fontSize)).toEqual([16, 14, 20, 16]);
    expect(measured.titles.filter((title) => title.pageTitle)).toEqual([{ dom: "div.topbar-title", fontSize: 20, pageTitle: true }]);
    expect(measured.buttons.map((button) => button.fontSize)).toEqual([12, 13]);
    expect(measured.footerPresent).toBe(true);
    expect(measured.pageEdges.map((edge) => [edge.region, edge.left])).toEqual([
      ["shell", 100], ["content", 100], ["page", 124], ["toolbar", 100], ["footer", 100]
    ]);
  });

  it("requires typography and gutters on every consistency route", () => {
    for (const route of consistencyRoutes) {
      expect(route.required).toEqual(expect.arrayContaining(["titles", "buttons", "typeScale", "pageEdges"]));
    }
    expect(consistencyRoutes.some((route) => route.path === "/knowledge-admin")).toBe(true);
  });
});

describe("unified review inbox structure", () => {
  const tabs = `<div role="tablist"><button role="tab" aria-selected="true">待处理</button>
    <button role="tab" aria-selected="false">已处理</button></div>`;

  it.each(["/parameter-review", "/parameter-submissions"])("accepts one queue and one two-tab view on %s", (route) => {
    const measurements = collectMarkup(`${tabs}<table><tbody></tbody></table>`);
    expect(() => requireReviewInboxStructure(measurements, route)).not.toThrow();
  });

  it.each([
    ["missing view", "<table></table>"],
    ["stacked views", `${tabs}<section>${tabs}</section><table></table>`],
    ["missing queue", tabs],
    ["stacked queues", `${tabs}<table></table><table></table>`],
    ["no selected tab", `${tabs.replace('aria-selected="true"', 'aria-selected="false"')}<table></table>`],
    ["two selected tabs", `${tabs.replace('aria-selected="false"', 'aria-selected="true"')}<table></table>`]
  ])("rejects %s", (_name, markup) => {
    expect(() => requireReviewInboxStructure(collectMarkup(markup), "/parameter-review")).toThrow(/unified review inbox/);
  });
});

describe("view-switch collection", () => {
  it("measures the first read-only identity evidence item and protects its task scrollport", () => {
    const measurements = collectMarkup(`
      <div class="navigator-workbench"><section class="navigator-workbench__task" style="overflow-x: auto; overflow-y: auto">
        <ul class="identity-mapping-review__list"><li class="identity-mapping-review__item">Historical evidence</li></ul>
      </section></div>
    `);
    expect(measurements.navigatorWorkbenches[0].firstRow).toEqual({ left: 100, top: 100, right: 200, bottom: 132, width: 100, height: 32 });
    expect(measurements.tableScrollports.map((area) => area.dom)).toContain("section.navigator-workbench__task");
  });

  it("measures Catalog module counts alongside shared workbench counts", () => {
    const measurements = collectMarkup(`
      <div class="navigator-workbench">
        <div class="navigator-workbench__navigation">
          <span class="parameter-catalog__module-count">4</span>
          <span class="dts-topology-navigator__count">12 个参数</span>
          <span class="parameter-catalog__subject-meta">已登记</span>
        </div>
      </div>
    `);
    expect(measurements.navigatorWorkbenches[0].navigatorCounts.map((count) => count.text)).toEqual(["4", "12 个参数"]);
  });

  it.each(["/parameters", "/parameter-admin", "/parameter-admin/specs", "/parameter-admin/spec-review", "/parameter-admin/identity-mapping", "/parameter-admin/specs/identity-mapping", "/parameters/definitions"])(
    "requires navigator-workbench geometry for the migrated route %s", (path) => {
      expect(consistencyRoutes.find((route) => route.path === path)?.required).toContain("navigatorWorkbenches");
    }
  );

  it.each(["/parameter-admin/spec-review", "/parameter-admin/specs", "/parameter-admin/identity-mapping", "/parameter-admin/specs/identity-mapping"])(
    "covers the pending-work deep link for %s without dropping workbench guarantees", (path) => {
      expect(consistencyRoutes.find((route) => route.path === `${path}?review=open`)?.required)
        .toEqual(expect.arrayContaining(["navigatorWorkbenches", "rowActions", "moduleTreeLabels", "paginationControls"]));
    }
  );

  it("checks actual switches nested in module navigator containers while excluding only tree items", () => {
    const measurements = collectMarkup(`
      <div class="dts-parameter-workbench__navigator"><div role="tablist"><button role="tab">Protocol</button></div></div>
      <div class="dts-topology-navigator"><div role="radiogroup"><button role="radio">Scope</button></div></div>
      <div role="tree"><button role="treeitem" class="view-switch__item">Module</button></div>
      <button class="parameter-catalog__tree-select--group view-switch__item">Catalog module</button>
    `);
    expect(measurements.viewSwitches.map((control) => control.role)).toEqual(["tab", "radio"]);
  });
  it("collects shared and legacy switches, never Catalog tree-select or module navigator selections", () => {
    const dom = new JSDOM(`
      <header class="topbar"><button class="view-switch__item">Topbar switch</button></header>
      <main>
        <nav><button class="view-switch__item" aria-current="page">Section switch</button></nav>
        <div role="tablist"><button class="view-switch__item" role="tab" aria-selected="true">Content tab</button></div>
        <div role="radiogroup"><button class="view-switch__item" role="radio" aria-checked="true">Option toggle</button></div>
        <button class="protocol-switch-button" aria-pressed="true">Legacy protocol</button>
        <div role="group" aria-label="日志视图切换"><button aria-pressed="true">Legacy log switch</button></div>
        <nav><ul class="parameter-catalog__tree"><li>
          <button class="parameter-catalog__tree-select" aria-pressed="true"><span class="parameter-catalog__tree-label">Module</span></button>
          <button role="treeitem" class="view-switch__item" aria-selected="true">Misclassified navigator item</button>
        </li></ul></nav>
        <nav><button class="parameter-catalog__tree-select" aria-pressed="false">Standalone module</button></nav>
        <nav><button role="treeitem" aria-selected="true" class="view-switch__item">Tree item</button></nav>
        <div role="tree"><button role="treeitem" class="protocol-switch-button" aria-pressed="true">Tree selection</button></div>
        <div class="dts-topology-navigator"><button role="treeitem" class="view-switch__item" aria-pressed="true">Topology selection</button></div>
        <div class="dts-parameter-workbench__navigator"><button role="treeitem" class="view-switch__item" aria-selected="true">Navigator selection</button></div>
        <button class="parameter-catalog__tree-select--group view-switch__item" aria-pressed="true">Catalog class family</button>
        <nav><button aria-pressed="true">Legacy section button</button><a aria-current="page">Legacy section link</a></nav>
        <div role="tablist"><button role="tab" aria-selected="true">Semantic tab</button></div>
        <div role="radiogroup"><button role="radio" aria-checked="true">Semantic radio</button></div>
      </main>
    `);
    vi.spyOn(dom.window.Element.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40, toJSON: () => ({})
    });
    dom.window.Element.prototype.checkVisibility = () => true;
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
    try {
      const measurements = collectConsistencyMeasurements();
      expect(measurements.viewSwitches.map((control) => control.dom).sort()).toEqual([
        "button.view-switch__item", "button.view-switch__item", "button.view-switch__item",
        "button.protocol-switch-button", "button", "button.view-switch__item",
        "button", "a", "button", "button"
      ].sort());
      expect(measurements.viewSwitches.some((control) => control.dom === "button.parameter-catalog__tree-select")).toBe(false);
      expect(measurements.moduleTreeLabels.map((control) => control.dom)).toEqual(["span.parameter-catalog__tree-label"]);
    } finally {
      vi.unstubAllGlobals();
      dom.window.close();
    }
  });
});

describe("primary action collection", () => {
  it("measures every shared primary marker, including disabled actions and new callers", () => {
    const measurements = collectMarkup(`
      <button class="button primary">Legacy primary</button>
      <button data-slot="button" data-variant="default" disabled>Disabled primary</button>
      <a data-slot="button" data-variant="primary" href="#">New primary caller</a>
      <button data-primary-action="true">Shared legacy action</button>
      <button data-slot="button" data-variant="secondary">Not primary</button>
    `);
    expect(measurements.primaryActions.map((action) => action.disabled)).toEqual([false, true, false, false]);
  });
});

describe("Xiaoze placement contract", () => {
  it("protects pending-work tables portalled outside main as well as the background table", () => {
    const measurements = collectMarkup('<table><tr><td>Catalog</td></tr></table>',
      '<section role="dialog" aria-label="待处理工作"><table><tr><td>Review item</td></tr></table></section>');
    expect(measurements.visibleTableCount).toBe(2);
    expect(measurements.tableScrollports).toHaveLength(2);
  });

  it("requires protected areas whenever a consistency route renders a table", () => {
    expect(() => assertXiaozePlacement({
      xiaozeLaunchers: [], xiaozeHints: [], tableScrollports: [], stickyActionAreas: [], visibleTableCount: 1
    }, "/parameter-review")).toThrow("missing consistency measurements: tableScrollports");
  });
  it("protects native and ARIA tables without scroll containers on every table route", () => {
    const measurements = collectMarkup('<table><tr><td>Audit</td></tr></table><div role="grid">Logs</div><div role="table">Members</div>');
    expect(measurements.tableScrollports.map((area) => area.dom)).toEqual(["table", "div", "div"]);
    for (const path of ["/audit", "/logs", "/user-permissions", "/organization/members"]) {
      expect(consistencyRoutes.find((route) => route.path === path)?.required).toContain("tableScrollports");
      expect(() => requireMeasuredCategories({ tableScrollports: [] }, ["tableScrollports"], path))
        .toThrow(`${path}: missing consistency measurements: tableScrollports`);
    }
  });
  it("protects the audit route's row list even though it is not a native or ARIA table", () => {
    const measurements = collectMarkup('<div class="audit-workspace-list"><ul><li>审计记录</li></ul></div>');
    expect(measurements.tableScrollports.map((area) => area.dom)).toEqual(["div.audit-workspace-list"]);
    expect(consistencyRoutes.find((route) => route.path === "/audit")?.required).toContain("tableScrollports");
  });
  it.each([
    [false, 1440, true],
    [true, 1440, false],
    [false, 640, false],
    [false, 641, true]
  ])("requires the first-run hint only when CSS allows it (dialog=%s, width=%s)", (hasDialog, viewportWidth, expected) => {
    expect(shouldRequireXiaozeHint({ hasDialog, viewportWidth })).toBe(expected);
  });

  const table = { dom: "table-scrollport", rect: { left: 280, top: 100, right: 1416, bottom: 812, width: 1136, height: 712 } };
  const gutter = { dom: "launcher", rect: { left: 1360, top: 820, right: 1416, bottom: 876, width: 56, height: 56 } };
  const overlap = { dom: "overlay", rect: { left: 1200, top: 780, right: 1256, bottom: 836, width: 56, height: 56 } };

  it.each(["xiaozeLaunchers", "xiaozeHints"] as const)("rejects %s covering a table or sticky action area", (category) => {
    for (const protectedCategory of ["tableScrollports", "stickyActionAreas"] as const) {
      expect(() => assertXiaozePlacement({ xiaozeLaunchers: [gutter], xiaozeHints: [], tableScrollports: [], stickyActionAreas: [], [category]: [overlap], [protectedCategory]: [table] }, "/parameters"))
        .toThrow("/parameters: overlay overlaps table-scrollport");
    }
  });

  it("allows edge contact, a dismissed hint, and overlays in the gutter", () => {
    const edge = { ...gutter, rect: { ...gutter.rect, top: 812, bottom: 868 } };
    expect(() => assertXiaozePlacement({ xiaozeLaunchers: [edge], xiaozeHints: [], tableScrollports: [table], stickyActionAreas: [table] }, "/parameters"))
      .not.toThrow();
  });
});

describe("compact filter, sort and pagination height contract", () => {
  it("rejects unmarked selects and select triggers in target toolbars, filters and pagination", () => {
    const measurements = collectMarkup(`
      <div class="audit-filters"><select aria-label="项目"><option>项目</option></select></div>
      <div role="toolbar"><button data-slot="select-trigger">状态</button><input role="combobox" aria-label="搜索" /></div>
      <nav class="pagination"><button role="combobox">每页数量</button></nav>
      <div class="filters"><button aria-haspopup="listbox" data-compact-control="filter">合规筛选</button></div>
      <select aria-label="普通表单"><option>表单</option></select>
    `);
    expect(measurements.unmarkedCompactControls.map((control) => control.dom))
      .toEqual(["select", "button", "button"]);
    expect(() => requireCompactControlHeights(measurements, "/audit"))
      .toThrow("unmarked compact control: select");
  });
  it("rejects an empty applicable category instead of vacuously accepting a route", () => {
    expect(() => requireCompactControlHeights({}, "/audit"))
      .toThrow("missing consistency measurements: filterControls");
  });
  const control = (dom: string, height: number, compactControl: string | null = "filter") => ({ dom, role: null, height, compactControl });

  it("does not invent pagination for read-only identity evidence but still validates rendered controls", () => {
    expect(() => requireCompactControlHeights({}, "/parameter-admin/specs/identity-mapping", ["navigatorWorkbenches"]))
      .not.toThrow();
    expect(() => requireCompactControlHeights({ paginationControls: [control("button", 38, "pagination")] },
      "/parameter-admin/specs/identity-mapping", ["navigatorWorkbenches"]))
      .toThrow("has height 38px; expected 32px");
  });

  it.each([
    ["viewSwitches", "button.parameter-admin-scope-nav__tab", 43],
    ["viewSwitches", "button.chip.chip-active", 30],
    ["viewSwitches", "button.parameter-home__toggle-item", 28],
    ["primaryActions", "button.button.subtle", 36],
    ["moduleTreeLabels", "button.parameter-catalog__tree-select", 40],
    ["xiaozeLaunchers", "button.xiaoze-chat-toggle", undefined]
  ])("ignores unrelated %s measurement %s in the full route result", (category, dom, height) => {
    const measurements = { [category]: [{ dom, height }], filterControls: [control("select.compact-filter-control", 32)],
      paginationControls: [control("button.next-page", 32, "pagination")] };
    expect(() => requireCompactControlHeights(measurements, "/parameter-admin/specs")).not.toThrow();
  });

  it("ignores unmarked controls even if they appear in a compact category", () => {
    expect(() => requireCompactControlHeights({ filterControls: [control("button.button.subtle", 36, null)] }, "/parameters"))
      .not.toThrow();
  });

  it.each([undefined, NaN, Infinity])("reports a marked control's missing or invalid height %s as a collection error", (height) => {
    expect(() => requireCompactControlHeights({ filterControls: [control("select.compact-filter-control", height as number)] }, "/audit"))
      .toThrow("/audit: compact control collection error: select.compact-filter-control has no finite height measurement");
  });

  it.each([undefined, null])("reports an absent route result %s as a collection error", (measurements) => {
    expect(() => requireCompactControlHeights(measurements, "/audit"))
      .toThrow("/audit: compact control collection error: route measurements are missing");
  });

  it("rejects a filter below the 32px PC minimum with actionable route evidence", () => {
    expect(() => requireCompactControlHeights({ filterControls: [control("select", 28)] }, "/audit"))
      .toThrow("/audit: select has height 28px; expected 32px");
  });

  it.each(["filterControls", "sortControls", "paginationControls"] as const)("rejects inconsistent %s even when above the minimum", (category) => {
    expect(() => requireCompactControlHeights({ [category]: [control("button", 38)] }, "/parameter-admin/specs"))
      .toThrow("/parameter-admin/specs: button has height 38px; expected 32px");
  });

  it("accepts native and custom peers across all three jobs at 32px", () => {
    expect(() => requireCompactControlHeights({
      filterControls: [control("select", 32), control("button", 32)],
      sortControls: [control("select.library-sort", 32, "sort")],
      paginationControls: [control("button", 32, "pagination"), control("select", 32, "pagination")]
    }, "/parameter-admin/specs")).not.toThrow();
  });

  it.each([0, 31.999, 32.001])("rejects a measured height outside the compact contract: %s", (height) => {
    expect(() => requireCompactControlHeights({ sortControls: [control("select", height)] }, "/parameters"))
      .toThrow("expected 32px");
  });

  it("leaves absent categories to the independent required-coverage guard", () => {
    expect(() => requireCompactControlHeights({}, "/knowledge")).not.toThrow();
  });
});

describe("consistency measurement coverage", () => {
  it("allows the failed logs layout without a table, but still requires measurements for visible tables", () => {
    expect(() => requireMeasuredCategories({ tableScrollports: [], visibleTableCount: 0 }, ["tableScrollports"], "/logs"))
      .not.toThrow();
    expect(() => requireMeasuredCategories({ tableScrollports: [], visibleTableCount: 1 }, ["tableScrollports"], "/logs"))
      .toThrow("tableScrollports");
    expect(() => requireMeasuredCategories({ tableScrollports: [] }, ["tableScrollports"], "/logs"))
      .toThrow("tableScrollports");
    expect(() => requireMeasuredCategories({ tableScrollports: [], visibleTableCount: 0 }, ["tableScrollports"], "/parameters"))
      .toThrow("tableScrollports");
  });

  it("fails with the route and missing applicable category instead of silently passing", () => {
    expect(() => requireMeasuredCategories({ viewSwitches: [] }, ["viewSwitches"], "/parameters"))
      .toThrow("/parameters: missing consistency measurements: viewSwitches");
  });

  it("reports every missing required category, including absent fields", () => {
    expect(() => requireMeasuredCategories({}, ["primaryActions", "rowActions", "xiaozeHints"], "/parameter-admin/specs"))
      .toThrow("/parameter-admin/specs: missing consistency measurements: primaryActions, rowActions, xiaozeHints");
  });

  it("accepts collected categories and ignores categories that do not apply", () => {
    expect(() => requireMeasuredCategories({ primaryActions: [{}], rowActions: [] }, ["primaryActions"], "/log-dashboard"))
      .not.toThrow();
  });

  it("covers the audit's view-switch paths and the other Phase 2 surfaces", () => {
    const paths = consistencyRoutes.map((route) => route.path);
    expect(paths).toEqual(expect.arrayContaining([
      "/audit", "/debugging-admin", "/debugging-admin/nodes", "/dts-reload", "/logs", "/node-debugging",
      "/organization", "/organization/members", "/parameter-admin", "/parameter-admin/identity-mapping",
      "/parameter-admin/modules", "/parameter-admin/modules/queue", "/parameter-admin/modules/registry",
      "/parameter-admin/projects", "/parameter-admin/projects/aurora/review-roles", "/parameter-admin/spec-review",
      "/parameter-admin/specs", "/parameter-admin/specs/identity-mapping", "/parameter-home", "/parameter-review",
      "/parameter-submissions", "/parameters", "/user-permissions", "/parameters/definitions", "/knowledge",
      "/log-dashboard", "/log-admin", "/feedback-admin", "/parameter-admin/projects/aurora",
      "/parameter-admin/projects/aurora/config-sets", "/parameter-admin/projects/aurora/configuration",
      "/parameter-admin/projects/aurora/conflicts", "/parameter-admin/projects/aurora/files",
      "/parameter-admin/projects/aurora/structure"
    ]));
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("requires each applicable category independently of what the collector finds", () => {
    expect(consistencyRoutes.find((route) => route.path === "/parameters")?.required).toEqual(expect.arrayContaining([
      "viewSwitches", "rowActions", "tableScrollports", "xiaozeLaunchers", "moduleTreeLabels"
    ]));
    expect(consistencyRoutes.find((route) => route.path === "/parameter-admin/specs")?.required).toEqual(expect.arrayContaining([
      "primaryActions", "paginationControls", "moduleTreeLabels", "rowActions"
    ]));
    expect(consistencyRoutes.find((route) => route.path === "/debugging-admin/nodes")?.required).toContain("filterControls");
    expect(consistencyRoutes.find((route) => route.path === "/parameter-home")?.required).toContain("filterControls");
    expect(consistencyRoutes.find((route) => route.path === "/parameters")?.required).not.toContain("filterControls");
    expect(consistencyRoutes.find((route) => route.path === "/parameter-admin/specs")?.required).not.toContain("sortControls");
  });

  it("requires the launcher but leaves dismissible, route-dependent hints optional", () => {
    for (const route of consistencyRoutes) {
      expect(route.required, route.path).toContain("xiaozeLaunchers");
      expect(route.required, route.path).not.toContain("xiaozeHints");
    }
  });
});

describe("consistency read guard", () => {
  it.each([
    ["POST", "/api/v1/device-bridges/pairing-codes", "fulfill"],
    ["GET", "/api/v1/device-bridges/pairing-codes", "fallback"],
    ["HEAD", "/api/v1/device-bridges/pairing-codes", "abort"],
    ["OPTIONS", "/api/v1/device-bridges/pairing-codes", "abort"],
    ["PUT", "/api/v1/device-bridges/pairing-codes", "abort"],
    ["PATCH", "/api/v1/device-bridges/pairing-codes", "abort"],
    ["DELETE", "/api/v1/device-bridges/pairing-codes", "abort"],
    ["POST", "/api/v1/device-bridges/pairing-codes/extra", "abort"],
    ["POST", "/api/v1/device-bridges", "abort"]
  ])("handles %s %s via %s without forwarding writes", async (method, pathname, action) => {
    const route = vi.fn<(url: string, handler: (intercepted: Route) => Promise<void>) => Promise<void>>();
    const blocked = await installConsistencyReadGuard({ route, routeWebSocket: vi.fn() } as unknown as BrowserContext);
    const intercepted = {
      request: () => ({ method: () => method, url: () => `https://consistency.example${pathname}?token=private` }),
      fallback: vi.fn(),
      fulfill: vi.fn(),
      abort: vi.fn()
    };
    await route.mock.calls[0][1](intercepted as unknown as Route);
    expect(intercepted.fallback).toHaveBeenCalledTimes(action === "fallback" ? 1 : 0);
    expect(intercepted.fulfill).toHaveBeenCalledTimes(action === "fulfill" ? 1 : 0);
    expect(intercepted.abort).toHaveBeenCalledTimes(action === "abort" ? 1 : 0);
    expect(blocked).toEqual(action === "abort" ? [{ method, pathname }] : []);
    if (action === "fulfill") {
      const response = intercepted.fulfill.mock.calls[0][0];
      expect(response.status).toBe(201);
      expect(response.json.code).toMatch(/^\d{6}$/);
      expect(Date.parse(response.json.expiresAt)).toBeGreaterThan(Date.now());
    }
  });
});
