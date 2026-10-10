import type { BrowserContext, Route } from "playwright/test";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { assertXiaozePlacement, requireMeasuredCategories, requireCompactControlHeights, shouldRequireXiaozeHint } from "../e2e/quality/consistency-assertions";

function collectMarkup(markup: string) {
  const dom = new JSDOM(`<main>${markup}</main>`);
  vi.spyOn(dom.window.Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 100, y: 100, left: 100, top: 100, right: 200, bottom: 132, width: 100, height: 32, toJSON: () => ({})
  });
  dom.window.Element.prototype.checkVisibility = () => true;
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
import { consistencyRoutes } from "../e2e/quality/consistency-routes";
import { installConsistencyReadGuard } from "../e2e/quality/consistency";

describe("view-switch collection", () => {
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
