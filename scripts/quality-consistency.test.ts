import { describe, expect, it } from "vitest";
import { consistencyRoutes, requireConsistencyMeasurements } from "../e2e/quality/consistency";

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
      "viewSwitches", "rowActions", "tableScrollports", "xiaozeLaunchers", "xiaozeHints", "moduleTreeLabels", "filterControls", "sortControls"
    ]));
    expect(consistencyRoutes.find((route) => route.path === "/parameter-admin/specs")?.required).toEqual(expect.arrayContaining([
      "primaryActions", "paginationControls", "moduleTreeLabels", "rowActions"
    ]));
  });

  it("measures the first-run launcher and hint on every fresh app route", () => {
    for (const route of consistencyRoutes) {
      expect(route.required, route.path).toEqual(expect.arrayContaining(["xiaozeLaunchers", "xiaozeHints"]));
    }
  });
});
