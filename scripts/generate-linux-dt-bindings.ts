/**
 * Emit Linux dt-schema bindings for WiseEff vendor/golden compatibles so
 * `dt-validate -s <dir> -c` can cover proprietary properties without disabling
 * fail-closed schema checks.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildBindingForCompatible,
  loadVendorSpecs,
  stableBindingsContentHash,
  type GeneratedBinding
} from "./lib/vendorDtSchemaGenerator";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vendorDir = join(root, "schemas/dts/vendor/wiseeff");
const seedDir = join(root, "src/config/dts-seed");
const outDir = join(root, "schemas/dts/linux-bindings");

function collectCompatibles(): string[] {
  const found = new Set<string>();
  const vendorByCompatible = loadVendorSpecs(vendorDir);
  for (const value of vendorByCompatible.keys()) found.add(value);

  for (const name of readdirSync(seedDir).filter((entry) => entry.endsWith(".dts"))) {
    const text = readFileSync(join(seedDir, name), "utf8");
    for (const match of text.matchAll(/compatible\s*=\s*"([^"]+)"/g)) {
      found.add(match[1]!);
    }
  }

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

export function generateLinuxDtBindings(): {
  files: string[];
  contentHash: string;
  blockers: string[];
  generated: GeneratedBinding[];
} {
  mkdirSync(outDir, { recursive: true });
  for (const existing of readdirSync(outDir)) {
    if (existing.endsWith(".yaml") || existing.endsWith(".yml")) {
      rmSync(join(outDir, existing), { force: true });
    }
  }

  const vendorByCompatible = loadVendorSpecs(vendorDir);
  const generated: GeneratedBinding[] = [];
  const blockers: string[] = [];

  for (const compatible of collectCompatibles()) {
    const binding = buildBindingForCompatible(compatible, vendorByCompatible, seedDir);
    generated.push(binding);
    blockers.push(...binding.blockers);
    if (!binding.body.trim()) {
      blockers.push(`schema-blocker: empty binding for ${compatible}`);
      continue;
    }
    writeFileSync(join(outDir, binding.fileName), binding.body, "utf8");
  }

  const written = generated.filter((item) => item.body.trim());
  const contentHash = stableBindingsContentHash(
    written.map((item) => ({ fileName: item.fileName, body: item.body }))
  );

  const manifest = {
    generatedAt: new Date().toISOString(),
    contentHash,
    blockerCount: blockers.length,
    files: written.map((item) => item.fileName).sort()
  };
  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return { files: manifest.files, contentHash, blockers, generated };
}

const GOLDEN_COMPATIBLES = new Set(
  readFileSync(join(seedDir, "wiseeff-power-base.dts"), "utf8")
    .match(/compatible\s*=\s*"([^"]+)"/g)
    ?.map((m) => m.replace(/.*"([^"]+)"/, "$1")) ?? []
);

async function main() {
  const result = generateLinuxDtBindings();
  const hardBlockers = result.blockers.filter((item) => {
    if (!item.startsWith("schema-blocker:")) return false;
    const compatible = item.match(/for (.+)$/)?.[1];
    return compatible ? GOLDEN_COMPATIBLES.has(compatible) || item.includes("empty binding") : true;
  });
  console.log(
    JSON.stringify(
      {
        ok: hardBlockers.length === 0,
        outDir: "schemas/dts/linux-bindings",
        fileCount: result.files.length,
        contentHash: result.contentHash,
        blockerCount: result.blockers.length,
        hardBlockerCount: hardBlockers.length
      },
      null,
      2
    )
  );
  if (hardBlockers.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
