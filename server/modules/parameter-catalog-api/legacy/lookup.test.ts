import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { MappingQueryable, ProtectedLookupResult } from "../../catalog-cutover/mapping";
import { catalogForbiddenSpoofHeaders } from "../../contracts/dtoSchemas/parameterCatalog";

import { catalogTargetHref, lookupLegacyIdentifier } from "./lookup";
import { THREAT_MATRIX } from "./threatMatrix";
import { LEGACY_LOOKUP_SOURCE_SYSTEM } from "./types";
import type { LegacyLookupFn } from "./types";

const dir = path.dirname(fileURLToPath(import.meta.url));
const productionFiles = readdirSync(dir).filter(
  (file) => file.endsWith(".ts") && !file.includes(".test."),
);

const client = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as MappingQueryable;

const mappedHead = {
  legacyIdentityId: "lid-mapped",
  currentVersionId: "lmap-1",
  casVersion: 1,
  version: {
    id: "lmap-1",
    legacyIdentityId: "lid-mapped",
    cutoverRunId: "run",
    versionNumber: 1,
    sourceChecksum: "sha256:mapped",
    graphFingerprint: "fp",
    rClass: "R4" as const,
    targetKind: "parameter-definition" as const,
    targetId: "pdef_01KGPIOINT",
    archiveId: null,
    evidenceArchiveId: null,
    supersedesVersionId: null,
  },
};

const mappedResult = {
  outcome: "mapped",
  head: mappedHead,
  targetKind: "parameter-definition",
  targetId: "pdef_01KGPIOINT",
} as const satisfies Extract<ProtectedLookupResult, { outcome: "mapped" }>;

describe("S8-LEG exact lookup", () => {
  it("projects an allow-listed mapped head without reverse search", async () => {
    const calls: unknown[] = [];
    const lookup: LegacyLookupFn = async (input) => {
      calls.push(input.identity);
      if (
        input.identity.kind === "source-tuple" &&
        input.identity.sourceKind === "parameter-spec" &&
        input.identity.sourceId === "spec-sc8562-gpio-int" &&
        input.identity.ownerScopeKind === "platform"
      ) {
        return { ok: true, value: mappedResult };
      }
      return { ok: false, error: { code: "PCAT-MAP-UNKNOWN-IDENTITY", detail: "missing" } };
    };

    const outcome = await lookupLegacyIdentifier({
      client,
      lookup,
      legacyType: "parameter-spec",
      legacyId: "spec-sc8562-gpio-int",
      organizationId: "org_acme",
    });
    expect(outcome).toEqual({
      kind: "mapped",
      item: {
        legacyType: "parameter-spec",
        legacyId: "spec-sc8562-gpio-int",
        disposition: "mapped",
        target: {
          kind: "parameter-definition",
          id: "pdef_01KGPIOINT",
          href: "/api/v2/catalog/definitions/pdef_01KGPIOINT",
        },
        historicalOnly: false,
      },
    });
    expect(calls.every((identity) => identity && typeof identity === "object" && "sourceId" in identity)).toBe(
      true,
    );
    expect(JSON.stringify(calls)).not.toContain("pdef_01KGPIOINT");
  });

  it("drops archive identifiers from archived outcomes", async () => {
    const lookup: LegacyLookupFn = async () => ({
      ok: true,
      value: {
        outcome: "archived",
        archiveId: "archive-secret-token",
        head: mappedHead,
      },
    });
    const outcome = await lookupLegacyIdentifier({
      client,
      lookup,
      legacyType: "parameter-spec",
      legacyId: "spec-archived",
      organizationId: null,
    });
    expect(outcome).toEqual({ kind: "archived" });
    expect(JSON.stringify(outcome)).not.toContain("archive-secret-token");
  });

  it("treats blocked and conflicting heads as ambiguous", async () => {
    const blocked = await lookupLegacyIdentifier({
      client,
      lookup: async () => ({
        ok: true,
        value: { outcome: "blocked", identityId: "lid-r0", rClass: "R0" },
      }),
      legacyType: "parameter-spec",
      legacyId: "spec-blocked",
      organizationId: null,
    });
    expect(blocked).toEqual({ kind: "ambiguous" });

    const conflict = await lookupLegacyIdentifier({
      client,
      lookup: async () => ({
        ok: false,
        error: { code: "PCAT-MAP-CONFLICT", detail: "two heads" },
      }),
      legacyType: "parameter-spec",
      legacyId: "spec-conflict",
      organizationId: null,
    });
    expect(conflict).toEqual({ kind: "ambiguous" });
  });

  it("does not infer from non-allow-listed types or canonical target ids", async () => {
    let calls = 0;
    const lookup: LegacyLookupFn = async () => {
      calls += 1;
      return { ok: false, error: { code: "PCAT-MAP-UNKNOWN-IDENTITY", detail: "missing" } };
    };
    const unknownType = await lookupLegacyIdentifier({
      client,
      lookup,
      legacyType: "driver-schema",
      legacyId: "schema-1",
      organizationId: "org_acme",
    });
    expect(unknownType).toEqual({ kind: "not-found" });
    expect(calls).toBe(0);

    const reverse = await lookupLegacyIdentifier({
      client,
      lookup,
      legacyType: "parameter-spec",
      legacyId: "pdef_01KGPIOINT",
      organizationId: "org_acme",
    });
    expect(reverse).toEqual({ kind: "not-found" });
    expect(catalogTargetHref("parameter-definition", "pdef_01KGPIOINT")).toBe(
      "/api/v2/catalog/definitions/pdef_01KGPIOINT",
    );
    expect(catalogTargetHref("definition-revision", "drev_01K7")).toBe("/api/v2/catalog");
    expect(LEGACY_LOOKUP_SOURCE_SYSTEM).toBe("wiseeff-v1");
  });
});

describe("S8-LEG production isolation", () => {
  it("keeps the owned production surface closed", () => {
    expect([...productionFiles].sort()).toEqual(
      [
        "gone.ts",
        "headers.ts",
        "httpServer.ts",
        "index.ts",
        "lookup.ts",
        "routes.ts",
        "threatMatrix.ts",
        "types.ts",
      ].sort(),
    );
  });

  it("T12 refuses reverse mapping, raw Archive, writes, and P12-P15 activation", () => {
    const sources = productionFiles.map((file) => ({
      file,
      source: readFileSync(path.join(dir, file), "utf8"),
    }));
    const runnable = sources.filter((entry) => entry.file !== "threatMatrix.ts");
    for (const { file, source } of runnable) {
      expect(source, file).not.toContain("restoreArchive");
      expect(source, file).not.toContain("persistArchive");
      expect(source, file).not.toContain("appendMappingVersion");
      expect(source, file).not.toContain("rewriteMappingVersion");
      expect(source, file).not.toContain("classifyFrozenP0Graph");
      expect(source, file).not.toContain("executeCutover");
      expect(source, file).not.toContain("parameter_catalog_archives");
      expect(source, file).not.toContain("createParameterSpec");
      expect(source, file).not.toMatch(/from ["'].*catalog-cutover\/archive/);
      expect(source, file).not.toMatch(/from ["'].*catalog-cutover\/orchestrator/);
      expect(source, file).not.toMatch(/from ["'].*catalog-cutover\/classifier/);
      expect(source, file).not.toMatch(/target_id\s*=/);
      expect(source, file).not.toContain("public.parameter_specs");
      expect(source, file).not.toContain("P12");
      expect(source, file).not.toContain("P13");
      expect(source, file).not.toContain("P14");
      expect(source, file).not.toContain("P15");
      for (const header of catalogForbiddenSpoofHeaders) {
        expect(source, `${file} must not read ${header}`).not.toContain(header);
      }
    }

    const lookup = sources.find((entry) => entry.file === "lookup.ts");
    expect(lookup?.source).toContain("lookupProtectedIdentity");
    expect(THREAT_MATRIX).toHaveLength(12);
  });
});
