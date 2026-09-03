import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parameterCatalogKernelReadByRouteId } from "../../contracts/dtoSchemas/parameterCatalog";

const dir = path.dirname(fileURLToPath(import.meta.url));

const productionFiles = readdirSync(dir).filter(
  (file) => file.endsWith(".ts") && !file.includes(".test."),
);

const catalogStructuralTokens = [
  "catalog_releases",
  "catalog_subjects",
  "catalog_drivers",
  "catalog_node_types",
  "catalog_release_subjects",
  "catalog_subject_aliases",
  "catalog_release_subject_aliases",
  "parameter_definitions",
  "definition_revisions",
  "catalog_release_definition_heads",
  "catalog_materializations",
  "catalog_state",
] as const;

describe("S8-READ production Catalog isolation", () => {
  it("never reads Catalog tables, never re-encodes Kernel cursors, and never post-filters pages", () => {
    expect([...productionFiles].sort()).toEqual(
      [
        "dto.ts",
        "errors.ts",
        "handlers.ts",
        "http.ts",
        "index.ts",
        "ports.ts",
        "query.ts",
        "threatMatrix.ts",
        "types.ts",
      ].sort(),
    );

    const sources = productionFiles.map((file) => ({
      file,
      source: readFileSync(path.join(dir, file), "utf8"),
    }));

    for (const { file, source } of sources) {
      expect(source, file).not.toContain("from \"pg\"");
      expect(source, file).not.toContain("from 'pg'");
      expect(source, file).not.toContain("createCatalogKernel");
      expect(source, file).not.toContain("loadCurrentCatalogSnapshot");
      expect(source, file).not.toContain("loadPinnedCatalogSnapshot");
      expect(source, file).not.toContain("loadProjection");
      expect(source, file).not.toContain("encodeCatalogCursor");
      expect(source, file).not.toContain("decodeCatalogCursor");
      expect(source, file).not.toContain("page.items.filter");
      expect(source, file).not.toContain("page.items.sort");
      expect(source, file).not.toContain("parameterSpecId");
      expect(source, file).not.toMatch(/pg_advisory_/);
      expect(source, file).not.toMatch(/parameter_catalog\.[A-Za-z_][A-Za-z0-9_]*/);
      for (const token of catalogStructuralTokens) {
        expect(source, `${file} must not mention ${token}`).not.toContain(token);
      }
    }

    const handlers = sources.find((entry) => entry.file === "handlers.ts");
    const dto = sources.find((entry) => entry.file === "dto.ts");
    const index = sources.find((entry) => entry.file === "index.ts");
    expect(handlers?.source).toContain("parameterCatalogKernelReadByRouteId");
    expect(handlers?.source).toContain("loadCurrentCatalog");
    expect(handlers?.source).toContain("getDefinitionById");
    expect(handlers?.source).toContain("getDefinitionRevision");
    expect(handlers?.source).not.toContain("selectedRevision");
    expect(dto?.source).toContain("selectedRevision");
    expect(index?.source).toContain("handleCatalogRead");
    expect(handlers?.source).toContain("stripSpoofHeaders");

    for (const [routeId, operation] of Object.entries(parameterCatalogKernelReadByRouteId)) {
      expect(handlers?.source, `${routeId} -> ${operation}`).toContain(operation);
    }
  });
});
