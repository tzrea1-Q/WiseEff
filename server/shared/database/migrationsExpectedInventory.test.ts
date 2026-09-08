import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Database } from "./client";
import { applyMigrations } from "./migrations";

const checksum = (sql: string) => createHash("sha256").update(sql).digest("hex");
// This suite never opens a database. The separate owned-PG sourceSnapshot suite
// proves the same inventory contract through real appended schema migrations.
describe("frozen migration execution inventory", () => {
  async function fixture(work: (directory: string, db: Database, calls: string[]) => Promise<void>) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "upg-migration-bytes-"));
    const calls: string[] = [];
    const db: Database = {
      query: async <Row>(sql: string) => { calls.push(sql); return { rows: [] as Row[], rowCount: 0 }; },
      transaction: async action => action(db),
    };
    try { await work(directory, db, calls); }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
  it("refuses changed execution bytes before even bootstrapping the ledger", async () => {
    await fixture(async (directory, db, calls) => {
      await writeFile(path.join(directory, "0001_owned.sql"), "select 'changed';");
      await expect(applyMigrations(db, directory, { expectedInventory: [{ name: "0001_owned.sql", checksum: checksum("select 'approved';") }] }))
        .rejects.toThrow("migration-expected-inventory-drift");
      expect(calls).toEqual([]);
    });
  });
  it("refuses unknown suffix files instead of running the selected subset", async () => {
    await fixture(async (directory, db, calls) => {
      await writeFile(path.join(directory, "0001_owned.sql"), "select 1;");
      await writeFile(path.join(directory, "9999_unknown.sql"), "select 2;");
      await expect(applyMigrations(db, directory, { expectedInventory: [{ name: "0001_owned.sql", checksum: checksum("select 1;") }] }))
        .rejects.toThrow("migration-expected-inventory-drift");
      expect(calls).toEqual([]);
    });
  });
  it("does not execute replacement bytes written after the initial file inventory", async () => {
    await fixture(async (directory, db, calls) => {
      const file = path.join(directory, "0001_owned.sql");
      await writeFile(file, "select 'approved';");
      const query = db.query;
      db.query = async <Row>(sql: string, values?: unknown[]) => {
        if (sql.includes("create table if not exists schema_migrations")) await writeFile(file, "select 'unapproved';");
        return query<Row>(sql, values);
      };
      await expect(applyMigrations(db, directory, { expectedInventory: [{ name: "0001_owned.sql", checksum: checksum("select 'approved';") }] }))
        .rejects.toThrow("migration-expected-inventory-drift");
      expect(calls).not.toContain("select 'unapproved';");
    });
  });
});
