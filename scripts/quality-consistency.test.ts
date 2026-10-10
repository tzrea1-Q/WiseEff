import type { BrowserContext, Route } from "playwright/test";
import { describe, expect, it, vi } from "vitest";
import { assertXiaozePlacement, consistencyRoutes, installConsistencyReadGuard, requireConsistencyMeasurements } from "../e2e/quality/consistency";

describe("Xiaoze placement contract", () => {
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
      "viewSwitches", "rowActions", "tableScrollports", "xiaozeLaunchers", "moduleTreeLabels", "filterControls", "sortControls"
    ]));
    expect(consistencyRoutes.find((route) => route.path === "/parameter-admin/specs")?.required).toEqual(expect.arrayContaining([
      "primaryActions", "paginationControls", "moduleTreeLabels", "rowActions"
    ]));
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
