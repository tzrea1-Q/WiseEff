import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createSourceFile, forEachChild, isArrayLiteralExpression, isCallExpression, isPropertyAccessExpression, isPropertyAssignment, isStringLiteralLike, ScriptTarget, type Node } from "typescript";
import { describe, expect, it } from "vitest";
import { compactQualityRoutes } from "../e2e/quality/compact-routes";
import { consistencyReadOnlyRoutes, consistencyRoutes } from "../e2e/quality/consistency-routes";
import { qualityRoutePaths, routeOwnership } from "../e2e/quality/route-ownership";
import { selectBrowserImpact, type BrowserInventory } from "./test-impact";
import { discoverBrowserInventory, unresolvedBrowserNavigation } from "./browser-navigation";

const inventory: BrowserInventory = {
  "e2e/acceptance/unrelated-name.spec.ts": ["/logs?tab=history"],
  "e2e/acceptance/organization.spec.ts": ["/organization"],
};

describe("browser impact selection", () => {
  it("selects knowledge acceptance flows visiting /logs for a logs change", () => {
    const selection = selectBrowserImpact(["src/features/log-analysis/LogsPage.tsx"]);

    expect(selection.fullFallback).toBe(false);
    expect(selection.qualityRoutes).toContain("/logs");
    expect(selection.qualityRoutes).toContain("/log-admin");
    expect(selection.qualityRoutes).not.toContain("/log-dashboard");
    expect(selection.acceptanceSpecs).toEqual([
      "e2e/acceptance/knowledge.acceptance.spec.ts",
      "e2e/acceptance/log-analysis.acceptance.spec.ts",
      "e2e/acceptance/log-skill-design-goals.acceptance.spec.ts",
      "e2e/acceptance/log-skill-knowledge.acceptance.spec.ts",
      "e2e/acceptance/log904-related-parameter.acceptance.spec.ts",
      "e2e/acceptance/shell-navigation.acceptance.spec.ts",
    ]);
    const grep = new RegExp(selection.qualityGrep!);
    expect(grep.test("keeps stable visual baseline for /logs (light)")).toBe(true);
    expect(grep.test("asserts read-only UI consistency for /logs?tab=history (dark)")).toBe(true);
    expect(grep.test("keeps stable visual baseline for /organization (light)")).toBe(false);
    expect(grep.test("warm vite entry graph")).toBe(true);
    expect(grep.test("scans key modal, drawer, and Xiaoze interaction states")).toBe(true);
  });

  it("owns every registered quality route and gives every feature at least one registered route", () => {
    const registered = [...new Set([
      "/", ...compactQualityRoutes.map((route) => route.path),
      ...consistencyReadOnlyRoutes.map((route) => route.path.split("?")[0]),
    ])].sort();
    expect(qualityRoutePaths).toEqual(registered);
    for (const route of qualityRoutePaths) {
      expect(Object.values(routeOwnership).some((routes) => routes.includes(route)), route).toBe(true);
    }
    for (const [feature, routes] of Object.entries(routeOwnership)) {
      expect(routes.length, feature).toBeGreaterThan(0);
      for (const route of routes) expect(qualityRoutePaths, feature).toContain(route);
    }
  });

  it("keeps the log overview contract separate from the back-office list tabs", () => {
    const overview = consistencyRoutes.find((route) => route.path === "/log-admin")!;
    expect(overview.required).toContain("overviewPages");
    expect(overview.required).not.toContain("adminLists");
    expect(overview.required).not.toContain("tableScrollports");
    for (const tab of ["records", "skills", "quality"]) {
      const list = consistencyRoutes.find((route) => route.path === `/log-admin?tab=${tab}`)!;
      expect(list.required).toContain("adminLists");
      expect(list.required).toContain("tableScrollports");
      expect(list.required).not.toContain("overviewPages");
    }
  });

  it("keeps shared coverage full, selects parameter-home visitors, and bounds unresolved specs", () => {
    const discovered = discoverBrowserInventory(fileURLToPath(new URL("../", import.meta.url)));
    const unresolved = Object.keys(discovered).filter((spec) => discovered[spec] === null);
    expect(unresolved).toEqual(Object.keys(unresolvedBrowserNavigation));
    expect(unresolved.length).toBeLessThanOrEqual(5);
    for (const reason of Object.values(unresolvedBrowserNavigation)) expect(reason.trim()).not.toBe("");
    const shared = selectBrowserImpact(["src/components/layout/AdminListPage.tsx"], discovered);
    expect(shared.fullFallback).toBe(true);
    expect(shared.acceptanceSpecs).toEqual(Object.keys(discovered).sort());
    const home = selectBrowserImpact(["src/features/parameter-home/ParameterHomePage.tsx"], discovered);
    expect(home.fullFallback).toBe(false);
    expect(home.qualityRoutes).toEqual(["/parameter-home"]);
    expect(home.acceptanceSpecs).toEqual([
      "e2e/acceptance/canonical-dashboard.acceptance.spec.ts",
      "e2e/acceptance/issue897-canonical-modules.acceptance.spec.ts",
      "e2e/acceptance/parameter-admin-projects.acceptance.spec.ts",
      "e2e/acceptance/parameter-catalog-governance.acceptance.spec.ts",
      "e2e/acceptance/parameter-catalog.acceptance.spec.ts",
      "e2e/acceptance/parameter-home.acceptance.spec.ts",
      "e2e/acceptance/permissions-matrix.acceptance.spec.ts",
      "e2e/acceptance/project-configuration-workbench.acceptance.spec.ts",
      "e2e/acceptance/shell-navigation.acceptance.spec.ts",
      "e2e/acceptance/xiaoze-popup-layout.acceptance.spec.ts",
    ]);
  });

  it("covers route registrations in every quality spec, not only the consistency registry", () => {
    const directory = new URL("../e2e/quality/", import.meta.url);
    for (const filename of readdirSync(directory).filter((file) => file.endsWith(".quality.spec.ts"))) {
      const check = (node: Node) => {
        const registrations = isArrayLiteralExpression(node) ? node.elements
          : isPropertyAssignment(node) && node.name.getText() === "path" ? [node.initializer]
            : isCallExpression(node) && isPropertyAccessExpression(node.expression) && node.expression.name.text === "goto" ? node.arguments.slice(0, 1) : [];
        for (const registration of registrations) {
          if (isStringLiteralLike(registration) && registration.text.startsWith("/") && !registration.text.startsWith("/api/")) {
            expect(qualityRoutePaths, filename).toContain(registration.text.split("?")[0]);
          }
        }
        forEachChild(node, check);
      };
      check(createSourceFile(filename, readFileSync(new URL(filename, directory), "utf8"), ScriptTarget.Latest, true));
    }
  });

  it("selects by visited route, retaining cross-route quality tests and shared checks", () => {
    const selection = selectBrowserImpact(["src/features/log-analysis/logs.css"], inventory);
    expect(selection.acceptanceSpecs).toEqual(["e2e/acceptance/unrelated-name.spec.ts"]);
    const grep = new RegExp(selection.qualityGrep!);
    expect(grep.test("handoff from /knowledge to /logs (light)")).toBe(true);
    expect(grep.test("Bridge readiness on /node-debugging: unavailable (light)")).toBe(false);
  });

  it.each([
    ["src/features/parameter-review/CanonicalBatchSubmitDialog.tsx", "/parameter-admin/projects/aurora/configuration"],
    ["src/components/parameter-admin-next/CanonicalSubjectPlacementPanel.tsx", "/parameters/definitions"],
    ["src/features/parameter-catalog-governance/RegistrationDialog.tsx", "/parameters"],
  ])("includes cross-feature consumers of %s", (file, route) => {
    const selection = selectBrowserImpact([file], { "e2e/acceptance/parameter.spec.ts": [route] });
    expect(selection.qualityRoutes).toContain(route);
    expect(selection.acceptanceSpecs).toEqual(["e2e/acceptance/parameter.spec.ts"]);
  });

  it.each(["src/App.tsx", "src/styles.css", "src/components/ui/button.tsx", "e2e/quality/helpers.ts", ".github/workflows/ci.yml", "src/new-feature.ts", "server/modules/logs/routes.ts"])("keeps full browser coverage for shared or unknown %s", (file) => {
    const selection = selectBrowserImpact([file], inventory);
    expect(selection.fullFallback).toBe(true);
    expect(selection.qualityRoutes).toEqual(qualityRoutePaths);
    expect(selection.qualityGrep).toBe(".*");
    expect(selection.acceptanceSpecs).toEqual(Object.keys(inventory).sort());
  });

  it("does not hide an unknown change behind a mapped change, or a missing discovery behind ownership", () => {
    expect(selectBrowserImpact(["src/features/log-analysis/LogsPage.tsx", "src/new-feature.ts"], inventory).fullFallback).toBe(true);
    expect(selectBrowserImpact(["src/features/log-analysis/LogsPage.tsx"], inventory, ["Missing source"]).fullFallback).toBe(true);
  });

  it("retains acceptance specs without route evidence rather than silently skipping them", () => {
    expect(selectBrowserImpact(["src/features/log-analysis/LogsPage.tsx"], { ...inventory, "e2e/acceptance/unknown.spec.ts": null }).acceptanceSpecs)
      .toEqual(["e2e/acceptance/unknown.spec.ts", "e2e/acceptance/unrelated-name.spec.ts"]);
  });

  it("rejects empty inventories, empty selections and unsafe paths, but leaves docs gate-only", () => {
    expect(() => selectBrowserImpact([], inventory)).toThrow(/empty/i);
    expect(() => selectBrowserImpact(["../outside.ts"], inventory)).toThrow(/invalid/i);
    expect(() => selectBrowserImpact(["src/features/log-analysis/LogsPage.tsx"], {})).toThrow(/empty/i);
    expect(() => selectBrowserImpact(["src/features/log-analysis/LogsPage.tsx"], { "org.spec.ts": ["/organization"] })).toThrow(/empty/i);
    expect(selectBrowserImpact(["docs/FRONTEND.md"], {})).toMatchObject({ qualityRoutes: [], acceptanceSpecs: [], commands: [] });
  });
});
