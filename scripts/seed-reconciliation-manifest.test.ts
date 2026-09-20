/**
 * Issue #849 decision 7 / decision 10 acceptance tests.
 *
 * The expected compatibility values below are hardcoded from src/config/power-management.json on
 * purpose: they are an independent oracle, so the manifest cannot satisfy the test by echoing
 * whatever it happens to read.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

import { inventoryVendorCatalog } from "../server/modules/catalog-publication/import/vendorYaml";
import { resolveDts } from "../server/modules/dts/resolver";
import { isStructuralPropertyKey } from "../src/domain/parameter-topology/parameterSurface";
import {
  SEED_RECONCILIATION_MANIFEST_PATH,
  SEED_RECONCILIATION_REPORT_PATH,
  buildSeedReconciliation,
  checkSeedReconciliation,
} from "./lib/seedReconciliation";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = buildSeedReconciliation(rootDir);
const { manifest } = artifacts;

type ProjectValues = { readonly current: string; readonly recommended: string };

type ExpectedCompatItem = {
  readonly index: number;
  readonly id: string;
  readonly propertyKey: string;
  readonly formatFamily: string;
  readonly configFormat: string;
  readonly scope: "current" | "deferred";
  readonly values: Readonly<Record<"atlas" | "aurora" | "nebula", ProjectValues>>;
};

const JSON_CV_LIMIT = 'JSON: { "charger.cv.limitMv": number }';
const JSON_TEMP_TARGET = 'JSON: { "battery.thermal.targetTempC": number }';

const FAST_CHARGE_PROFILE_MATRIX_VALUE =
  'fast-charge-profile-matrix =\n  "0", "5000", "1500", "40", "entry",\n  "1", "9000", "3000", "43", "balanced",\n  "2", "11000", "4200", "46", "burst";';
const FAST_CHARGE_PROFILE_MATRIX_NEBULA_VALUE =
  'fast-charge-profile-matrix =\n  "0", "5000", "1500", "40", "entry",\n  "1", "9000", "3000", "43", "balanced",\n  "2", "12000", "4300", "48", "boost";';
const FAST_CHARGE_PROFILE_MATRIX_FORMAT =
  'DTS: fast-charge-profile-matrix =\n  "profile-id", "vbus-mv", "ibus-ma", "temp-c", "note",\n  "0", "5000", "1500", "40", "entry",\n  "1", "9000", "3000", "43", "balanced",\n  "2", "11000", "4200", "46", "burst";';
const DERATE_CURVE_VALUE =
  "battery-thermal-derate-curve = <\n  0 38 3800 4350\n  1 42 3200 4320\n  2 45 2600 4280\n>;";
const DERATE_CURVE_NEBULA_VALUE =
  "battery-thermal-derate-curve = <\n  0 38 3800 4350\n  1 42 3000 4300\n  2 45 2400 4260\n>;";

const EXPECTED_COMPATIBILITY: readonly ExpectedCompatItem[] = [
  {
    index: 0,
    id: "fast-charge-current",
    propertyKey: "fast_charge_current_limit_ma",
    formatFamily: "YAML",
    configFormat: "YAML: power.charge.fast_current_limit_ma: number",
    scope: "deferred",
    values: {
      aurora: { current: "3850", recommended: "3200" },
      nebula: { current: "4200", recommended: "3900" },
      atlas: { current: "3000", recommended: "3100" },
    },
  },
  {
    index: 1,
    id: "charge-voltage-limit",
    propertyKey: "charger.cv.limitMv",
    formatFamily: "JSON",
    configFormat: JSON_CV_LIMIT,
    scope: "current",
    values: {
      aurora: { current: "4350", recommended: "4320" },
      nebula: { current: "4380", recommended: "4340" },
      atlas: { current: "4300", recommended: "4310" },
    },
  },
  {
    index: 2,
    id: "battery-temp-target",
    propertyKey: "battery.thermal.targetTempC",
    formatFamily: "JSON",
    configFormat: JSON_TEMP_TARGET,
    scope: "current",
    values: {
      aurora: { current: "38", recommended: "35" },
      nebula: { current: "40", recommended: "37" },
      atlas: { current: "36", recommended: "35" },
    },
  },
  {
    index: 3,
    id: "soc-smoothing",
    propertyKey: "soc_estimation_smoothing",
    formatFamily: "TOML",
    configFormat: "TOML: [battery.soc] smoothing = decimal",
    scope: "deferred",
    values: {
      aurora: { current: "0.82", recommended: "0.88" },
      nebula: { current: "0.76", recommended: "0.84" },
      atlas: { current: "0.90", recommended: "0.88" },
    },
  },
  {
    index: 4,
    id: "battery-health-reserve",
    propertyKey: "battery_health_reserve_pct",
    formatFamily: "ENV",
    configFormat: "ENV: BATTERY_HEALTH_RESERVE_PCT=number",
    scope: "deferred",
    values: {
      aurora: { current: "12", recommended: "14" },
      nebula: { current: "10", recommended: "13" },
      atlas: { current: "15", recommended: "14" },
    },
  },
  {
    index: 5,
    id: "usb-pd-profile",
    propertyKey: "usb_pd_profile_limit_w",
    formatFamily: "ENV",
    configFormat: "ENV: POWER_USB_PD_PROFILE_LIMIT_W=number",
    scope: "deferred",
    values: {
      aurora: { current: "33", recommended: "33" },
      nebula: { current: "30", recommended: "33" },
      atlas: { current: "25", recommended: "27" },
    },
  },
  {
    index: 6,
    id: "wireless-thermal-derate",
    propertyKey: "wireless_charge_thermal_derate_pct",
    formatFamily: "YAML",
    configFormat: "YAML: power.wireless.thermal_derate_pct: number",
    scope: "deferred",
    values: {
      aurora: { current: "18", recommended: "24" },
      nebula: { current: "22", recommended: "26" },
      atlas: { current: "16", recommended: "20" },
    },
  },
  {
    index: 7,
    id: "low-battery-shutdown",
    propertyKey: "low_battery_shutdown_soc",
    formatFamily: "TOML",
    configFormat: "TOML: [battery.protection] shutdown_soc = decimal",
    scope: "deferred",
    values: {
      aurora: { current: "3.2", recommended: "3.0" },
      nebula: { current: "2.5", recommended: "3.0" },
      atlas: { current: "3.8", recommended: "3.5" },
    },
  },
  {
    index: 8,
    id: "pmic-boost-voltage",
    propertyKey: "pmic_boost_voltage_mv",
    formatFamily: "ENV",
    configFormat: "ENV: PMIC_BOOST_VOLTAGE_MV=number",
    scope: "deferred",
    values: {
      aurora: { current: "5200", recommended: "5100" },
      nebula: { current: "5450", recommended: "5300" },
      atlas: { current: "5000", recommended: "5000" },
    },
  },
  {
    index: 9,
    id: "dts-fast-charge-profile-matrix",
    propertyKey: "fast-charge-profile-matrix",
    formatFamily: "DTS",
    configFormat: FAST_CHARGE_PROFILE_MATRIX_FORMAT,
    scope: "current",
    values: {
      aurora: { current: FAST_CHARGE_PROFILE_MATRIX_VALUE, recommended: FAST_CHARGE_PROFILE_MATRIX_VALUE },
      nebula: { current: FAST_CHARGE_PROFILE_MATRIX_NEBULA_VALUE, recommended: FAST_CHARGE_PROFILE_MATRIX_NEBULA_VALUE },
      atlas: { current: FAST_CHARGE_PROFILE_MATRIX_VALUE, recommended: FAST_CHARGE_PROFILE_MATRIX_VALUE },
    },
  },
  {
    index: 10,
    id: "dts-battery-thermal-derate-curve",
    propertyKey: "battery-thermal-derate-curve",
    formatFamily: "DTS",
    configFormat: `DTS: ${DERATE_CURVE_VALUE}`,
    scope: "current",
    values: {
      aurora: { current: DERATE_CURVE_VALUE, recommended: DERATE_CURVE_VALUE },
      nebula: { current: DERATE_CURVE_NEBULA_VALUE, recommended: DERATE_CURVE_NEBULA_VALUE },
      atlas: { current: DERATE_CURVE_VALUE, recommended: DERATE_CURVE_VALUE },
    },
  },
  {
    index: 11,
    id: "standby-drain-limit",
    propertyKey: "standby_drain_limit_ma",
    formatFamily: "TOML",
    configFormat: "TOML: [power.standby] drain_limit_ma = number",
    scope: "deferred",
    values: {
      aurora: { current: "18", recommended: "15" },
      nebula: { current: "28", recommended: "22" },
      atlas: { current: "14", recommended: "14" },
    },
  },
];

const uuid = () => Math.random().toString(36).slice(2);

describe("seed reconciliation manifest", () => {
  it("records exactly 127 inputs: 115 vendor + 12 compatibility, 119 current + 8 deferred", () => {
    expect(manifest.inputs).toHaveLength(127);
    expect(manifest.inputs.filter((entry) => entry.family === "vendor")).toHaveLength(115);
    expect(manifest.inputs.filter((entry) => entry.family === "compatibility")).toHaveLength(12);
    expect(manifest.inputs.filter((entry) => entry.scope === "current")).toHaveLength(119);
    expect(manifest.inputs.filter((entry) => entry.scope === "deferred")).toHaveLength(8);

    expect(manifest.summary).toMatchObject({
      totalInputs: 127,
      vendorInputs: 115,
      compatibilityInputs: 12,
      currentInputs: 119,
      deferredInputs: 8,
    });
    // 115 vendor + 4 current compatibility = 119 current.
    expect(
      manifest.inputs.filter((entry) => entry.family === "vendor" && entry.scope === "current"),
    ).toHaveLength(115);
    expect(
      manifest.inputs.filter((entry) => entry.family === "compatibility" && entry.scope === "current"),
    ).toHaveLength(4);
  });

  it("carries all 12 compatibility items with exact identity, format and per-project values", () => {
    expect(EXPECTED_COMPATIBILITY).toHaveLength(12);
    for (const expected of EXPECTED_COMPATIBILITY) {
      const entry = manifest.inputs.find((candidate) => candidate.sourceLocator === `/parameterLibrary/${expected.index}`);
      expect(entry, `missing ${expected.id}`).toBeDefined();
      expect(entry!.family).toBe("compatibility");
      expect(entry!.sourcePath).toBe("src/config/power-management.json");
      expect(entry!.oldIdentity).toEqual({ kind: "power-management-id", value: expected.id });
      expect(entry!.propertyKey).toBe(expected.propertyKey);
      expect(entry!.formatFamily).toBe(expected.formatFamily);
      expect(entry!.metadata?.module).toBeDefined();
      expect((entry!.content as Record<string, unknown>).configFormat).toBe(expected.configFormat);
      expect(entry!.scope).toBe(expected.scope);

      for (const projectId of ["atlas", "aurora", "nebula"] as const) {
        const values = (entry!.projectValues ?? {}) as Record<string, Record<string, unknown>>;
        expect(values[projectId]?.currentValue, `${expected.id}/${projectId}/current`).toBe(
          expected.values[projectId].current,
        );
        expect(values[projectId]?.recommendedValue, `${expected.id}/${projectId}/recommended`).toBe(
          expected.values[projectId].recommended,
        );
      }
    }
  });

  it("gives every current-scope item a disposition and reason", () => {
    const vocabulary = new Set(["preserve", "transform", "merge", "exclude"]);
    const current = manifest.inputs.filter((entry) => entry.scope === "current");
    expect(current).toHaveLength(119);
    for (const entry of current) {
      expect(vocabulary.has(entry.disposition), `${entry.inputId} disposition=${entry.disposition}`).toBe(true);
      expect(entry.reason.trim().length, `${entry.inputId} reason`).toBeGreaterThan(0);
      expect(entry.definitionId).toMatch(/^seeddef_[0-9a-f]{16}$/u);
    }
  });

  it("defers the 8 YAML/TOML/ENV compatibility items to TD-124 with original metadata and values", () => {
    const deferred = manifest.inputs.filter((entry) => entry.scope === "deferred");
    expect(deferred).toHaveLength(8);
    const expectedDeferred = EXPECTED_COMPATIBILITY.filter((item) => item.scope === "deferred");
    expect(expectedDeferred).toHaveLength(8);

    for (const entry of deferred) {
      expect(entry.disposition).toBe("defer");
      expect(entry.deferredTo).toBe("TD-124");
      expect(entry.reason.trim().length).toBeGreaterThan(0);
      const expected = expectedDeferred.find((item) => item.id === entry.oldIdentity?.value);
      expect(expected, `unexpected deferred id ${entry.oldIdentity?.value}`).toBeDefined();

      // Original metadata retained.
      expect(entry.metadata).toBeDefined();
      for (const field of ["module", "description", "explanation", "range", "unit", "risk", "valueKind"] as const) {
        expect(typeof entry.metadata?.[field], `${expected!.id} metadata.${field}`).toBe("string");
        expect((entry.metadata?.[field] as string).length).toBeGreaterThan(0);
      }
      // Original project values retained, and relative display labels are not timestamps.
      for (const projectId of ["atlas", "aurora", "nebula"] as const) {
        const values = (entry.projectValues ?? {}) as Record<string, Record<string, unknown>>;
        expect(values[projectId]?.currentValue).toBe(expected!.values[projectId].current);
        expect(values[projectId]?.recommendedValue).toBe(expected!.values[projectId].recommended);
        expect(values[projectId]).not.toHaveProperty("updatedAt");
      }
    }
  });

  it("has zero unexplained omissions across vendor inventory and board business occurrences", () => {
    const inventory = inventoryVendorCatalog(path.join(rootDir, "schemas/dts"));
    expect(inventory.ok).toBe(true);
    if (!inventory.ok) return;

    const rawLocators = new Set<string>();
    for (const file of inventory.value.files.filter((entry) => entry.disposition === "input")) {
      const document = parseYaml(readFileSync(path.join(rootDir, "schemas/dts", file.relativePath), "utf8")) as {
        properties?: Record<string, unknown>;
      };
      for (const propertyKey of Object.keys(document.properties ?? {})) {
        rawLocators.add(`${file.relativePath}#${propertyKey}`);
      }
    }
    expect(rawLocators.size).toBe(137);

    const recordedLocators = new Set<string>();
    for (const entry of manifest.inputs.filter((candidate) => candidate.family === "vendor")) {
      recordedLocators.add(entry.sourceLocator);
    }
    for (const entry of manifest.excludedStructuralInputs) {
      recordedLocators.add(String(entry.sourceLocator));
    }
    expect(recordedLocators.size).toBe(137);
    expect([...rawLocators].every((locator) => recordedLocators.has(locator))).toBe(true);
    expect([...recordedLocators].every((locator) => rawLocators.has(locator))).toBe(true);

    // Compatibility items recorded exactly once.
    expect(new Set(manifest.inputs.map((entry) => entry.inputId)).size).toBe(manifest.inputs.length);
    expect(
      manifest.inputs.filter((entry) => entry.family === "compatibility").map((entry) => entry.sourceLocator).sort(),
    ).toEqual(EXPECTED_COMPATIBILITY.map((item) => `/parameterLibrary/${item.index}`).sort());

    // Every board business occurrence appears exactly once, and nothing extra is recorded.
    for (const board of ["aurora", "nebula", "atlas"] as const) {
      const source = readFileSync(path.join(rootDir, `src/config/dts-seed/${board}-board.dts`), "utf8");
      const businessLocators = new Set<string>();
      const allResolvedLocators = new Set<string>();
      for (const node of resolveDts(source).nodes) {
        for (const property of node.properties) {
          const locator = `${node.nodePath}#${property.name}`;
          allResolvedLocators.add(locator);
          if (!isStructuralPropertyKey(property.name)) businessLocators.add(locator);
        }
      }
      expect(businessLocators.size).toBe(120);
      const recorded = manifest.boardOccurrences.filter((entry) => entry.board === board);
      const recordedBusiness = recorded.filter((entry) => entry.scope === "current");
      expect(recordedBusiness).toHaveLength(120);
      expect(recorded).toHaveLength(200);
      expect(new Set(recordedBusiness.map((entry) => entry.sourceLocator)).size).toBe(120);
      expect(recordedBusiness.map((entry) => entry.sourceLocator).sort()).toEqual([...businessLocators].sort());
      expect(new Set(recorded.map((entry) => entry.sourceLocator))).toEqual(allResolvedLocators);
    }

    expect(manifest.conservation).toMatchObject({
      inputsRecorded: 127,
      vendorInputsRecorded: 115,
      compatibilityInputsRecorded: 12,
      currentInputsRecorded: 119,
      deferredInputsRecorded: 8,
      vendorRawPropertyEntriesRecorded: 137,
      vendorRawEqualsCanonicalPlusStructural: true,
      boardOccurrencesRecorded: 600,
      boardBusinessOccurrencesRecorded: 360,
      boardStructuralOccurrencesRecorded: 240,
      everyInputRecordedExactlyOnce: true,
      everyBoardBusinessOccurrenceRecordedExactlyOnce: true,
    });
  });


  it("gives every current-scope compatibility item a reviewed real source with exact locators and digests", () => {
    const expected: Record<string, { format: string; locator: string; subjectSelection: string }> = {
      "charger.cv.limitMv": {
        format: "json",
        locator: "/charger.cv.limitMv",
        subjectSelection: "configuration-schema:wiseeff.power-config",
      },
      "battery.thermal.targetTempC": {
        format: "json",
        locator: "/battery.thermal.targetTempC",
        subjectSelection: "configuration-schema:wiseeff.power-config",
      },
      "fast-charge-profile-matrix": {
        format: "dts",
        locator: "wiseeff_node_type_demo/charging_core/fast-charge-profile-matrix",
        subjectSelection: "node-type:charging_core",
      },
      "battery-thermal-derate-curve": {
        format: "dts",
        locator: "wiseeff_node_type_demo/charging_core/battery-thermal-derate-curve",
        subjectSelection: "node-type:charging_core",
      },
    };
    const current = manifest.inputs.filter(
      (entry) => entry.family === "compatibility" && entry.scope === "current",
    );
    expect(current).toHaveLength(4);

    for (const entry of current) {
      const spec = expected[entry.propertyKey];
      expect(spec, `unexpected current compatibility item ${entry.propertyKey}`).toBeDefined();
      const realSource = entry.realSource as
        | { format: string; locator: string; subjectSelection: string; files: Array<Record<string, string>> }
        | undefined;
      expect(realSource, `${entry.propertyKey} has no reviewed real source`).toBeDefined();
      expect(realSource!.format).toBe(spec!.format);
      expect(realSource!.locator).toBe(spec!.locator);
      expect(realSource!.files).toHaveLength(3);

      for (const file of realSource!.files) {
        // The recorded digest is over the exact bytes currently on disk.
        const onDisk = readFileSync(path.join(rootDir, file.path!), "utf8");
        const digest = createHash("sha256").update(onDisk, "utf8").digest("hex");
        expect(file.digest).toBe(digest);
        expect(file.locator).toBe(spec!.locator);
        expect(typeof file.currentValue).toBe("string");
        expect(typeof file.recommendedValue).toBe("string");
      }

      expect(realSource!.subjectSelection).toBe(spec!.subjectSelection);
      if (spec!.format === "dts") {
        expect(entry.disposition).toBe("merge");
        expect(entry.formalSubject).toEqual({ kind: "nodename", value: "charging_core" });
      } else {
        expect(entry.disposition).toBe("preserve");
        expect(entry.formalSubject).toEqual({ kind: "configuration-schema", value: "wiseeff.power-config" });
      }
    }

    const sourceRoles = new Set(manifest.sources.map((source) => source.role));
    expect(sourceRoles.has("compatibility-project-source")).toBe(true);

    // Deferred items own no active source this round.
    for (const entry of manifest.inputs.filter((item) => item.disposition === "defer")) {
      expect(entry.realSource).toBeUndefined();
    }
  });

  it("maps gpio_int cells/description instead of leaving them as import blockers", () => {
    const locators = ["vendor/wiseeff/mt-mt5788.yaml#gpio_int", "vendor/wiseeff/sc8562.yaml#gpio_int"];
    expect(
      manifest.knownBlockers.filter((blocker) => locators.includes(String(blocker.sourceLocator))),
    ).toEqual([]);
    for (const locator of locators) {
      const entry = manifest.inputs.find((candidate) => candidate.sourceLocator === locator);
      expect(entry?.blocked).toBeFalsy();
      expect(entry?.disposition).not.toBe("transform");
      const constraints = entry?.content.constraints as Record<string, unknown> | undefined;
      expect(constraints?.cells).toBe(3);
      expect(constraints?.description).toBe("phandle pin flags");
    }
  });

  it("states the measured dangling-overlay-target discrepancy instead of the unreproducible 24", () => {
    const discrepancy = manifest.reconDiscrepancies.danglingOverlayTargets as {
      reproducible: boolean;
      statement: string;
      measured: { distinctUnresolvedOverlayTargetsPerBoard: number; missingReferencedLabelsPerBoard: number; labels: string[] };
    };
    expect(discrepancy.reproducible).toBe(false);
    expect(discrepancy.measured.distinctUnresolvedOverlayTargetsPerBoard).toBe(29);
    expect(discrepancy.measured.missingReferencedLabelsPerBoard).toBe(37);
    expect(discrepancy.measured.labels).toHaveLength(29);
    expect(discrepancy.statement).toContain("29");
    expect(discrepancy.statement).toContain("37");
    expect(discrepancy.statement).toContain("NOT reproducible");
  });

  it("labels the 124 / 372 binding counts as planned, not achieved", () => {
    expect(manifest.plannedInventory.perProject).toMatchObject({
      boardBusinessOccurrences: 120,
      currentCompatibilityItems: 4,
      bindings: 124,
    });
    expect(manifest.plannedInventory.threeProjects).toMatchObject({ bindings: 372 });
    expect(String(manifest.plannedInventory.status)).toContain("PLANNED");
  });

  it("is deterministic: two generations are byte-identical", () => {
    const first = buildSeedReconciliation(rootDir);
    const second = buildSeedReconciliation(rootDir);
    expect(JSON.stringify(second.manifest)).toBe(JSON.stringify(first.manifest));
    expect(second.report).toBe(first.report);
    // The checked-in artifacts are exactly the generated bytes.
    expect(readFileSync(path.join(rootDir, SEED_RECONCILIATION_MANIFEST_PATH), "utf8")).toBe(
      `${JSON.stringify(first.manifest, null, 2)}\n`,
    );
    expect(readFileSync(path.join(rootDir, SEED_RECONCILIATION_REPORT_PATH), "utf8")).toBe(first.report);
  });
});

describe("seed reconciliation drift check", () => {
  const tempDirs: string[] = [];
  const tempDir = () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), `seed-reconcile-${uuid()}-`));
    tempDirs.push(dir);
    return dir;
  };

  it("passes for the checked-in artifacts", () => {
    const result = checkSeedReconciliation({ rootDir });
    expect(result.drifts).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("fails when the manifest has drifted", () => {
    const dir = tempDir();
    const driftedManifest = path.join(dir, "manifest.json");
    const parsed = JSON.parse(readFileSync(path.join(rootDir, SEED_RECONCILIATION_MANIFEST_PATH), "utf8")) as {
      summary: Record<string, number>;
    };
    parsed.summary.totalInputs = 999;
    writeFileSync(driftedManifest, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");

    const result = checkSeedReconciliation({
      rootDir,
      manifestPath: driftedManifest,
      reportPath: path.join(rootDir, SEED_RECONCILIATION_REPORT_PATH),
    });
    expect(result.ok).toBe(false);
    expect(result.drifts.join("\n")).toContain("out of date");
  });

  it("fails when the report has drifted or an artifact is missing", () => {
    const dir = tempDir();
    const driftedReport = path.join(dir, "report.md");
    writeFileSync(driftedReport, "stale\n", "utf8");
    const reportResult = checkSeedReconciliation({
      rootDir,
      manifestPath: path.join(rootDir, SEED_RECONCILIATION_MANIFEST_PATH),
      reportPath: driftedReport,
    });
    expect(reportResult.ok).toBe(false);

    const missingResult = checkSeedReconciliation({
      rootDir,
      manifestPath: path.join(dir, "absent-manifest.json"),
      reportPath: path.join(dir, "absent-report.md"),
    });
    expect(missingResult.ok).toBe(false);
    expect(missingResult.drifts.join("\n")).toContain("missing");
  });

  it("makes the seed:reconcile:check CLI exit non-zero on a drifted temp copy", () => {
    const dir = tempDir();
    const driftedManifest = path.join(dir, "manifest.json");
    const driftedReport = path.join(dir, "report.md");
    copyFileSync(path.join(rootDir, SEED_RECONCILIATION_MANIFEST_PATH), driftedManifest);
    copyFileSync(path.join(rootDir, SEED_RECONCILIATION_REPORT_PATH), driftedReport);

    const clean = spawnSync(
      "npx",
      [
        "tsx",
        "scripts/check-seed-reconciliation-manifest.ts",
        "--manifest",
        driftedManifest,
        "--report",
        driftedReport,
      ],
      { cwd: rootDir, encoding: "utf8" },
    );
    expect(clean.status).toBe(0);

    const parsed = JSON.parse(readFileSync(driftedManifest, "utf8")) as { summary: Record<string, number> };
    parsed.summary.vendorInputs = 1;
    writeFileSync(driftedManifest, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");

    const drifted = spawnSync(
      "npx",
      [
        "tsx",
        "scripts/check-seed-reconciliation-manifest.ts",
        "--manifest",
        driftedManifest,
        "--report",
        driftedReport,
      ],
      { cwd: rootDir, encoding: "utf8" },
    );
    expect(drifted.status).toBe(1);
    expect(drifted.stderr).toContain("not current");

    for (const dirToRemove of tempDirs) rmSync(dirToRemove, { recursive: true, force: true });
  });
});
