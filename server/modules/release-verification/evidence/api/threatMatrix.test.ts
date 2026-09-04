import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { apiVerificationGateIds } from "../../core/gateRegistry";
import { THREAT_MATRIX } from "./threatMatrix";

const apiDir = path.dirname(fileURLToPath(import.meta.url));

describe("S10-API threat matrix", () => {
  it("freezes the twelve R3 observations before production adapters", () => {
    expect(THREAT_MATRIX).toHaveLength(12);
    expect(Object.isFrozen(THREAT_MATRIX)).toBe(true);
    expect(THREAT_MATRIX.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(THREAT_MATRIX.map((row) => row.name)).toEqual([
      "mock-runtime-rejected",
      "stale-pin-rejected",
      "missing-request-id-rejected",
      "twelve-gates-same-candidate-pin",
      "authorization-negatives-captured",
      "audit-refs-bound-to-request",
      "never-starts-runtime-or-selects-gates",
      "not-yet-executable-before-isolated",
      "catalog-release-etag-deprecation-headers",
      "pcat-api-11-nine-kernel-routes",
      "pcat-api-12-canonical-binding-identity",
      "production-handlers-not-reimplemented",
    ]);
    expect([...apiVerificationGateIds]).toEqual([
      "PCAT-API-01",
      "PCAT-API-02",
      "PCAT-API-03",
      "PCAT-API-04",
      "PCAT-API-05",
      "PCAT-API-06",
      "PCAT-API-07",
      "PCAT-API-08",
      "PCAT-API-09",
      "PCAT-API-10",
      "PCAT-API-11",
      "PCAT-API-12",
    ]);
  });

  it("does not reimplement S10-PER operations or start the product runtime", async () => {
    const entries = (await fs.readdir(apiDir)).filter(
      (name) => name.endsWith(".ts") && !name.includes(".test."),
    );
    expect(entries.length).toBeGreaterThan(0);
    for (const name of entries) {
      const source = await fs.readFile(path.join(apiDir, name), "utf8");
      expect(source, name).not.toMatch(/\bprepareVerification\s*\(/);
      expect(source, name).not.toMatch(/\brunVerification\s*\(/);
      expect(source, name).not.toMatch(/\bassembleReport\s*\(/);
      expect(source, name).not.toMatch(/\bapproveReport\s*\(/);
      expect(source, name).not.toMatch(/\breadReport\s*\(/);
      expect(source, name).not.toMatch(/\bspawn\s*\(/);
      expect(source, name).not.toContain("npm run dev");
      expect(source, name).not.toContain("npm run dev:api");
    }
  });
});
