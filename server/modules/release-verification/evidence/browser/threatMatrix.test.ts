import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { browserVerificationGateIds } from "../../core/gateRegistry";
import { THREAT_MATRIX } from "./threatMatrix";

const browserDir = path.dirname(fileURLToPath(import.meta.url));

describe("S10-UI threat matrix", () => {
  it("freezes the twelve R3 observations before production adapters", () => {
    expect(THREAT_MATRIX).toHaveLength(12);
    expect(Object.isFrozen(THREAT_MATRIX)).toBe(true);
    expect(THREAT_MATRIX.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(THREAT_MATRIX.map((row) => row.name)).toEqual([
      "mock-runtime-rejected",
      "stale-pin-rejected",
      "screenshot-only-rejected",
      "pre-p13-rejected",
      "redaction-failed-rejected",
      "fifteen-gates-three-viewports-same-candidate-pin",
      "never-executes-ui-or-selects-gates",
      "not-yet-executable-before-isolated",
      "candidate-api-identity-bound",
      "console-and-network-diagnostics-required",
      "catalog-page-b-unclaimed",
      "production-handlers-not-reimplemented",
    ]);
    expect([...browserVerificationGateIds]).toEqual([
      "PCAT-UI-01",
      "PCAT-UI-02",
      "PCAT-UI-03",
      "PCAT-UI-04",
      "PCAT-UI-05",
      "PCAT-UI-06",
      "PCAT-UI-07",
      "PCAT-UI-08",
      "PCAT-UI-09",
      "PCAT-UI-10",
      "PCAT-UI-11",
      "PCAT-UI-12",
      "PCAT-UI-13",
      "PCAT-UI-14",
      "PCAT-UI-15",
    ]);
    expect(THREAT_MATRIX[10]?.evidenceOwner).toBe("B later");
  });

  it("does not reimplement S10-PER operations, start the product UI, or claim Catalog-page B", async () => {
    const entries = (await fs.readdir(browserDir)).filter(
      (name) => name.endsWith(".ts") && !name.includes(".test."),
    );
    expect(entries.length).toBeGreaterThan(0);
    for (const name of entries) {
      const source = await fs.readFile(path.join(browserDir, name), "utf8");
      expect(source, name).not.toMatch(/\bprepareVerification\s*\(/);
      expect(source, name).not.toMatch(/\brunVerification\s*\(/);
      expect(source, name).not.toMatch(/\bassembleReport\s*\(/);
      expect(source, name).not.toMatch(/\bapproveReport\s*\(/);
      expect(source, name).not.toMatch(/\breadReport\s*\(/);
      expect(source, name).not.toMatch(/\bspawn\s*\(/);
      expect(source, name).not.toContain("npm run dev");
      expect(source, name).not.toContain("npm run dev:api");
      expect(source, name).not.toMatch(/from ["']playwright/);
      expect(source, name).not.toMatch(/\bpage\.goto\b/);
      expect(source, name).not.toMatch(/\bcatalogPageMounted:\s*true\b/);
    }
  });
});
