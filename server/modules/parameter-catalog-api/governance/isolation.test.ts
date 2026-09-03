import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createRouter } from "../../../shared/http/router";
import { parameterCatalogCanonicalRoutes } from "../../contracts/dtoSchemas/parameterCatalog";

import {
  catalogGovernanceCommandByRouteId,
  catalogGovernanceRouteIds,
  catalogGovernanceRoutes,
} from "./mapping";
import { registerCatalogGovernanceRoutes } from "./routes";
import type { CatalogGovernancePorts } from "./types";

const dir = path.dirname(fileURLToPath(import.meta.url));

const productionFiles = readdirSync(dir).filter(
  (file) => file.endsWith(".ts") && !file.includes(".test."),
);

const forbiddenImportPatterns = [
  /from\s+["'][^"']*internalGuardedRegistrationWriter["']/,
  /from\s+["'][^"']*unitOfWork["']/,
  /from\s+["']pg["']/,
  /writeGuardedRegistration\s*\(/,
  /pg_advisory_/,
  /executeCutover/,
  /restoreArchive/,
];

describe("S8-GOV production isolation", () => {
  it("never opens a tx handle, never imports the private S4-REG writer, and registers one route per command", () => {
    expect([...productionFiles].sort()).toEqual(
      [
        "dto.ts",
        "errors.ts",
        "handlers.ts",
        "http.ts",
        "index.ts",
        "mapping.ts",
        "ports.ts",
        "query.ts",
        "routes.ts",
        "threatMatrix.ts",
        "types.ts",
      ].sort(),
    );

    const sources = productionFiles.map((file) => ({
      file,
      source: readFileSync(path.join(dir, file), "utf8"),
    }));

    for (const { file, source } of sources) {
      for (const pattern of forbiddenImportPatterns) {
        expect(source, `${file} must not match ${pattern}`).not.toMatch(pattern);
      }
      if (file !== "threatMatrix.ts") {
        expect(source, file).not.toMatch(/query\(\s*["']begin["']/i);
        expect(source, file).not.toMatch(/query\(\s*["']commit["']/i);
      }
    }

    const handlers = sources.find((entry) => entry.file === "handlers.ts");
    const routes = sources.find((entry) => entry.file === "routes.ts");
    expect(handlers?.source).toContain("stripSpoofHeaders");
    expect(handlers?.source).toContain("executeRegistration");
    expect(handlers?.source).toContain("resolveReviewItem");
    expect(handlers?.source).toContain("executeProposal");
    expect(handlers?.source).toContain("listReviewQueue");
    expect(routes?.source).toContain("registerCatalogGovernanceRoutes");

    for (const [routeId, command] of Object.entries(catalogGovernanceCommandByRouteId)) {
      expect(handlers?.source, `${routeId} -> ${command}`).toContain(command);
    }

    expect(catalogGovernanceRouteIds).not.toContain("catalog.getLegacyIdentifier");
    expect(
      parameterCatalogCanonicalRoutes.some((route) => route.id === "catalog.getLegacyIdentifier"),
    ).toBe(true);
    expect(catalogGovernanceRoutes).toHaveLength(19);
  });

  it("registers every frozen PCAT-API-04..06 path on a WiseEff router", () => {
    const router = createRouter();
    const ports = {} as CatalogGovernancePorts;
    registerCatalogGovernanceRoutes(router, ports);
    const registered = router
      .listRoutes()
      .map((route) => `${route.method} ${route.pattern}`)
      .sort();
    const expected = catalogGovernanceRoutes
      .map((route) => `${route.method} ${route.path}`)
      .sort();
    expect(registered).toEqual(expected);
  });
});
