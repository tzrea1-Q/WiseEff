/**
 * Verify the Issue #849 seed reconciliation artifacts are current and complete.
 *
 * `npm run seed:reconcile:check` rebuilds the manifest and report from the current seed/catalog
 * inputs and fails (non-zero exit) when either checked-in artifact has drifted or when a
 * completeness invariant is broken. No database or network access is required.
 */
import {
  SEED_RECONCILIATION_MANIFEST_PATH,
  SEED_RECONCILIATION_REPORT_PATH,
  checkSeedReconciliation,
} from "./lib/seedReconciliation";

const readFlag = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const result = checkSeedReconciliation({
  rootDir: process.cwd(),
  manifestPath: readFlag("--manifest"),
  reportPath: readFlag("--report"),
});

if (!result.ok) {
  console.error("seed reconciliation artifacts are not current:");
  for (const drift of result.drifts) console.error(`  - ${drift}`);
  console.error(
    `Run npm run seed:reconcile and commit ${SEED_RECONCILIATION_MANIFEST_PATH} + ${SEED_RECONCILIATION_REPORT_PATH}.`,
  );
  process.exit(1);
}

console.log(`${SEED_RECONCILIATION_MANIFEST_PATH} and ${SEED_RECONCILIATION_REPORT_PATH} are current.`);
