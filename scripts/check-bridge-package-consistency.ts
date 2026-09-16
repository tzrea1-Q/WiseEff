import { checkBridgePackageConsistency } from "./lib/bridgePackageConsistency";

const result = await checkBridgePackageConsistency(process.cwd());
if (!result.ok) {
  console.error("Bridge package consistency check failed:");
  for (const failure of result.failures) {
    console.error(`  - ${failure.code}: ${failure.message}`);
  }
  process.exit(1);
}

console.log(
  `Bridge artifacts ${result.recommendedVersion} match runtime source fingerprint ${result.sourceFingerprint}.`
);
