/**
 * Emit Linux dt-schema bindings for WiseEff vendor/golden compatibles so
 * `dt-validate -s <dir> -c` can cover proprietary properties without disabling
 * fail-closed schema checks.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildBindingForCompatible,
  collectReleaseCompatibles,
  loadVendorSpecs,
  manifestGeneratedAt,
  stableBindingsContentHash,
  type GeneratedBinding
} from "./lib/vendorDtSchemaGenerator";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vendorDir = join(root, "schemas/dts/vendor/wiseeff");
const seedDir = join(root, "src/config/dts-seed");
const outDir = join(root, "schemas/dts/linux-bindings");

export function generateLinuxDtBindings(): {
  files: string[];
  contentHash: string;
  blockers: string[];
  generated: GeneratedBinding[];
} {
  mkdirSync(outDir, { recursive: true });
  for (const existing of readdirSync(outDir)) {
    if (existing.endsWith(".yaml") || existing.endsWith(".yml") || existing === "manifest.json") {
      rmSync(join(outDir, existing), { force: true });
    }
  }

  const vendorByCompatible = loadVendorSpecs(vendorDir);
  const compatibles = collectReleaseCompatibles(seedDir, vendorByCompatible);
  const generated: GeneratedBinding[] = [];
  const blockers: string[] = [];

  for (const compatible of compatibles) {
    const binding = buildBindingForCompatible(compatible, vendorByCompatible, vendorDir);
    generated.push(binding);
    blockers.push(...binding.blockers);
    if (!binding.body.trim()) {
      continue;
    }
    writeFileSync(join(outDir, binding.fileName), binding.body, "utf8");
  }

  const written = generated.filter((item) => item.body.trim());
  const contentHash = stableBindingsContentHash(
    written.map((item) => ({ fileName: item.fileName, body: item.body }))
  );

  const hardBlockers = blockers.filter((item) => item.startsWith("schema-blocker:"));
  const manifest = {
    generatedAt: manifestGeneratedAt(),
    contentHash,
    blockerCount: blockers.length,
    hardBlockerCount: hardBlockers.length,
    files: written.map((item) => item.fileName).sort()
  };
  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return { files: manifest.files, contentHash, blockers, generated };
}

async function main() {
  const result = generateLinuxDtBindings();
  const hardBlockers = result.blockers.filter((item) => item.startsWith("schema-blocker:"));
  console.log(
    JSON.stringify(
      {
        ok: hardBlockers.length === 0,
        outDir: "schemas/dts/linux-bindings",
        fileCount: result.files.length,
        contentHash: result.contentHash,
        blockerCount: result.blockers.length,
        hardBlockerCount: hardBlockers.length,
        hardBlockers: hardBlockers.slice(0, 40)
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
