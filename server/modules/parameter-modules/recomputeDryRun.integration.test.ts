/**
 * recomputeBindingModules dry run must have zero side effects.
 *
 * planScopedMoves resolves each binding's module through resolveAttributionModuleForBinding,
 * which materializes auto-discovery driver-group / node-type modules. The dryRun branch used to
 * return inside the transaction (committing those writes); this asserts, against a real database,
 * that a dry run leaves the module set unchanged.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../shared/database/client";
import { applyMigrations } from "../../shared/database/migrations";
import { isTestDatabaseAvailable } from "../../testing/testDatabase";
import type { AuthContext } from "../auth/types";
import { recomputeBindingModules } from "./service";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const migrationsDir = path.join(projectRoot, "server", "migrations");

const ORG = "org-recompute-dryrun";
const USER = "user-recompute-dryrun";
const PROJECT = "project-recompute-dryrun";
const CONFIG_SET = "dcs-recompute-dryrun";
const SPEC = "pspec-recompute-dryrun";
const NODE = "ln-recompute-dryrun";
const NODE_LOCATOR = "/amba/i2c@FDF5E000/sc8562@6E";
const UNCLASSIFIED = "mod-recompute-unclassified";
const BINDING = "binding-recompute-dryrun";

const databaseAvailable = await isTestDatabaseAvailable();

function resolveTestDatabaseUrl() {
  return (
    process.env.TEST_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    "postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff"
  );
}
function adminConnectionString(database = "postgres") {
  const url = new URL(resolveTestDatabaseUrl());
  url.pathname = `/${database}`;
  return url.toString();
}
async function withAdminClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: adminConnectionString("postgres") });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
async function withTempDatabase(fn: (db: Database) => Promise<void>) {
  const dbName = `wiseeff_rdr_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`.replace(/[^a-z0-9_]/gi, "");
  await withAdminClient(async (admin) => {
    await admin.query(`create database ${dbName}`);
  });
  const client = new pg.Client({ connectionString: adminConnectionString(dbName) });
  await client.connect();
  const db = createDatabase({
    query: async (text, values = []) => {
      const result = await client.query(text, values);
      return { rows: result.rows, rowCount: result.rowCount };
    }
  });
  try {
    await applyMigrations(db, migrationsDir);
    await fn(db);
  } finally {
    await client.end().catch(() => undefined);
    await withAdminClient(async (admin) => {
      await admin.query(`drop database if exists ${dbName} with (force)`);
    });
  }
}

function makeAuth(): AuthContext {
  return {
    user: { id: USER, organizationId: ORG, name: "RDR", email: "rdr@example.com", title: "Admin", isActive: true },
    organization: { id: ORG, name: "RDR Org" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "parameter:edit", "admin:access"]
  };
}

/** An unclassified-parked binding whose compatible would materialize a driver-group module on recompute. */
async function seedUnattributedBinding(db: Database) {
  await db.query(`insert into organizations (id, name) values ($1, 'RDR Org')`, [ORG]);
  await db.query(
    `insert into users (id, organization_id, name, email, title, is_active)
     values ($1, $2, 'RDR', 'rdr@example.com', 'Admin', true)`,
    [USER, ORG]
  );
  await db.query(
    `insert into projects (id, organization_id, name, code, status)
     values ($1, $2, 'RDR Project', 'RDR', 'initialized')`,
    [PROJECT, ORG]
  );
  await db.query(
    `insert into dts_config_set (id, organization_id, project_id, name, description)
     values ($1, $2, $3, 'rdr', 'rdr')`,
    [CONFIG_SET, ORG, PROJECT]
  );
  await db.query(
    `insert into parameter_specs (id, organization_id, source_kind, specification_key)
     values ($1, $2, 'dts', 'sc8562/gpio_int')`,
    [SPEC, ORG]
  );
  const configRevisionId = "rev-recompute-dryrun";
  await db.query(
    `insert into dts_config_revisions (
      id, organization_id, project_id, config_set_id, revision_number, status, created_by_user_id,
      entry_file, include_search_paths, overlay_order, manifest_state
    ) values ($1, $2, $3, $4, 1, 'compiled', $5, 'rdr.dts', '["."]'::jsonb, '[]'::jsonb, 'complete')`,
    [configRevisionId, ORG, PROJECT, CONFIG_SET, USER]
  );
  await db.query(
    `insert into dts_logical_nodes (id, organization_id, project_id, config_set_id) values ($1, $2, $3, $4)`,
    [NODE, ORG, PROJECT, CONFIG_SET]
  );
  await db.query(
    `insert into dts_logical_node_revisions (
      id, logical_node_id, config_revision_id, node_locator, name, unit_address, compatible, parent_logical_node_id
    ) values ($1, $2, $3, $4, 'sc8562', '6E', 'vendor,sc8562', null)`,
    [`lnr-${NODE}`, NODE, configRevisionId, NODE_LOCATOR]
  );
  await db.query(
    `insert into parameter_modules (id, organization_id, name, path, depth, kind, origin, parent_id, sort_order)
     values ($1, $2, 'Unclassified', 'Unclassified', 0, 'unclassified', 'auto', null, 0)`,
    [UNCLASSIFIED, ORG]
  );
  await db.query(
    `insert into project_parameter_bindings (id, organization_id, project_id, parameter_spec_id, module_id, logical_node_id)
     values ($1, $2, $3, $4, $5, $6)`,
    [BINDING, ORG, PROJECT, SPEC, UNCLASSIFIED, NODE]
  );
}

async function moduleCount(db: Database) {
  const result = await db.query<{ c: string }>(
    `select count(*)::text as c from parameter_modules where organization_id = $1`,
    [ORG]
  );
  return Number(result.rows[0]?.c ?? "0");
}

describe.skipIf(!databaseAvailable)("recomputeBindingModules dry run", () => {
  it(
    "does not materialize modules on dryRun (auto-discovery writes are rolled back)",
    async () => {
      await withTempDatabase(async (db) => {
        await seedUnattributedBinding(db);
        const before = await moduleCount(db);

        const result = await recomputeBindingModules(db, makeAuth(), { dryRun: true });

        expect(result.dryRun).toBe(true);
        // The binding would move off the unclassified root, so the preview is non-trivial...
        expect(result.updated).toBeGreaterThanOrEqual(1);
        // ...but nothing is persisted: the driver-group/node-type modules that planScopedMoves
        // materialized inside the transaction are rolled back.
        expect(await moduleCount(db)).toBe(before);
      });
    },
    120_000
  );
});
