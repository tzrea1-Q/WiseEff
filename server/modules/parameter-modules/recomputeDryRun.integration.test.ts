/**
 * recomputeBindingModules dry run must have zero side effects.
 *
 * planScopedMoves resolves each binding's module through resolveAttributionModuleForBinding,
 * which materializes auto-discovery driver-group / node-type modules. The dryRun branch used to
 * return inside the transaction (committing those writes); this asserts, against a real database,
 * that a dry run leaves the module set unchanged.
 */
import { describe, expect, it } from "vitest";

import type { Database } from "../../shared/database/client";
import { isTestDatabaseAvailable } from "../../testing/testDatabase";
import { withTempDatabase as withSharedTempDatabase } from "../../testing/tempDatabase";
import type { AuthContext } from "../auth/types";
import { recomputeBindingModules } from "./service";

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

async function withTempDatabase(fn: (db: Database) => Promise<void>) {
  await withSharedTempDatabase({ prefix: "rdr" }, ({ db }) => fn(db));
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
  await db.query(
    `insert into parameter_spec_versions (
       id, parameter_spec_id, version, display_name, description, value_shape, lifecycle, version_status
     ) values ($1, $2, 1, 'gpio_int', 'gpio_int', '{}', 'draft', 'draft')`,
    ["psv-recompute-dryrun", SPEC]
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
  await db.query(
    `insert into project_parameter_binding_revisions (
       id, binding_id, config_revision_id, parameter_spec_version_id, raw_value, typed_value
     ) values ($1, $2, $3, $4, $5, $6::jsonb)`,
    ["br-recompute-dryrun", BINDING, configRevisionId, "psv-recompute-dryrun", "1", "1"]
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
