import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { vendorDirectoryHash } from "../server/modules/catalog-publication/import/vendorYaml";

import { compileCatalogRelease } from "../server/modules/catalog-kernel/compiler/index";
import { validCatalogReleaseBundle } from "../server/modules/catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import {
  EXCLUDED_SCHEMA_BASENAMES,
  FIRST_ACME_RELEASE_DIGEST,
  FIRST_ACME_RELEASE_ID,
  VENDOR_SUCCESSOR_AGGREGATE_DIGEST,
  VENDOR_SUCCESSOR_RELEASE_ID,
  compileVendorCatalogSuccessor,
  compileLocalizedVendorCatalogSuccessor,
} from "./compile-vendor-catalog-release";

const firstReleaseBundle = () => {
  const full = validCatalogReleaseBundle();
  const first = full.releases[0]!;
  return {
    schemaVersion: full.schemaVersion,
    targetReleaseId: first.manifest.release.id,
    releases: [first],
  };
};

describe("compileVendorCatalogSuccessor", () => {
  it.each(["", null, 123])("rejects an invalid vendor displayName through the release schema: %s", (displayName) => {
    const root = mkdtempSync(path.join(os.tmpdir(), "wiseeff-vendor-display-name-"));
    cpSync("schemas/dts", path.join(root, "schemas/dts"), { recursive: true });
    const schemaPath = path.join(root, "schemas/dts/vendor/wiseeff/huawei-charging-core.yaml");
    const document = parse(readFileSync(schemaPath, "utf8"));
    document.properties.iin_max.displayName = displayName;
    writeFileSync(schemaPath, stringify(document));
    const catalogPath = path.join(root, "schemas/dts/catalog.json");
    const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
    catalog.vendorContentHash = vendorDirectoryHash(path.join(root, "schemas/dts/vendor/wiseeff"));
    writeFileSync(catalogPath, JSON.stringify(catalog));
    expect(() => compileLocalizedVendorCatalogSuccessor(root)).toThrow(/catalog-vendor-successor-invalid:invalid-release/);
  });

  it("seeds Chinese presentation content in a successor while retaining historical and semantic identities", () => {
    const result = compileLocalizedVendorCatalogSuccessor();
    const current = result.bundle.releases.at(-1)!;
    const previous = result.bundle.releases.at(-2)!;
    expect(current.manifest.release.version).toBe("1.2.1");
    const definitions = current.documents.filter((document) => document.kind === "definition");
    expect(definitions).toHaveLength(116);
    const refinedNames = {
      ic_para1: "芯片参数表 1", time_para01: "时间参数表 1", volt_para1: "电压参数表 1",
      volt_para00: "电压参数表 0", volt_para01: "电压参数表 1", rx_ploss_th0: "接收损耗阈值表 0",
      cccv_0: "CCCV 参数表 0", cccv_10_20: "10～20℃ CCCV 表", buck_cccv_0_5: "0～5℃ 降压 CCCV 表",
      sense_r_config: "采样电阻配置值", sense_r_actual: "采样电阻实际值",
      r_charger_uohm: "充电通路电阻", r_pcb: "PCB 电阻", vbat_drop_vol_mv: "电池压降保护电压",
    };
    for (const [propertyKey, displayName] of Object.entries(refinedNames)) {
      const matching = definitions.filter((document) => document.content.propertyKey === propertyKey);
      expect(matching.length).toBeGreaterThan(0);
      for (const definition of matching) expect(definition.content.revision.displayName).toBe(displayName);
    }
    const refinedDocumentation = {
      vbat_drop_vol_mv: "设置电池电压压降保护的触发电压，单位为毫伏。",
      "battery-thermal-derate-curve": "配置电池热降额曲线的整数矩阵。",
      "fast-charge-profile-matrix": "配置快充配置的字符串矩阵。",
    };
    for (const [propertyKey, documentation] of Object.entries(refinedDocumentation)) {
      const matching = definitions.filter((document) => document.content.propertyKey === propertyKey);
      expect(matching.length).toBeGreaterThan(0);
      for (const definition of matching) expect(definition.content.revision.documentation).toBe(documentation);
    }
    for (const definition of definitions) {
      expect(definition.content.revision.displayName).not.toMatch(/[零一二]/);
      expect(definition.content.revision.documentation).not.toMatch(/第[零一二]组/);
      expect(definition.content.revision.displayName).toMatch(/\p{Script=Han}/u);
      expect(definition.content.revision.documentation).toMatch(/\p{Script=Han}/u);
      const prior = previous.documents.find((document) => document.content.id === definition.content.id);
      expect(prior?.kind).toBe("definition");
      if (prior?.kind !== "definition") continue;
      expect(definition.content.subjectId).toBe(prior.content.subjectId);
      expect(definition.content.propertyKey).toBe(prior.content.propertyKey);
      expect(definition.content.revision.valueSchema).toEqual(prior.content.revision.valueSchema);
      expect(definition.content.revision.matching).toEqual(prior.content.revision.matching);
      expect(definition.content.revision.unit).toBe(prior.content.revision.unit);
      expect(definition.content.revision.number).toBe(prior.content.revision.number + 1);
      expect(definition.content.revision.id).not.toBe(prior.content.revision.id);
    }
    expect(definitions.find((document) => document.content.id === "pdef_drv_huawei_charging_core_iin_max")?.content.revision)
      .toMatchObject({ displayName: "最大输入电流", documentation: "设置允许的最大输入电流，单位为毫安。" });
    expect(current.documents.filter((document) => document.kind !== "definition").map((document) => document.content))
      .toEqual(previous.documents.filter((document) => document.kind !== "definition").map((document) => document.content));
    expect(compileCatalogRelease({ ...result.bundle, releases: result.bundle.releases.slice(0, -1), targetReleaseId: previous.manifest.release.id })).toMatchObject({
      ok: true, value: { aggregateDigest: result.predecessor.digest },
    });
  });

  it("compiles a successor of crel_acme_1 from catalog.json minus excluded fixtures", () => {
    const first = compileCatalogRelease(firstReleaseBundle());
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    for (const name of EXCLUDED_SCHEMA_BASENAMES) {
      expect(existsSync(path.join("schemas/dts/vendor/wiseeff", name))).toBe(true);
    }

    const result = compileVendorCatalogSuccessor();
    expect(result.compiled.release.id).toBe(VENDOR_SUCCESSOR_RELEASE_ID);
    expect(result.predecessor).toEqual(first.value.release);
    expect(result.compiled.predecessor).toEqual({
      id: first.value.release.id,
      digest: first.value.release.digest,
    });
    expect(result.predecessor.id).toBe(FIRST_ACME_RELEASE_ID);
    expect(result.predecessor.digest).toBe(FIRST_ACME_RELEASE_DIGEST);
    expect(result.compiled.aggregateDigest).toBe(VENDOR_SUCCESSOR_AGGREGATE_DIGEST);
    expect(result.excluded).toEqual([...EXCLUDED_SCHEMA_BASENAMES]);
    expect(result.compiled.counts).toEqual({
      subjects: 49,
      subjectMemberships: 49,
      aliases: 1,
      aliasMemberships: 1,
      definitions: 116,
      definitionRevisions: 116,
    });

    const target = result.bundle.releases.find(
      (release) => release.manifest.release.id === VENDOR_SUCCESSOR_RELEASE_ID,
    );
    expect(target).toBeDefined();
    const ids = new Set(target!.documents.map((document) => document.content.id));
    expect(ids.has("csub_acme_power")).toBe(true);
    expect(ids.has("pdef_acme_power_iin_max")).toBe(true);
    expect(ids.has("cali_acme_power_v1")).toBe(true);
    expect(ids.has("csub_nt_root")).toBe(true);
    expect(ids.has("pdef_nt_root_board_id")).toBe(true);
    const canonicalKeys = target!.documents
      .filter((document) => document.kind === "subject")
      .map((document) => document.content.canonicalKey);
    expect(canonicalKeys).toContain("driver:huawei,charging_core");
    expect(canonicalKeys).toContain("node-type:charging_core");
    expect([...ids].some((id) => id.includes("ambiguous"))).toBe(false);

    const keys = target!.documents
      .filter((document) => document.kind === "definition")
      .map((document) => document.content.propertyKey);
    expect(keys).toContain("iin_max");
    expect(keys).toContain("board_id");
    expect(keys).not.toContain("fast_charge_current_limit_ma");
    expect(keys).not.toContain("shared_prop");
    expect(keys).not.toContain("status");
  });

  it("is deterministic for the same repository catalog", () => {
    const first = compileVendorCatalogSuccessor();
    const second = compileVendorCatalogSuccessor();
    expect(second.compiled.aggregateDigest).toBe(first.compiled.aggregateDigest);
    expect(second.compiled.release.digest).toBe(first.compiled.release.digest);
    expect(second.compiled.aggregateDigest).toBe(VENDOR_SUCCESSOR_AGGREGATE_DIGEST);
  });

  it("fails closed when vendorContentHash does not match on-disk YAML", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "wiseeff-vendor-catalog-"));
    const vendorDir = path.join(root, "schemas/dts/vendor/wiseeff");
    mkdirSync(vendorDir, { recursive: true });
    writeFileSync(
      path.join(root, "schemas/dts/catalog.json"),
      JSON.stringify({
        vendorContentHash: "0".repeat(64),
        schemaPaths: ["vendor/wiseeff/x.yaml"],
      }),
    );
    writeFileSync(path.join(vendorDir, "x.yaml"), "title: x\n");
    expect(() => compileVendorCatalogSuccessor(root)).toThrow(/catalog-vendor-hash-mismatch/);
  });
});
