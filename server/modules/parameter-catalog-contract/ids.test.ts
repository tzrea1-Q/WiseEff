import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CatalogCanonicalKey,
  CatalogEventTime,
  CatalogPageLimit,
  CatalogReleaseDigest,
  CatalogReleaseId,
  CatalogReleaseSequence,
  CatalogSearchText,
  CatalogSubjectId,
  DefinitionRevisionId,
  MaintenanceAttemptId,
  ParameterDefinitionId,
  PropertyKey,
  SubjectPlacementId
} from "./index";

const releaseId = CatalogReleaseId("crel_01K42");

// @ts-expect-error Raw wire strings must be validated and branded first.
const primitiveReleaseId: CatalogReleaseId = "crel_01K42";

// @ts-expect-error Different opaque identifier kinds are not interchangeable.
const crossKindSubjectId: CatalogSubjectId = releaseId;

void primitiveReleaseId;
void crossKindSubjectId;

const localRequire = createRequire(import.meta.url);
const typescriptCompilerPath = localRequire.resolve("typescript/bin/tsc");
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const contractTypecheckPaths = [
  "ids.test.ts",
  "enums.test.ts",
  "failures.test.ts",
  "operations.test.ts",
  "results.test.ts",
  "serialization.test.ts"
].map((file) => fileURLToPath(new URL(file, import.meta.url)));

describe("parameter catalog nominal identifiers", () => {
  it("preserves the validated wire primitive while keeping identifier kinds distinct", () => {
    expect(CatalogReleaseId("crel_01K42")).toBe("crel_01K42");
    expect(CatalogReleaseDigest("sha256:release")).toBe("sha256:release");
    expect(CatalogSubjectId("csub_01KSC8562")).toBe("csub_01KSC8562");
    expect(ParameterDefinitionId("pdef_01KVIN")).toBe("pdef_01KVIN");
    expect(DefinitionRevisionId("drev_01KVIN3")).toBe("drev_01KVIN3");
    expect(SubjectPlacementId("spla_root_drivers")).toBe("spla_root_drivers");
    expect(MaintenanceAttemptId("maint_01KCUTOVER")).toBe("maint_01KCUTOVER");
  });

  it("rejects empty, surrounding-whitespace, or control-bearing strings without inventing formats", () => {
    expect(CatalogCanonicalKey("driver:sc8562")).toBe("driver:sc8562");
    expect(PropertyKey("input_voltage_limit")).toBe("input_voltage_limit");
    expect(CatalogSearchText("driver compatible")).toBe("driver compatible");
    expect(CatalogEventTime("2026-09-01T00:00:00.000Z")).toBe(
      "2026-09-01T00:00:00.000Z"
    );

    for (const invalid of ["", " ", " crel_01K42", "crel_01K42 "]) {
      expect(() => CatalogReleaseId(invalid)).toThrow(TypeError);
    }
    expect(() => CatalogReleaseDigest(" sha256:release")).toThrow(TypeError);
    expect(() => CatalogCanonicalKey("driver:sc8562\n")).toThrow(TypeError);
    expect(() => PropertyKey(" input_voltage_limit")).toThrow(TypeError);
    expect(() => CatalogSearchText("driver compatible ")).toThrow(TypeError);
    expect(() => CatalogEventTime("\t2026-09-01T00:00:00.000Z")).toThrow(TypeError);
    expect(() => CatalogReleaseId("crel_01K\n42")).toThrow(TypeError);
    expect(() => CatalogReleaseDigest("sha256:\0release")).toThrow(TypeError);
    expect(() => CatalogCanonicalKey("driver:\u0085sc8562")).toThrow(TypeError);
    expect(() => CatalogReleaseId(42 as never)).toThrow(TypeError);
  });

  it("accepts only safe-integer page limits and release sequences in their ranges", () => {
    expect(CatalogPageLimit(1)).toBe(1);
    expect(CatalogPageLimit(Number.MAX_SAFE_INTEGER)).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(CatalogReleaseSequence(0)).toBe(0);
    expect(CatalogReleaseSequence(42)).toBe(42);
    expect(CatalogReleaseSequence(Number.MAX_SAFE_INTEGER)).toBe(
      Number.MAX_SAFE_INTEGER,
    );

    for (const invalid of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      Number.MAX_VALUE,
    ]) {
      expect(() => CatalogPageLimit(invalid)).toThrow(TypeError);
    }
    for (const invalid of [
      -1,
      0.5,
      Number.NaN,
      Number.NEGATIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      Number.MAX_VALUE,
    ]) {
      expect(() => CatalogReleaseSequence(invalid)).toThrow(TypeError);
    }
    expect(() => CatalogPageLimit("1" as never)).toThrow(TypeError);
  });

  it("enforces nominal assignments with the repository-pinned TypeScript compiler", () => {
    const compilation = spawnSync(
      process.execPath,
      [
        typescriptCompilerPath,
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "--target",
        "ES2023",
        "--module",
        "ESNext",
        "--moduleResolution",
        "Bundler",
        "--types",
        "node",
        ...contractTypecheckPaths
      ],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        shell: false
      }
    );
    const diagnostics = `${compilation.stdout}${compilation.stderr}`;

    expect(compilation.error).toBeUndefined();
    expect(compilation.status, diagnostics).toBe(0);
  });
});
