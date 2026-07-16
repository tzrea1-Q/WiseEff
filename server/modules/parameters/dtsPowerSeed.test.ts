import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { resolveDts } from "../dts";
import {
  buildDtsPowerSeed,
  DTS_POWER_SEED_FILE_NAME,
  type DtsPowerSeedParameter
} from "../../../scripts/dts-power-seed";

const root = path.dirname(path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url)))));
const baseSource = await readFile(path.join(root, "src/config/dts-seed/base-power-overlay.dts"), "utf8");

function bySource(parameters: DtsPowerSeedParameter[], sourceNodePath: string) {
  const hit = parameters.find((parameter) => parameter.sourceNodePath === sourceNodePath);
  expect(hit, `missing seed parameter ${sourceNodePath}`).toBeDefined();
  return hit!;
}

describe("DTS power seed catalog", () => {
  it("keeps property key, driver, instance and locator separate", () => {
    const seed = buildDtsPowerSeed(baseSource);
    const item = bySource(seed.parameterLibrary, "amba/i2c@FDF5E000/sc8562@6E/gpio_int");
    expect(item.name).toBe("gpio_int");
    expect(item.driverModule).toBe("sc8562");
    expect(item.instanceName).toBe("sc8562@6E");
    expect(item.nodeLocator).toBe("amba/i2c@FDF5E000/sc8562@6E");
  });

  it("maps every resolved property to one source-bound parameter", () => {
    const seed = buildDtsPowerSeed(baseSource);
    const resolved = resolveDts(baseSource);
    const resolvedPropertyCount = resolved.nodes.reduce((count, node) => count + node.properties.length, 0);

    expect(resolvedPropertyCount).toBe(170);
    expect(seed.parameterLibrary).toHaveLength(resolvedPropertyCount);
    expect(new Set(seed.parameterLibrary.map((parameter) => parameter.id)).size).toBe(resolvedPropertyCount);
    expect(new Set(seed.parameterLibrary.map((parameter) => parameter.sourceNodePath)).size).toBe(
      resolvedPropertyCount
    );

    for (const parameter of seed.parameterLibrary) {
      expect(parameter.sourceFileName).toBe(DTS_POWER_SEED_FILE_NAME);
      expect(Object.keys(parameter.values).sort()).toEqual(["atlas", "aurora", "nebula"]);
      expect(parameter.description.length).toBeGreaterThan(6);
      expect(parameter.explanation).toContain(parameter.sourceNodePath);
      expect(parameter.configFormat).toContain("DTS");
    }
  });

  it("preserves difficult DTS identities and typed values", () => {
    const seed = buildDtsPowerSeed(baseSource);

    expect(bySource(seed.parameterLibrary, "huawei_batt_info/battery_checker@0/matchable").valueKind).toBe(
      "complex"
    );
    expect(bySource(seed.parameterLibrary, "huawei_batt_info/battery_checker@1/matchable").id).not.toBe(
      bySource(seed.parameterLibrary, "huawei_batt_info/battery_checker@0/matchable").id
    );
    expect(bySource(seed.parameterLibrary, "amba/i2c@FF24E000/hl7603@75/compatible")).toMatchObject({
      name: "compatible",
      driverModule: "huawei,bypass_bst_hl7603",
      instanceName: "hl7603@75",
      nodeLocator: "amba/i2c@FF24E000/hl7603@75"
    });
    expect(bySource(seed.parameterLibrary, "huawei_charger/weak_source_sleep_enabled").values.aurora)
      .toMatchObject({ currentValue: "true", recommendedValue: "true" });
    expect(bySource(seed.parameterLibrary, "wireless_charger/sc_err_tx").configFormat).toContain("bytes");
    expect(bySource(seed.parameterLibrary, "hisi_bci_battery/vth_correct_para_low_temp").valueKind).toBe(
      "complex"
    );
  });

  it("creates three structurally identical, intentionally differentiated project files", async () => {
    const seed = buildDtsPowerSeed(baseSource);
    const identitiesByProject = seed.projectFiles.map((file) => {
      const resolved = resolveDts(file.source);
      return resolved.nodes.flatMap((node) =>
        node.properties.map((property) => `${node.nodePath ? `${node.nodePath}/` : ""}${property.name}`)
      );
    });

    expect(seed.projectFiles.map((file) => file.projectId)).toEqual(["aurora", "nebula", "atlas"]);
    expect(seed.projectFiles.every((file) => file.fileName === DTS_POWER_SEED_FILE_NAME)).toBe(true);
    expect(await readFile(path.join(root, "src/config/dts-seed/wiseeff-power-base.dts"), "utf8")).toContain(
      "gpio-controller"
    );
    expect(identitiesByProject[1]).toEqual(identitiesByProject[0]);
    expect(identitiesByProject[2]).toEqual(identitiesByProject[0]);

    expect(bySource(seed.parameterLibrary, "board_id").values).toMatchObject({
      aurora: { currentValue: "<12345>" },
      nebula: { currentValue: "<12346>" },
      atlas: { currentValue: "<12347>" }
    });
    expect(bySource(seed.parameterLibrary, "charging_core/ichg_max").values).toMatchObject({
      aurora: { currentValue: "<2500>" },
      nebula: { currentValue: "<3000>" },
      atlas: { currentValue: "<2100>" }
    });
    expect(bySource(seed.parameterLibrary, "wireless_charger/pmax").values).toMatchObject({
      aurora: { currentValue: "<25>" },
      nebula: { currentValue: "<40>" },
      atlas: { currentValue: "<15>" }
    });

    const differentiated = seed.parameterLibrary.filter((parameter) => {
      const values = Object.values(parameter.values).map((value) => value.currentValue);
      return new Set(values).size > 1;
    });
    expect(differentiated.length).toBeGreaterThanOrEqual(15);
  });

  it("infers useful units, ranges, risks, and business categories", () => {
    const seed = buildDtsPowerSeed(baseSource);

    expect(bySource(seed.parameterLibrary, "amba/i2c@FDF5E000/sc8562@6E/vout_ovp_mv")).toMatchObject({
      unit: "mV",
      risk: "High",
      businessCategory: "Charge Pump IC"
    });
    expect(bySource(seed.parameterLibrary, "charging_core/iin_max")).toMatchObject({
      unit: "mA",
      range: "0 - 12000",
      risk: "High",
      businessCategory: "Charging Policy"
    });
    expect(bySource(seed.parameterLibrary, "hisi_bci_battery/battery_design_fcc")).toMatchObject({
      unit: "mAh",
      risk: "High",
      businessCategory: "Battery Gauge"
    });
    expect(bySource(seed.parameterLibrary, "battery_ocv/ocv_table")).toMatchObject({
      unit: "mV table",
      valueKind: "complex",
      businessCategory: "Battery Gauge"
    });
  });

  it("keeps committed project DTS artifacts in sync with the generator", async () => {
    const seed = buildDtsPowerSeed(baseSource);
    for (const projectFile of seed.projectFiles) {
      expect(
        await readFile(path.join(root, "src/config/dts-seed", projectFile.artifactFileName), "utf8")
      ).toBe(projectFile.source);
    }
  });
});
