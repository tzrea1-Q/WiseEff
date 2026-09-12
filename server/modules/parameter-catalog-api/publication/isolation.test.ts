import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createRouter } from "../../../shared/http/router";
import { parameterCatalogCanonicalRoutes } from "../../contracts/dtoSchemas/parameterCatalog";

import {
  catalogPublicationCommandByRouteId,
  catalogPublicationRouteIds,
  catalogPublicationRoutes,
} from "./mapping";
import { registerCatalogPublicationRoutes } from "./routes";
import type { CatalogPublicationPorts } from "./types";

const dir = path.dirname(fileURLToPath(import.meta.url));

const productionFiles = readdirSync(dir).filter(
  (file) => file.endsWith(".ts") && !file.includes(".test."),
);

const forbiddenImportPatterns = [
  /from\s+["'][^"']*install\/installer["']/,
  /createCatalogInstaller\s*\(/,
  /installPublishedRelease\s*\(/,
  /catalog_synchronizer_role/,
  /set\s+local\s+role\s+catalog_synchronizer_role/i,
  /from\s+["']pg["']/,
];

describe("CP-07 publication HTTP isolation", () => {
  it("never holds synchronizer credentials or activates Catalog in the HTTP adapter", () => {
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
        if (file === "threatMatrix.ts" && pattern.source.includes("catalog_synchronizer_role")) {
          continue;
        }
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
    expect(handlers?.source).toContain("previewCandidate");
    expect(handlers?.source).toContain("publishCandidate");
    expect(routes?.source).toContain("registerCatalogPublicationRoutes");

    for (const [routeId, command] of Object.entries(catalogPublicationCommandByRouteId)) {
      expect(handlers?.source, `${routeId} -> ${command}`).toContain(command);
    }

    expect(catalogPublicationRouteIds).toHaveLength(4);
    expect(
      parameterCatalogCanonicalRoutes.filter((route) =>
        route.path.includes("/admin") || route.path.endsWith("/cancel") || route.path.endsWith("/retry"),
      ),
    ).toEqual([]);
    expect(catalogPublicationRoutes.map((route) => route.path)).toEqual([
      "/api/v2/catalog/publication-candidates",
      "/api/v2/catalog/publication-candidates/:candidateId",
      "/api/v2/catalog/publication-candidates/:candidateId/publish",
      "/api/v2/catalog/publications/:jobId",
    ]);
  });

  it("registers every frozen publication path on a WiseEff router", () => {
    const router = createRouter();
    const ports = {} as CatalogPublicationPorts;
    registerCatalogPublicationRoutes(router, ports);
    const registered = router
      .listRoutes()
      .map((route) => `${route.method} ${route.pattern}`)
      .sort();
    const expected = catalogPublicationRoutes
      .map((route) => `${route.method} ${route.path}`)
      .sort();
    expect(registered).toEqual(expected);
  });
});
