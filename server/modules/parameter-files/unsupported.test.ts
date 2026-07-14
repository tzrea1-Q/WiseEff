import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { detectUnsupportedDtsConstructs } from "./unsupported";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "dts-teaching-sample.dts");
const sample = readFileSync(fixturePath, "utf8");

describe("detectUnsupportedDtsConstructs", () => {
  it("detects the six unsupported construct codes in the teaching sample", () => {
    const findings = detectUnsupportedDtsConstructs(sample);
    const codes = findings.map((f) => f.code);

    expect(codes).toContain("include");
    expect(codes).toContain("unit-address-node");
    expect(codes).toContain("overlay-ref");
    expect(codes).toContain("inline-label");
    expect(codes).toContain("boolean-property");
    expect(codes).toContain("multi-cell-group");
  });

  it("returns structured warnings with message and sample, deduped by code", () => {
    const findings = detectUnsupportedDtsConstructs(sample);
    expect(findings.length).toBeGreaterThan(0);

    for (const finding of findings) {
      expect(finding).toMatchObject({
        code: expect.any(String),
        message: expect.any(String),
        sample: expect.any(String),
      });
      expect(finding.sample.length).toBeGreaterThan(0);
    }

    const codes = findings.map((f) => f.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
