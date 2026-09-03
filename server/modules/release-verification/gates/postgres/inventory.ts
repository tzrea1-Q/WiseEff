import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getMissingMigrationFiles,
  getPendingMigrations,
} from "../../../../shared/database/migrations";
import { digestOf } from "../../core/digest";

export const DEFAULT_MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../migrations",
);

/**
 * Historical rename/alias ledger mirrored from the migration runner.
 * Aliases are validation-only; the runner never executes their SQL.
 */
export const HISTORICAL_ALIAS_LEDGER: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "0117_effective_driver_parameter_catalog.sql": [
    "9c1fb3d1c69610b127bc03f6a66c66c25864e7e7dce43b69a46d670e162fe4db",
  ],
  "0118_effective_driver_parameter_catalog_contract.sql": [
    "73a7a028be9a1fcf8115b7eb2da2099adf4c25283216b3e55d1001b3f9d3b80d",
  ],
  "0119_effective_driver_parameter_catalog_finalize.sql": [
    "0f9b4096d455f2f259904b724bd3d18b5972418c13b4527f4bdd27c25a7dab1f",
  ],
  "0120_effective_driver_parameter_catalog_legacy_write_compat.sql": [
    "26a66bfae9c2aad4bbb4ddeee3ea1f9ef7b18dd601bd943dca5c3f9d4d7d44dc",
  ],
  "0121_classify_nodename_driver_subjects.sql": [
    "88f31d34bc6af73ce6b00bfcc320ae1cf24d645d3f32698da2fdcdfef1179d0e",
  ],
});

export type PackagedMigrationEntry = {
  readonly name: string;
  readonly checksum: string;
};

export type PackagedMigrationInventory = {
  readonly dir: string;
  readonly entries: readonly PackagedMigrationEntry[];
  readonly digest: string;
  readonly lastName: string;
  readonly schemaVersionPrefix: string;
};

const sha256Hex = (bytes: string): string => createHash("sha256").update(bytes).digest("hex");

const cache = new Map<string, PackagedMigrationInventory>();

export const historicalAliasNames = (): readonly string[] => Object.keys(HISTORICAL_ALIAS_LEDGER);

export async function loadPackagedMigrationInventory(
  migrationsDir: string = DEFAULT_MIGRATIONS_DIR,
): Promise<PackagedMigrationInventory> {
  const cached = cache.get(migrationsDir);
  if (cached) {
    return cached;
  }
  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  const entries: PackagedMigrationEntry[] = [];
  for (const name of files) {
    const sql = await fs.readFile(path.join(migrationsDir, name), "utf8");
    entries.push({ name, checksum: sha256Hex(sql) });
  }
  const lastName = entries[entries.length - 1]?.name ?? "";
  const inventory: PackagedMigrationInventory = {
    dir: migrationsDir,
    entries,
    digest: digestOf(entries),
    lastName,
    schemaVersionPrefix: lastName.slice(0, 4),
  };
  cache.set(migrationsDir, inventory);
  return inventory;
}

export const missingAppliedFiles = (
  packagedNames: readonly string[],
  appliedNames: readonly string[],
): string[] => getMissingMigrationFiles([...packagedNames], [...appliedNames], [...historicalAliasNames()]);

export const pendingPackagedFiles = (
  packagedNames: readonly string[],
  appliedNames: readonly string[],
): string[] => getPendingMigrations([...packagedNames], [...appliedNames]);

export const aliasChecksumValid = (name: string, checksum: string | null): boolean => {
  const allowed = HISTORICAL_ALIAS_LEDGER[name];
  if (!allowed) {
    return false;
  }
  return checksum != null && allowed.includes(checksum);
};
