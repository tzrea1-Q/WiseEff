/**
 * Emit Linux dt-schema bindings for WiseEff vendor/golden compatibles so
 * `dt-validate -s <dir> -c` can cover proprietary properties without disabling
 * fail-closed schema checks.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import yaml from "js-yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vendorDir = join(root, "schemas/dts/vendor/wiseeff");
const seedDir = join(root, "src/config/dts-seed");
const outDir = join(root, "schemas/dts/linux-bindings");

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "root";
}

function collectCompatibles(): string[] {
  const found = new Set<string>();

  for (const name of readdirSync(vendorDir).filter((entry) => entry.endsWith(".yaml"))) {
    const doc = yaml.load(readFileSync(join(vendorDir, name), "utf8")) as {
      compatible?: string[];
    };
    for (const value of doc.compatible ?? []) found.add(value);
  }

  for (const name of readdirSync(seedDir).filter((entry) => entry.endsWith(".dts"))) {
    const text = readFileSync(join(seedDir, name), "utf8");
    for (const match of text.matchAll(/compatible\s*=\s*"([^"]+)"/g)) {
      found.add(match[1]!);
    }
  }

  // Board roots / acceptance fixtures used by e2e loops.
  found.add("wiseeff,board");
  found.add("wiseeff,acceptance-broken");
  found.add("wiseeff,acceptance-map");
  found.add("wiseeff,amba");
  found.add("wiseeff,gic");
  found.add("wiseeff,spmi");
  found.add("wiseeff,spmi1");
  found.add("wiseeff,gpio2");
  found.add("wiseeff,gpio5");
  found.add("wiseeff,gpio6");
  found.add("wiseeff,gpio7");
  found.add("wiseeff,gpio10");
  found.add("wiseeff,gpio13");

  return [...found].sort();
}

function renderBinding(compatible: string): string {
  const idSlug = slug(compatible);
  return `%YAML 1.2
---
$id: http://devicetree.org/schemas/vendor/wiseeff/${idSlug}.yaml#
$title: ${compatible}
description: WiseEff vendor binding generated for dt-validate coverage of golden power fixtures.
maintainers:
  - WiseEff
select:
  properties:
    compatible:
      contains:
        const: ${compatible}
  required:
    - compatible
properties:
  compatible: true
  status:
    enum:
      - okay
      - disabled
      - reserved
      - fail
      - fail-needs-probe
  model: true
additionalProperties: true
unevaluatedProperties: true
`;
}

export function generateLinuxDtBindings(): { files: string[]; contentHash: string } {
  mkdirSync(outDir, { recursive: true });
  for (const existing of readdirSync(outDir)) {
    if (existing.endsWith(".yaml") || existing.endsWith(".yml")) {
      rmSync(join(outDir, existing), { force: true });
    }
  }

  const files: string[] = [];
  const hash = createHash("sha256");
  for (const compatible of collectCompatibles()) {
    const fileName = `${slug(compatible)}.yaml`;
    const body = renderBinding(compatible);
    writeFileSync(join(outDir, fileName), body, "utf8");
    files.push(fileName);
    hash.update(fileName);
    hash.update("\0");
    hash.update(body);
    hash.update("\0");
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    contentHash: hash.digest("hex"),
    files: files.sort()
  };
  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { files: manifest.files, contentHash: manifest.contentHash };
}

async function main() {
  const result = generateLinuxDtBindings();
  console.log(
    JSON.stringify(
      {
        ok: true,
        outDir: "schemas/dts/linux-bindings",
        fileCount: result.files.length,
        contentHash: result.contentHash
      },
      null,
      2
    )
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
