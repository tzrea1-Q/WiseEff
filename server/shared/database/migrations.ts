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

export function getPendingMigrations(allMigrations: string[], appliedMigrations: string[]) {
  const applied = new Set(appliedMigrations);
  return allMigrations.filter((migration) => !applied.has(migration));
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
