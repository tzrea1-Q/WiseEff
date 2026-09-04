import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { THREAT_MATRIX } from "./threatMatrix";

const reportDir = path.dirname(fileURLToPath(import.meta.url));

const productionSources = async (): Promise<readonly { name: string; source: string }[]> => {
  const entries = (await fs.readdir(reportDir)).filter(
    (name) => name.endsWith(".ts") && !name.includes(".test."),
  );
  return Promise.all(
    entries.map(async (name) => ({
      name,
      source: await fs.readFile(path.join(reportDir, name), "utf8"),
    })),
  );
};

describe("S10-RPT threat matrix", () => {
  it("freezes the eight R3 observations before production report assembly", () => {
    expect(THREAT_MATRIX).toHaveLength(8);
    expect(Object.isFrozen(THREAT_MATRIX)).toBe(true);
    expect(THREAT_MATRIX.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(THREAT_MATRIX.map((row) => row.name)).toEqual([
      "wrong-purpose-predecessor",
      "self-approval-or-verifier-as-approval",
      "pre-pin-runtime-projection",
      "nondeterministic-digest",
      "read-report-missing-or-unapproved-tagged-absence",
      "public-release-missing-predecessor-digest",
      "retention-closed-expired-not-present",
      "assemble-cannot-execute-gates-or-broaden-applicability",
    ]);
  });

  it("does not execute gates, broaden applicability, or put Date.now in canonical bytes", async () => {
    const files = await productionSources();
    expect(files.length).toBeGreaterThan(0);
    for (const { name, source } of files) {
      expect(source, name).not.toMatch(/\brunVerification\s*\(/);
      expect(source, name).not.toMatch(/\bprepareVerification\s*\(/);
      expect(source, name).not.toMatch(/\bpurposeProfile\s*\(/);
      expect(source, name).not.toMatch(/\bexecuteProfile\s*\(/);
      if (name === "digest.ts") {
        expect(source, name).not.toMatch(/Date\.now/);
        expect(source, name).not.toMatch(/new Date\(/);
      }
      if (name === "runtimePin.ts") {
        expect(source, name).not.toMatch(/\bassembleReport\s*\(/);
        expect(source, name).not.toMatch(/\bapproveReport\s*\(/);
      }
    }
  });
});
