import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { describe, expect, it } from "vitest";

import {
  CatalogReleaseDigest,
  CatalogReleaseId,
  CatalogSubjectId,
} from "../../parameter-catalog-contract/index";

import {
  fingerprintRegistrationCommand,
  registrationCommandFamily,
  validateRegistrationCommand,
  type RegisterSubjectCommand,
} from "./command";
import { mapGuardDatabaseError } from "./failures";
import { ASSERT_CATALOG_SUBJECT_ACTIVE_SQL } from "./guardAdapter";
import { THREAT_MATRIX } from "./threatMatrix";

const dir = path.dirname(fileURLToPath(import.meta.url));

const productionFiles = [
  "command.ts",
  "result.ts",
  "failures.ts",
  "service.ts",
  "unitOfWork.ts",
  "repositories.ts",
  "guardAdapter.ts",
  "internalGuardedRegistrationWriter.ts",
  "index.ts",
  "threatMatrix.ts",
] as const;

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

const allowedCatalogIdentifiers = new Set([
  "assert_catalog_subject_active",
  "organization_subject_registrations",
  "subject_placements",
  "governance_command_idempotency",
]);

const pin = {
  id: CatalogReleaseId("crel_acme_1"),
  digest: CatalogReleaseDigest(`sha256:${"a".repeat(64)}`),
};

const registerCommand = (
  overrides: Partial<RegisterSubjectCommand> = {},
): RegisterSubjectCommand => ({
  kind: "register",
  organizationId: "org-s4-reg",
  subjectId: CatalogSubjectId("csub_acme_power"),
  subjectKind: "driver",
  expectedRelease: pin,
  placement: { mode: "use-default" },
  destinationModuleId: "pmod-s4-reg-driver",
  method: "explicit",
  proof: { reason: "captured-kernel-proof", note: "stable" },
  idempotencyKey: "reg-key-1",
  context: { actorKind: "org-admin", principalId: "user-org-admin" },
  ...overrides,
});

const databaseError = (code: string, detail: string): pg.DatabaseError => {
  const error = Object.assign(new Error(detail), { code, detail });
  Object.setPrototypeOf(error, pg.DatabaseError.prototype);
  return error as pg.DatabaseError;
};

describe("S4-REG public command contract", () => {
  it("owns the frozen command family and threat-matrix coverage", () => {
    expect(registrationCommandFamily).toBe("subject-registration");
    expect(THREAT_MATRIX).toHaveLength(10);
  });

  it("fingerprints canonical proof key order identically", () => {
    const first = fingerprintRegistrationCommand(
      registerCommand({ proof: { note: "stable", reason: "captured-kernel-proof" } }),
    );
    const second = fingerprintRegistrationCommand(
      registerCommand({ proof: { reason: "captured-kernel-proof", note: "stable" } }),
    );
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(second).toBe(first);
  });

  it("refuses automatic registration that chooses a curated parent", () => {
    const result = validateRegistrationCommand(
      registerCommand({
        method: "automatic",
        context: { actorKind: "trusted-system", principalId: "system-matcher" },
        placement: {
          mode: "choose-parent",
          parentPlacementId: "spla_parent" as never,
          displayName: "Charging",
        },
      }),
    );
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "invalid-command",
        reason: "automatic-registration-requires-use-default",
      },
    });
  });

  it("refuses automatic registration from an Org Admin", () => {
    const result = validateRegistrationCommand(
      registerCommand({ method: "automatic" }),
    );
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "permission-denied",
        actorKind: "org-admin",
        method: "automatic",
      },
    });
  });

  it("maps each Catalog guard SQLSTATE to a typed failure", () => {
    expect(mapGuardDatabaseError(databaseError("PCA01", "PCAT-GUARD-RELEASE-MISMATCH"), pin, "csub")).toEqual({
      kind: "release-drift",
      code: "PCAT-GUARD-RELEASE-MISMATCH",
      sqlstate: "PCA01",
      expected: pin,
    });
    expect(mapGuardDatabaseError(databaseError("PCA02", "PCAT-GUARD-SUBJECT-NOT-PUBLISHED"), pin, "csub")).toEqual({
      kind: "subject-not-published",
      code: "PCAT-GUARD-SUBJECT-NOT-PUBLISHED",
      sqlstate: "PCA02",
      subjectId: "csub",
    });
    expect(mapGuardDatabaseError(databaseError("PCA03", "PCAT-GUARD-SUBJECT-RETIRED"), pin, "csub")).toEqual({
      kind: "subject-retired",
      code: "PCAT-GUARD-SUBJECT-RETIRED",
      sqlstate: "PCA03",
      subjectId: "csub",
    });
    expect(mapGuardDatabaseError(databaseError("PCA04", "PCAT-GUARD-DRIFT"), pin, "csub")).toEqual({
      kind: "catalog-drift",
      code: "PCAT-GUARD-DRIFT",
      sqlstate: "PCA04",
    });
    expect(mapGuardDatabaseError(databaseError("PCA05", "PCAT-GUARD-SYNCHRONIZATION-BUSY"), pin, "csub")).toEqual({
      kind: "synchronization-busy",
      code: "PCAT-GUARD-SYNCHRONIZATION-BUSY",
      sqlstate: "PCA05",
      retryable: true,
    });
  });
});

describe("S4-REG production Catalog isolation", () => {
  it("never selects or inserts Catalog structural rows and only calls the scalar guard", () => {
    const sources = productionFiles.map((file) => ({
      file,
      source: readFileSync(path.join(dir, file), "utf8"),
    }));
    for (const { file, source } of sources) {
      expect(source, file).not.toContain("parameter_definitions");
      expect(source, file).not.toMatch(/pg_advisory_/);
      for (const token of catalogStructuralTokens) {
        expect(source, `${file} must not mention ${token}`).not.toContain(token);
      }
      const identifiers = [...source.matchAll(/parameter_catalog\.([A-Za-z_][A-Za-z0-9_]*)/g)].map(
        (match) => match[1],
      );
      for (const identifier of identifiers) {
        expect(allowedCatalogIdentifiers.has(identifier), `${file} -> ${identifier}`).toBe(true);
      }
    }

    const writer = sources.find((entry) => entry.file === "internalGuardedRegistrationWriter.ts");
    const adapter = sources.find((entry) => entry.file === "guardAdapter.ts");
    expect(writer).toBeDefined();
    expect(adapter?.source).toContain(ASSERT_CATALOG_SUBJECT_ACTIVE_SQL);
    expect(ASSERT_CATALOG_SUBJECT_ACTIVE_SQL).toBe(
      "select parameter_catalog.assert_catalog_subject_active($1,$2,$3,$4)",
    );
    const idempotencyIndex = writer!.source.indexOf("reserveIdempotency");
    const guardIndex = writer!.source.indexOf("assertCatalogSubjectActive");
    expect(idempotencyIndex).toBeGreaterThanOrEqual(0);
    expect(guardIndex).toBeGreaterThan(idempotencyIndex);
  });
});
