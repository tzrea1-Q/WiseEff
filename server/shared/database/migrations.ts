import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Database } from "./client";

/**
 * Serializes concurrent migrators. Each migration file is applied inside its
 * own transaction holding this advisory lock, with pendingness re-checked
 * under the lock, so two `db:migrate` processes cannot double-apply DDL.
 */
const MIGRATION_ADVISORY_LOCK_KEY = 7_154_209_001;

export type ApplyMigrationsOptions = {
  /** Apply only migrations whose file name sorts strictly before this value. */
  before?: string;
  /** Apply only migrations whose file name sorts at or before this value. */
  through?: string;
};

/**
 * Migration names used by the short-lived Issue #649 branch before it was
 * rebased onto the main line's immutable 0117 user-deletion migration.
 *
 * These are validation-only aliases. They are deliberately not returned by
 * the filesystem inventory and are never pending on a fresh database. A
 * database that already recorded one of these names can still prove the
 * applied SQL identity by its recorded checksum, while the rebased 0118+
 * migrations continue from the current inventory.
 */
const LEGACY_MIGRATION_CHECKSUMS: Record<string, readonly string[]> = {
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
};

export function getPendingMigrations(allMigrations: string[], appliedMigrations: string[]) {
  const applied = new Set(appliedMigrations);
  return allMigrations.filter((migration) => !applied.has(migration));
}

/** Applied migration names are immutable inventory, not just a checksum list. */
export function getMissingMigrationFiles(
  allMigrations: string[],
  appliedMigrations: string[],
  legacyMigrations: string[] = [],
): string[] {
  const available = new Set([...allMigrations, ...legacyMigrations]);
  return appliedMigrations.filter((migration) => !available.has(migration));
}

function sha256(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

export async function applyMigrations(
  db: Database,
  migrationsDir: string,
  options: ApplyMigrationsOptions = {}
) {
  // Bootstrap under the same advisory lock: concurrent `create table if not
  // exists` on two sessions is a documented Postgres race (pg_type unique key).
  await db.transaction(async (tx) => {
    await tx.query("select pg_advisory_xact_lock($1)", [MIGRATION_ADVISORY_LOCK_KEY]);
    await tx.query(`
      create table if not exists schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )
    `);
    await tx.query(`alter table schema_migrations add column if not exists checksum text`);
  });

  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  const limited = files.filter(
    (file) =>
      (options.before === undefined || file < options.before) &&
      (options.through === undefined || file <= options.through)
  );

  const applied = await db.query<{ name: string; checksum: string | null }>(
    "select name, checksum from schema_migrations order by name"
  );
  const appliedChecksums = new Map(applied.rows.map((row) => [row.name, row.checksum]));

  const legacyMigrationNames = Object.keys(LEGACY_MIGRATION_CHECKSUMS);
  const missingFiles = getMissingMigrationFiles(
    files,
    [...appliedChecksums.keys()],
    legacyMigrationNames,
  );
  if (missingFiles.length > 0) {
    throw new Error(
      `Applied migration files are missing from the repository: ${missingFiles.join(", ")}. ` +
        "Restore the immutable migration file before applying new migrations.",
    );
  }

  // Historical aliases are validation-only. They must carry one of the
  // immutable checksums recorded for the pre-rebase branch; no alias SQL is
  // ever executed by this runner. Rows created before checksum recording are
  // backfilled to the canonical historical checksum so subsequent runs keep
  // the same drift protection as current files.
  for (const [name, checksums] of Object.entries(LEGACY_MIGRATION_CHECKSUMS)) {
    if (!appliedChecksums.has(name)) continue;
    const stored = appliedChecksums.get(name);
    const canonical = checksums[0];
    if (!canonical) continue;
    if (stored == null) {
      await db.query(
        "update schema_migrations set checksum = $2 where name = $1 and checksum is null",
        [name, canonical],
      );
    } else if (!checksums.includes(stored)) {
      throw new Error(
        `Migration drift detected: ${name} has an unknown historical checksum. ` +
          "Restore the exact applied migration or perform an audited migration-history repair.",
      );
    }
  }

  // Fail loudly when an already-applied migration file was edited afterwards;
  // backfill checksums for rows recorded before checksums existed.
  for (const file of limited) {
    if (!appliedChecksums.has(file)) continue;
    const checksum = sha256(await fs.readFile(path.join(migrationsDir, file), "utf8"));
    const stored = appliedChecksums.get(file);
    if (stored == null) {
      await db.query("update schema_migrations set checksum = $2 where name = $1 and checksum is null", [
        file,
        checksum
      ]);
    } else if (stored !== checksum) {
      throw new Error(
        `Migration drift detected: ${file} no longer matches the checksum recorded when it was applied. ` +
          `Applied migrations are immutable; add a new migration instead of editing an applied one.`
      );
    }
  }

  const pending = getPendingMigrations(limited, [...appliedChecksums.keys()]);

  const appliedNow: string[] = [];
  for (const file of pending) {
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    const checksum = sha256(sql);
    const didApply = await db.transaction(async (tx) => {
      await tx.query("select pg_advisory_xact_lock($1)", [MIGRATION_ADVISORY_LOCK_KEY]);
      const already = await tx.query<{ name: string }>(
        "select name from schema_migrations where name = $1",
        [file]
      );
      if (already.rows.length > 0) {
        return false;
      }
      await tx.query(sql);
      await tx.query("insert into schema_migrations (name, checksum) values ($1, $2)", [file, checksum]);
      return true;
    });
    if (didApply) {
      appliedNow.push(file);
    }
  }

  return appliedNow;
}
