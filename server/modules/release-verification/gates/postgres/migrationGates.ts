import type { VerificationPlan } from "../../core/types";
import type { GateResult } from "../../core/types";
import { countedResult } from "./evidence";
import {
  aliasChecksumValid,
  historicalAliasNames,
  loadPackagedMigrationInventory,
  missingAppliedFiles,
  pendingPackagedFiles,
  type PackagedMigrationInventory,
} from "./inventory";
import { orderedChecksum } from "./evidence";
import type { GateQuery } from "./session";

type AppliedRow = {
  name: string;
  checksum: string | null;
};

const loadApplied = async (query: GateQuery): Promise<readonly AppliedRow[]> => {
  const result = await query<AppliedRow>(
    "select name, checksum from schema_migrations order by name",
  );
  return result.rows;
};

export const runM01 = async (
  query: GateQuery,
  plan: VerificationPlan,
  inventory: PackagedMigrationInventory,
): Promise<GateResult> => {
  const pinned = plan.pins.database.migrationInventoryDigest;
  const mismatch = pinned === inventory.digest ? 0 : 1;
  return countedResult("PCAT-DB-M01", "PCAT-MIG-PACKAGE-INVENTORY-DRIFT", mismatch, {
    entryCount: inventory.entries.length,
    lastName: inventory.lastName,
    packagedDigest: inventory.digest,
    pinnedDigest: pinned,
  });
};

export const runM02 = async (
  query: GateQuery,
  inventory: PackagedMigrationInventory,
): Promise<GateResult> => {
  const applied = await loadApplied(query);
  const missing = missingAppliedFiles(
    inventory.entries.map((entry) => entry.name),
    applied.map((row) => row.name),
  );
  const checksumMismatches = applied.filter((row) => {
    const packaged = inventory.entries.find((entry) => entry.name === row.name);
    if (!packaged) {
      return false;
    }
    return row.checksum == null || row.checksum !== packaged.checksum;
  });
  const offending = [...missing, ...checksumMismatches.map((row) => row.name)];
  return countedResult("PCAT-DB-M02", "PCAT-MIG-APPLIED-FILE-MISSING", offending.length, {
    appliedCount: applied.length,
    missing,
    missingChecksum: orderedChecksum(offending),
    packagedCount: inventory.entries.length,
  });
};

export const runM03 = async (
  query: GateQuery,
  inventory: PackagedMigrationInventory,
): Promise<GateResult> => {
  const applied = await loadApplied(query);
  const packagedNames = inventory.entries.map((entry) => entry.name);
  const appliedNames = applied.map((row) => row.name);
  const pending = pendingPackagedFiles(packagedNames, appliedNames);
  const firstPendingIndex = pending[0] ? packagedNames.indexOf(pending[0]) : packagedNames.length;
  const expectedSuffix = packagedNames.slice(firstPendingIndex);
  const suffixMismatch =
    pending.length !== expectedSuffix.length ||
    pending.some((name, index) => name !== expectedSuffix[index]);

  const aliasNames = new Set(historicalAliasNames());
  const unknownAliases = applied.filter(
    (row) => !packagedNames.includes(row.name) && !aliasNames.has(row.name),
  );
  const invalidAliases = applied.filter((row) => {
    if (!aliasNames.has(row.name)) {
      return false;
    }
    return !aliasChecksumValid(row.name, row.checksum);
  });
  const violationCount =
    (suffixMismatch ? 1 : 0) + unknownAliases.length + invalidAliases.length;
  return countedResult("PCAT-DB-M03", "PCAT-MIG-HISTORICAL-ALIAS-INVALID", violationCount, {
    invalidAliases: invalidAliases.map((row) => row.name),
    pending,
    suffixMismatch,
    unknownAliases: unknownAliases.map((row) => row.name),
  });
};

export const runM04 = async (
  query: GateQuery,
  plan: VerificationPlan,
  inventory: PackagedMigrationInventory,
): Promise<GateResult> => {
  const applied = await loadApplied(query);
  const packagedNames = inventory.entries.map((entry) => entry.name);
  const appliedNames = applied.map((row) => row.name);
  const pending = pendingPackagedFiles(packagedNames, appliedNames);
  const lastApplied = appliedNames.filter((name) => packagedNames.includes(name)).at(-1) ?? "";
  const schemaVersion = plan.pins.database.schemaVersion;
  const schemaMatches =
    lastApplied === inventory.lastName &&
    (inventory.lastName === schemaVersion ||
      inventory.lastName.startsWith(`${schemaVersion}_`) ||
      inventory.schemaVersionPrefix === schemaVersion);
  const inventoryMatches = plan.pins.database.migrationInventoryDigest === inventory.digest;
  const mismatches: string[] = [];
  if (pending.length > 0) {
    mismatches.push("pending");
  }
  if (!schemaMatches) {
    mismatches.push("schemaVersion");
  }
  if (!inventoryMatches) {
    mismatches.push("migrationInventoryDigest");
  }
  return countedResult("PCAT-DB-M04", "PCAT-SCHEMA-MIGRATION-RESULT-MISMATCH", mismatches.length, {
    appliedCount: applied.length,
    lastApplied,
    lastPackaged: inventory.lastName,
    mismatches,
    pendingCount: pending.length,
    schemaVersion,
  });
};

export { loadPackagedMigrationInventory };
