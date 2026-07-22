/**
 * Enrich vendor property YAML with Chinese documentation when missing.
 * Also refreshes schemas/dts/catalog.json vendorContentHash.
 *
 * Usage: npx tsx scripts/enrich-vendor-property-docs.ts
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import yaml from "js-yaml";

const root = join(process.cwd(), "schemas/dts");
const vendorDir = join(root, "vendor/wiseeff");
const catalogPath = join(root, "catalog.json");

const EXACT_DOCS: Record<string, string> = {
  compatible: "设备树 compatible 字符串，用于匹配驱动与规格命名空间。",
  status: "节点启用状态（如 okay / disabled），控制该设备是否参与探测。",
  reg: "设备在父总线上的地址/寄存器范围。",
  interrupts: "中断说明符列表，绑定到 interrupt-parent 控制器。",
  "interrupt-parent": "指向中断控制器的 phandle。",
  "interrupt-controller": "标记本节点为中断控制器。",
  "#interrupt-cells": "中断说明符所需的 cell 数量。",
  "gpio-controller": "标记本节点为 GPIO 控制器。",
  "#gpio-cells": "GPIO 说明符所需的 cell 数量。",
  "#address-cells": "子节点地址字段占用的 cell 数量。",
  "#size-cells": "子节点尺寸字段占用的 cell 数量。",
  ranges: "父子地址空间映射；空属性表示 1:1 透传。",
  clocks: "时钟 phandle 与说明符列表。",
  "clock-names": "与 clocks 一一对应的时钟名称。",
  supplies: "电源供给相关配置。",
  "dma-ranges": "DMA 地址空间映射。",
};

const PREFIX_DOCS: Array<[RegExp, (key: string, title: string) => string]> = [
  [/^gpio_/, (key) => `GPIO 相关配置项「${key}」，描述引脚、极性或中断线。`],
  [/^batt_/, (key) => `电池相关参数「${key}」，用于容量、标识或采样策略。`],
  [/^battery_/, (key) => `电池相关参数「${key}」，用于容量、标识或采样策略。`],
  [/^vbat_/, (key) => `电池电压相关参数「${key}」，单位通常为毫伏。`],
  [/^charge_/, (key) => `充电策略参数「${key}」，影响充电电流/电压或模式切换。`],
  [/^charger_/, (key) => `充电器参数「${key}」，描述充电 IC 行为或限值。`],
  [/^wireless_/, (key) => `无线充电参数「${key}」。`],
  [/^temp_/, (key) => `温度相关参数「${key}」，用于保护或拟合。`],
  [/^ocv_/, (key) => `开路电压（OCV）相关参数「${key}」。`],
  [/^soh_/, (key) => `电池健康（SOH）相关参数「${key}」。`],
  [/^cccv_/, (key) => `恒流恒压（CCCV）相关参数「${key}」。`],
  [/^const_/, (key) => `恒定输出/限值参数「${key}」。`],
  [/^ic_/, (key) => `芯片角色或标识参数「${key}」。`],
  [/^shutdown_/, (key) => `关机/关断相关配置「${key}」。`],
  [/^r_/, (key) => `电阻相关参数「${key}」，常用于 PCB 或采样电阻。`],
  [/^vth_/, (key) => `阈值/校正参数「${key}」。`],
];

function humanizeKey(key: string): string {
  return key.replace(/_/g, " ").replace(/-/g, " ");
}

function documentationFor(propertyKey: string, title: string): string {
  if (EXACT_DOCS[propertyKey]) return EXACT_DOCS[propertyKey];
  for (const [pattern, build] of PREFIX_DOCS) {
    if (pattern.test(propertyKey)) return build(propertyKey, title);
  }
  const device = title || "该设备";
  return `${device} 的 DTS 属性「${humanizeKey(propertyKey)}」（${propertyKey}），用于驱动读取的设备树配置。`;
}

function dumpYaml(doc: unknown): string {
  return yaml.dump(doc, {
    lineWidth: 120,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
  });
}

function refreshCatalogHash(): string {
  const onDisk = readdirSync(vendorDir)
    .filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"))
    .sort();
  const hash = createHash("sha256");
  for (const name of onDisk) {
    hash.update(name);
    hash.update("\0");
    hash.update(readFileSync(join(vendorDir, name), "utf8"));
    hash.update("\0");
  }
  return hash.digest("hex");
}

let updatedProps = 0;
let touchedFiles = 0;

for (const name of readdirSync(vendorDir).filter((n) => n.endsWith(".yaml")).sort()) {
  const path = join(vendorDir, name);
  const raw = readFileSync(path, "utf8");
  const doc = yaml.load(raw) as {
    title?: string;
    properties?: Record<string, Record<string, unknown>>;
  } | null;
  if (!doc?.properties) continue;

  let changed = false;
  const title = String(doc.title ?? name.replace(/\.ya?ml$/, ""));
  for (const [key, prop] of Object.entries(doc.properties)) {
    if (!prop || typeof prop !== "object") continue;
    const existing = typeof prop.documentation === "string" ? prop.documentation.trim() : "";
    if (existing) continue;
    prop.documentation = documentationFor(key, title);
    changed = true;
    updatedProps += 1;
  }

  if (changed) {
    writeFileSync(path, dumpYaml(doc), "utf8");
    touchedFiles += 1;
  }
}

const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as {
  vendorContentHash: string;
  [key: string]: unknown;
};
catalog.vendorContentHash = refreshCatalogHash();
writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");

console.log(
  JSON.stringify(
    {
      touchedFiles,
      updatedProps,
      vendorContentHash: catalog.vendorContentHash,
    },
    null,
    2
  )
);
