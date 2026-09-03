import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { POSTGRES_FAILURE_CODES, POSTGRES_GATE_IDS } from "./adapters";
import { THREAT_MATRIX } from "./threatMatrix";

const postgresDir = path.dirname(fileURLToPath(import.meta.url));
const FORBIDDEN_TOKEN = ["parameter", "definitions"].join("_");

describe("S10-VMP threat matrix", () => {
  it("freezes the twelve R3 observations before production adapters", () => {
    expect(THREAT_MATRIX).toHaveLength(12);
    expect(Object.isFrozen(THREAT_MATRIX)).toBe(true);
    expect(THREAT_MATRIX.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(THREAT_MATRIX.map((row) => row.name)).toEqual([
      "v01-false-zero-duplicate-current-definition",
      "run-never-skipped-or-waived",
      "p01-sqlstate-catalog-immutability",
      "p02-sqlstate-legacy-writer",
      "gate-does-not-repair",
      "v17-mode-result-mismatch",
      "m01-package-inventory-drift",
      "m02-applied-file-missing",
      "missing-cutover-producer-does-not-skip",
      "v12-materialization-pin-mismatch",
      "privilege-grant-bypass-detected",
      "production-source-omits-legacy-identity-token",
    ]);
  });

  it("owns the frozen V/M/P gate and failure ID family", () => {
    expect([...POSTGRES_GATE_IDS]).toEqual([
      "PCAT-DB-V01",
      "PCAT-DB-V02",
      "PCAT-DB-V03",
      "PCAT-DB-V04",
      "PCAT-DB-V05",
      "PCAT-DB-V06",
      "PCAT-DB-V07",
      "PCAT-DB-V08",
      "PCAT-DB-V09",
      "PCAT-DB-V10",
      "PCAT-DB-V11",
      "PCAT-DB-V12",
      "PCAT-DB-V13",
      "PCAT-DB-V14",
      "PCAT-DB-V15",
      "PCAT-DB-V16",
      "PCAT-DB-V17",
      "PCAT-DB-M01",
      "PCAT-DB-M02",
      "PCAT-DB-M03",
      "PCAT-DB-M04",
      "PCAT-DB-P01",
      "PCAT-DB-P02",
    ]);
    expect([...POSTGRES_FAILURE_CODES]).toEqual([
      "PCAT-VRF-V01-DUPLICATE-CURRENT-DEFINITION",
      "PCAT-VRF-V02-CURRENT-REVISION-CARDINALITY",
      "PCAT-VRF-V03-OWNER-SCOPE-MISMATCH",
      "PCAT-VRF-V04-SUBJECT-MEMBERSHIP-MISSING",
      "PCAT-VRF-V05-PLACEMENT-CARDINALITY",
      "PCAT-VRF-V06-BINDING-DEFINITION-MISMATCH",
      "PCAT-VRF-V07-PROJECT-VALUE-REVISION-MISMATCH",
      "PCAT-VRF-V08-PROTECTED-ID-UNMAPPED",
      "PCAT-VRF-V09-SOURCE-CONSERVATION",
      "PCAT-VRF-V10-R6-R8-IDENTITY-MERGE",
      "PCAT-VRF-V11-ARCHIVE-INTEGRITY",
      "PCAT-VRF-V12-CATALOG-MATERIALIZATION-DRIFT",
      "PCAT-VRF-V13-LEGACY-WRITER-REACHABLE",
      "PCAT-VRF-V14-BINDING-TIP-CONSERVATION",
      "PCAT-VRF-V15-AUDIT-CONTINUITY",
      "PCAT-VRF-V16-ORGANIZATION-STRUCTURAL-CATALOG",
      "PCAT-VRF-V17-MODE-RESULT-MISMATCH",
      "PCAT-MIG-PACKAGE-INVENTORY-DRIFT",
      "PCAT-MIG-APPLIED-FILE-MISSING",
      "PCAT-MIG-HISTORICAL-ALIAS-INVALID",
      "PCAT-SCHEMA-MIGRATION-RESULT-MISMATCH",
      "PCAT-PRIV-CATALOG-IMMUTABILITY-BYPASS",
      "PCAT-PRIV-LEGACY-WRITER-BYPASS",
    ]);
  });

  it("omits the forbidden identity token and write statements from production adapters", async () => {
    const entries = (await fs.readdir(postgresDir)).filter(
      (name) => name.endsWith(".ts") && !name.includes(".test."),
    );
    expect(entries.length).toBeGreaterThan(0);
    for (const name of entries) {
      const source = await fs.readFile(path.join(postgresDir, name), "utf8");
      expect(source.includes(FORBIDDEN_TOKEN), name).toBe(false);
      if (name !== "privilegeGates.ts") {
        expect(source, name).not.toMatch(/\binsert into\b/i);
        expect(source, name).not.toMatch(/\bdelete from\b/i);
      }
    }
  });
});
