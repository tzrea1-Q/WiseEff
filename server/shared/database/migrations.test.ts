import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { createDatabase } from "./client";
import {
  applyMigrations,
  getMissingMigrationFiles,
  getPendingMigrations,
} from "./migrations";
import { isTestDatabaseAvailable } from "../../testing/testDatabase";

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

const databaseAvailable = await isTestDatabaseAvailable();

function adminConnectionString(database: string) {
  const base =
    process.env.TEST_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    "postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff";
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

async function connectDatabase(connectionString: string) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const db = createDatabase({
    query: async (text, values = []) => {
      const result = await client.query(text, values);
      return { rows: result.rows, rowCount: result.rowCount };
    }
  });
  return { client, db };
}

describe("getPendingMigrations", () => {
  it("returns migrations that have not been applied", () => {
    const pending = getPendingMigrations(["0001_m0_foundation.sql", "0002_next.sql"], ["0001_m0_foundation.sql"]);

    expect(pending).toEqual(["0002_next.sql"]);
  });
});

describe("getMissingMigrationFiles", () => {
  it("reports applied migration names whose immutable files disappeared", () => {
    expect(
      getMissingMigrationFiles(
        ["0001_m0_foundation.sql", "0002_next.sql"],
        ["0001_m0_foundation.sql", "0117_user_account_deletion.sql"],
      ),
    ).toEqual(["0117_user_account_deletion.sql"]);
  });

  it("accepts the checked historical aliases used before the 0117 rebase", () => {
    expect(
      getMissingMigrationFiles(
        ["0117_user_account_deletion.sql", "0118_effective_driver_parameter_catalog.sql"],
        ["0117_effective_driver_parameter_catalog.sql"],
        ["0117_effective_driver_parameter_catalog.sql"],
      ),
    ).toEqual([]);
  });
});

describe("migration numbering invariants", () => {
  it("keeps 4-digit prefixes unique so an accidental reuse cannot shadow an applied migration", async () => {
    const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql"));
    const prefixes = files.map((file) => file.slice(0, 4));

    const seen = new Map<string, string[]>();
    for (const [index, prefix] of prefixes.entries()) {
      expect(prefix).toMatch(/^\d{4}$/);
      seen.set(prefix, [...(seen.get(prefix) ?? []), files[index]!]);
    }

    const duplicates = [...seen.entries()].filter(([, names]) => names.length > 1);
    expect(duplicates).toEqual([]);
  });
});

describe.skipIf(!databaseAvailable)("applyMigrations concurrency and drift", () => {
  it("serializes two concurrent migrators without double-applying any file", async () => {
    const dbName = `wiseeff_migrate_race_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
    const admin = new pg.Client({ connectionString: adminConnectionString("postgres") });
    await admin.connect();
    await admin.query(`create database ${dbName}`);

    const a = await connectDatabase(adminConnectionString(dbName));
    const b = await connectDatabase(adminConnectionString(dbName));
    try {
      const through = "0002_m1_parameters.sql";
      const [appliedByA, appliedByB] = await Promise.all([
        applyMigrations(a.db, migrationsDir, { through }),
        applyMigrations(b.db, migrationsDir, { through })
      ]);

      // Between the two racers every file applies exactly once.
      const union = [...appliedByA, ...appliedByB].sort();
      expect(union).toEqual(["0001_m0_foundation.sql", "0002_m1_parameters.sql"]);

      const recorded = await a.db.query<{ name: string; checksum: string | null }>(
        "select name, checksum from schema_migrations order by name"
      );
      expect(recorded.rows.map((row) => row.name)).toEqual([
        "0001_m0_foundation.sql",
        "0002_m1_parameters.sql"
      ]);
      expect(recorded.rows.every((row) => typeof row.checksum === "string" && row.checksum.length === 64)).toBe(
        true
      );
    } finally {
      await a.client.end().catch(() => undefined);
      await b.client.end().catch(() => undefined);
      await admin.query(`drop database if exists ${dbName} with (force)`).catch(() => undefined);
      await admin.end().catch(() => undefined);
    }
  });

  it("fails loudly when an applied migration file is edited afterwards", async () => {
    const dbName = `wiseeff_migrate_drift_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
    const admin = new pg.Client({ connectionString: adminConnectionString("postgres") });
    await admin.connect();
    await admin.query(`create database ${dbName}`);

    const a = await connectDatabase(adminConnectionString(dbName));
    try {
      const through = "0001_m0_foundation.sql";
      await applyMigrations(a.db, migrationsDir, { through });
      // Simulate an edit to the applied file by rewriting its recorded checksum.
      await a.db.query("update schema_migrations set checksum = 'tampered' where name = $1", [through]);

      await expect(applyMigrations(a.db, migrationsDir, { through })).rejects.toThrow(/Migration drift detected/);
    } finally {
      await a.client.end().catch(() => undefined);
      await admin.query(`drop database if exists ${dbName} with (force)`).catch(() => undefined);
      await admin.end().catch(() => undefined);
    }
  });

  it("continues a database that recorded the pre-rebase catalog migration names", async () => {
    const dbName = `wiseeff_migrate_alias_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
    const admin = new pg.Client({ connectionString: adminConnectionString("postgres") });
    await admin.connect();
    await admin.query(`create database ${dbName}`);

    const connection = await connectDatabase(adminConnectionString(dbName));
    try {
      await applyMigrations(connection.db, migrationsDir, {
        through: "0116_node_write_observation_outcomes.sql",
      });
      await connection.db.query(
        `insert into schema_migrations (name, checksum)
         values ($1, $2)`,
        [
          "0117_effective_driver_parameter_catalog.sql",
          "9c1fb3d1c69610b127bc03f6a66c66c25864e7e7dce43b69a46d670e162fe4db",
        ],
      );

      const applied = await applyMigrations(connection.db, migrationsDir, {
        through: "0126_guard_binding_spec_version_owner.sql",
      });
      expect(applied).toEqual([
        "0117_user_account_deletion.sql",
        "0118_effective_driver_parameter_catalog.sql",
        "0119_effective_driver_parameter_catalog_contract.sql",
        "0120_effective_driver_parameter_catalog_finalize.sql",
        "0121_effective_driver_parameter_catalog_legacy_write_compat.sql",
        "0122_classify_nodename_driver_subjects.sql",
        "0123_harden_node_type_identity.sql",
        "0124_harden_driver_identity_owner.sql",
        "0125_harden_driver_schema_owner_scope.sql",
        "0126_guard_binding_spec_version_owner.sql",
      ]);
    } finally {
      await connection.client.end().catch(() => undefined);
      await admin.query(`drop database if exists ${dbName} with (force)`).catch(() => undefined);
      await admin.end().catch(() => undefined);
    }
  });

  it("fails closed when a historical alias has no checksum evidence", async () => {
    const dbName = `wiseeff_migrate_alias_null_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
    const admin = new pg.Client({ connectionString: adminConnectionString("postgres") });
    await admin.connect();
    await admin.query(`create database ${dbName}`);

    const connection = await connectDatabase(adminConnectionString(dbName));
    try {
      await applyMigrations(connection.db, migrationsDir, {
        through: "0116_node_write_observation_outcomes.sql",
      });
      await connection.db.query(
        `insert into schema_migrations (name, checksum)
         values ($1, null)`,
        ["0117_effective_driver_parameter_catalog.sql"],
      );

      await expect(
        applyMigrations(connection.db, migrationsDir, {
          through: "0118_effective_driver_parameter_catalog.sql",
        }),
      ).rejects.toThrow(/Migration history checksum missing for historical alias/);
    } finally {
      await connection.client.end().catch(() => undefined);
      await admin.query(`drop database if exists ${dbName} with (force)`).catch(() => undefined);
      await admin.end().catch(() => undefined);
    }
  });

  it("fails closed for the destructive pre-rebase nodename alias even with its known checksum", async () => {
    const dbName = `wiseeff_migrate_alias_unsafe_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
    const admin = new pg.Client({ connectionString: adminConnectionString("postgres") });
    await admin.connect();
    await admin.query(`create database ${dbName}`);

    const connection = await connectDatabase(adminConnectionString(dbName));
    try {
      await applyMigrations(connection.db, migrationsDir, {
        through: "0116_node_write_observation_outcomes.sql",
      });
      await connection.db.query(
        `insert into schema_migrations (name, checksum)
         values ($1, $2)`,
        [
          "0121_classify_nodename_driver_subjects.sql",
          "88f31d34bc6af73ce6b00bfcc320ae1cf24d645d3f32698da2fdcdfef1179d0e",
        ],
      );

      await expect(
        applyMigrations(connection.db, migrationsDir, {
          through: "0122_classify_nodename_driver_subjects.sql",
        }),
      ).rejects.toThrow(/unsafe historical migration.*snapshot.*recovery/i);
    } finally {
      await connection.client.end().catch(() => undefined);
      await admin.query(`drop database if exists ${dbName} with (force)`).catch(() => undefined);
      await admin.end().catch(() => undefined);
    }
  });
});
