import { promises as fs } from "node:fs";
import path from "node:path";
import type { Queryable } from "./client";

export function getPendingMigrations(allMigrations: string[], appliedMigrations: string[]) {
  const applied = new Set(appliedMigrations);
  return allMigrations.filter((migration) => !applied.has(migration));
}

export async function applyMigrations(db: Queryable, migrationsDir: string) {
  await db.query(`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  const applied = await db.query<{ name: string }>("select name from schema_migrations order by name");
  const pending = getPendingMigrations(
    files,
    applied.rows.map((row) => row.name)
  );

  for (const file of pending) {
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    await db.query("begin");
    try {
      await db.query(sql);
      await db.query("insert into schema_migrations (name) values ($1)", [file]);
      await db.query("commit");
    } catch (error) {
      await db.query("rollback");
      throw error;
    }
  }

  return pending;
}
