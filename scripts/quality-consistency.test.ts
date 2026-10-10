import type { BrowserContext, Route } from "playwright/test";
import { describe, expect, it, vi } from "vitest";
import { assertXiaozePlacement, consistencyRoutes, installConsistencyReadGuard, requireConsistencyMeasurements, requireCompactControlHeights, shouldRequireXiaozeHint } from "../e2e/quality/consistency";

describe("Xiaoze placement contract", () => {
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
  const control = (dom: string, height: number, compactControl: string | null = "filter") => ({ dom, role: null, height, compactControl });

  it.each([
    ["viewSwitches", "button.parameter-admin-scope-nav__tab", 43],
    ["viewSwitches", "button.chip.chip-active", 30],
    ["viewSwitches", "button.parameter-home__toggle-item", 28],
    ["primaryActions", "button.button.subtle", 36],
    ["moduleTreeLabels", "button.parameter-catalog__tree-select", 40],
    ["xiaozeLaunchers", "button.xiaoze-chat-toggle", undefined]
  ])("ignores unrelated %s measurement %s in the full route result", (category, dom, height) => {
    const measurements = { [category]: [{ dom, height }], filterControls: [control("select.compact-filter-control", 32)] };
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
      sortControls: [control("select.library-sort", 32)],
      paginationControls: [control("button", 32), control("select", 32)]
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
    expect(() => requireConsistencyMeasurements({ viewSwitches: [] }, ["viewSwitches"], "/parameters"))
      .toThrow("/parameters: missing consistency measurements: viewSwitches");
  });

  it("reports every missing required category, including absent fields", () => {
    expect(() => requireConsistencyMeasurements({}, ["primaryActions", "rowActions", "xiaozeHints"], "/parameter-admin/specs"))
      .toThrow("/parameter-admin/specs: missing consistency measurements: primaryActions, rowActions, xiaozeHints");
  });

  it("accepts collected categories and ignores categories that do not apply", () => {
    expect(() => requireConsistencyMeasurements({ primaryActions: [{}], rowActions: [] }, ["primaryActions"], "/log-dashboard"))
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
