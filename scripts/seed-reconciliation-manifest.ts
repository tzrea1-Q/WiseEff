/**
 * Write the Issue #849 seed reconciliation artifacts.
 *
 * `npm run seed:reconcile` regenerates:
 *   - src/config/seed-reconciliation/manifest.json (reviewed contract, deterministic)
 *   - docs/generated/seed-reconciliation-report.md (human-readable projection)
 *
 * Run `npm run seed:reconcile:check` to verify the checked-in artifacts are current.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  SEED_RECONCILIATION_MANIFEST_PATH,
  SEED_RECONCILIATION_REPORT_PATH,
  buildSeedReconciliation,
  renderSanitizedSummary,
} from "./lib/seedReconciliation";

const rootDir = process.cwd();
const { manifest, report } = buildSeedReconciliation(rootDir);

const writeArtifact = (relativePath: string, contents: string): void => {
  const absolute = path.join(rootDir, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents, "utf8");
  console.log(`Wrote ${relativePath}`);
};

writeArtifact(SEED_RECONCILIATION_MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
writeArtifact(SEED_RECONCILIATION_REPORT_PATH, report);
console.log("");
console.log(renderSanitizedSummary(manifest));
