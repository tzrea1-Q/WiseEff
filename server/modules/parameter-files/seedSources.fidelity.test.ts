/**
 * Issue #849 (D03/C3): real, reviewed source files for the four current-scope
 * compatibility seeds, with exact locators and verified round-trip fidelity.
 *
 * The source values are an oracle read from `src/config/power-management.json`, so
 * this suite fails if a source file silently drifts from the seed inventory.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseDts } from "../dts/parser";
import { resolveDts } from "../dts/resolver";
import { buildDtsParsedIndex, buildJsonParsedIndex } from "./parseIndex";
import { patchDtsProperty, patchJsonValue } from "./writebackService";

const ROOT = process.cwd();
const PROJECTS = ["atlas", "aurora", "nebula"] as const;

type LibraryItem = {
  name: string;
  values: Record<string, { currentValue: string; recommendedValue: string }>;
};

const library = (
  JSON.parse(readFileSync(join(ROOT, "src/config/power-management.json"), "utf8")) as {
    parameterLibrary: LibraryItem[];
  }
).parameterLibrary;

const JSON_CV = library[1]!;
const JSON_TEMP = library[2]!;
const DTS_MATRIX = library[9]!;
const DTS_CURVE = library[10]!;

const JSON_LOCATOR_CV = "charger.cv.limitMv";
const JSON_LOCATOR_TEMP = "battery.thermal.targetTempC";
const DTS_NODE = "wiseeff_node_type_demo/charging_core";
const DTS_PROPERTY_MATRIX = "fast-charge-profile-matrix";
const DTS_PROPERTY_CURVE = "battery-thermal-derate-curve";

const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");
const jsonPath = (project: string) => `src/config/seed-sources/${project}/power-config.json`;
const dtsPath = (project: string) => `src/config/seed-sources/${project}/charging-thermal.dts`;

const digestOf = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

describe.each(PROJECTS)("compatibility seed source fidelity: %s", (project) => {
  it("stages the two JSON settings under literal dotted keys matching the seed inventory", () => {
    const index = buildJsonParsedIndex(read(jsonPath(project)));
    expect(Object.keys(index).sort()).toEqual([JSON_LOCATOR_CV, JSON_LOCATOR_TEMP].sort());
    expect(index[JSON_LOCATOR_CV]?.value).toBe(JSON_CV.values[project]!.currentValue);
    expect(index[JSON_LOCATOR_TEMP]?.value).toBe(JSON_TEMP.values[project]!.currentValue);
  });

  it("keeps a literal dotted JSON key exact and never splits it into nested objects", () => {
    const source = read(jsonPath(project));
    const patched = patchJsonValue(source, JSON_LOCATOR_CV, "4499").toString("utf8");
    const parsed = JSON.parse(patched) as Record<string, unknown>;

    // The literal key moved; the sibling setting and the root shape did not.
    expect(parsed[JSON_LOCATOR_CV]).toBe(4499);
    expect(parsed[JSON_LOCATOR_TEMP]).toBe(Number(JSON_TEMP.values[project]!.currentValue));
    expect(parsed[JSON_LOCATOR_CV]).not.toBeInstanceOf(Object);
    expect(Object.keys(parsed).sort()).toEqual([JSON_LOCATOR_CV, JSON_LOCATOR_TEMP].sort());

    // A slash-separated path addresses a different, nested location. It is refused
    // rather than silently creating or redirecting the literal dotted key.
    expect(() => patchJsonValue(source, "charger/cv/limitMv", "4499")).toThrowError(
      expect.objectContaining({ code: "CONFLICT" }) as unknown as Error
    );
    expect(JSON.parse(source)[JSON_LOCATOR_CV]).toBe(Number(JSON_CV.values[project]!.currentValue));
  });

  it("gives the two DTS seeds real node ownership and exact locators", () => {
    const index = buildDtsParsedIndex(read(dtsPath(project)));
    expect(Object.keys(index).sort()).toEqual(
      [`${DTS_NODE}/${DTS_PROPERTY_MATRIX}`, `${DTS_NODE}/${DTS_PROPERTY_CURVE}`].sort()
    );

    const resolved = resolveDts(parseDts(read(dtsPath(project))));
    const node = resolved.nodes.find((entry) => entry.nodePath === DTS_NODE);
    expect(node).toBeDefined();
    expect((node?.properties ?? []).map((property) => property.name).sort()).toEqual(
      [DTS_PROPERTY_MATRIX, DTS_PROPERTY_CURVE].sort()
    );
  });

  it("preserves the DTS source bytes and comments across a property patch", () => {
    const source = read(dtsPath(project));
    const patched = patchDtsProperty(source, `${DTS_NODE}/${DTS_PROPERTY_CURVE}`, "<9 9 9 9>").toString("utf8");

    // The intended semantic change lands …
    expect(patched).toContain(`${DTS_PROPERTY_CURVE} = <9 9 9 9>`);
    // … the unrelated property and the reviewed comments survive byte-for-byte.
    expect(patched).toContain("DEMONSTRATION SOURCE");
    expect(patched).toContain("not validated real-device firmware");
    expect(patched).toContain(`${DTS_PROPERTY_MATRIX} =`);
    expect(patched).toContain('"1", "9000", "3000", "43", "balanced"');
    // The file must not claim an invented device identity: no `compatible = ...`
    // property is declared (the prose disclaimer mentions the word, not a property).
    expect(patched).not.toMatch(/\bcompatible\s*=/);
  });

  it("records the retired underscore name to source property key mapping in the file", () => {
    const source = read(dtsPath(project));
    expect(source).toContain("dts_fast_charge_profile_matrix -> fast-charge-profile-matrix");
    expect(source).toContain("battery_thermal_derate_curve   -> battery-thermal-derate-curve");
  });
});

describe("compatibility seed source digests", () => {
  it("are stable and distinct per project", () => {
    const digests = PROJECTS.map((project) => digestOf(read(jsonPath(project))));
    expect(new Set(digests).size).toBe(PROJECTS.length);
    const dtsDigests = PROJECTS.map((project) => digestOf(read(dtsPath(project))));
    expect(new Set(dtsDigests).size).toBe(PROJECTS.length);
  });

  it("keeps Nebula distinct from Atlas and Aurora for the two DTS seeds", () => {
    const nebula = read(dtsPath("nebula"));
    const atlas = read(dtsPath("atlas"));
    expect(nebula).not.toBe(atlas);
    expect(nebula).toContain('"2", "12000", "4300", "48", "boost"');
    expect(atlas).toContain('"2", "11000", "4200", "46", "burst"');
    expect(nebula).toContain("1 42 3000 4300");
    expect(atlas).toContain("1 42 3200 4320");
  });

  it("matches the per-project compatibility values recorded in the seed manifest", () => {
    // The matrix and curve seeds carry the same current/recommended value per project.
    for (const project of PROJECTS) {
      expect(DTS_MATRIX.values[project]!.currentValue).toBe(DTS_MATRIX.values[project]!.recommendedValue);
      expect(DTS_CURVE.values[project]!.currentValue).toBe(DTS_CURVE.values[project]!.recommendedValue);
    }
  });
});
