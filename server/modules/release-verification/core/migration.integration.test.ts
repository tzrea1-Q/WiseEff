import { promises as fs } from "node:fs";
import path from "node:path";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { createDatabase } from "../../../shared/database/client";
import { applyMigrations } from "../../../shared/database/migrations";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
} from "../../../testing/testDatabase";
import { migrationsDir, withTempDatabase } from "../../../testing/tempDatabase";
import { closedGateIds } from "./gateRegistry";
import { VERIFICATION_CORE_MIGRATION } from "./migrationName";

const databaseAvailable = await isTestDatabaseAvailable();

if (!databaseAvailable) {
  throw new Error(
    "S10-PER migration tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
  );
}

const pgVectorInstalled = await (async () => {
  const probe = await createInMemoryTestDatabase();
  try {
    const result = await probe.query<{ installed: boolean }>(
      `select exists (
         select 1
         from pg_catalog.pg_extension
         where extname = 'vector'
       ) as installed`,
    );
    return result.rows[0]?.installed === true;
  } finally {
    await probe.rollback();
  }
})();

if (!pgVectorInstalled) {
  throw new Error(
    "S10-PER migration tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

const migrationPath = path.join(migrationsDir, VERIFICATION_CORE_MIGRATION);
const rolesMigration = "0138_canonical_parameter_catalog_roles.sql";
const FORBIDDEN_IDENTITY_TOKEN = ["parameter", "definitions"].join("_");

const verificationRelationSql = `
  select class.relname
  from pg_catalog.pg_class class
  join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
  where namespace.nspname = 'parameter_catalog'
    and class.relkind in ('r', 'p', 'S', 'v', 'm')
    and class.relname like 'verification_%'
  order by class.relname
`;

describe("verification-core migration", () => {
  it("does not contain the forbidden identity token", async () => {
    const sql = await fs.readFile(migrationPath, "utf8");
    expect(sql).not.toContain(FORBIDDEN_IDENTITY_TOKEN);
    expect(sql.toLowerCase()).not.toMatch(/grant\s+select\s+on\s+table\s+public\./);
  });

  it("applies on fresh pgvector and rolls back to zero verification relations", async () => {
    const sql = await fs.readFile(migrationPath, "utf8");
    await withTempDatabase(
      { prefix: "s10per", migrate: false },
      async ({ connectionString }) => {
        const client = new pg.Client({ connectionString });
        await client.connect();
        try {
          const db = createDatabase({
            query: async (text, values = []) => {
              const result = await client.query(text, values);
              return { rows: result.rows, rowCount: result.rowCount };
            },
          });
          const appliedThroughRoles = await applyMigrations(db, migrationsDir, {
            through: rolesMigration,
          });
          expect(appliedThroughRoles.at(-1)).toBe(rolesMigration);
          const before = await client.query<{ relname: string }>(verificationRelationSql);
          expect(before.rows).toEqual([]);

          await client.query("begin");
          await client.query(sql);
          const during = await client.query<{ relname: string }>(verificationRelationSql);
          expect(during.rows.map((row) => row.relname)).toEqual([
            "verification_approvals",
            "verification_attempts",
            "verification_gate_registry",
            "verification_gate_results",
            "verification_plans",
            "verification_reports",
          ]);
          await client.query("rollback");

          const afterRollback = await client.query<{ relname: string }>(verificationRelationSql);
          expect(afterRollback.rows).toEqual([]);

          const applied = await applyMigrations(db, migrationsDir, {
            through: VERIFICATION_CORE_MIGRATION,
          });
          expect(applied).toEqual([VERIFICATION_CORE_MIGRATION]);
          const afterApply = await client.query<{ relname: string }>(verificationRelationSql);
          expect(afterApply.rows).toHaveLength(6);

          const registry = await client.query<{ gate_id: string }>(
            `select gate_id
             from parameter_catalog.verification_gate_registry
             order by gate_id`,
          );
          expect(registry.rows.map((row) => row.gate_id)).toEqual([...closedGateIds()].sort());

          await client.query("begin");
          await client.query("set local role catalog_migration_owner");
          const canary = await client.query<{ n: string }>(
            "select count(*)::text as n from parameter_catalog.verification_plans",
          );
          expect(canary.rows[0]?.n).toBe("0");
          await client.query("rollback");

          await client.query("begin");
          await client.query("set local role catalog_synchronizer_role");
          await expect(
            client.query("insert into parameter_catalog.verification_plans default values"),
          ).rejects.toMatchObject({ code: "42501" });
          await client.query("rollback");
        } finally {
          await client.end().catch(() => undefined);
        }
      },
    );
  });
});
