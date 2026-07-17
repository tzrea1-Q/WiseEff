/**
 * Post-cutover dashboard/hotspot API integration on a temp PostgreSQL database.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../../shared/database/client";
import { applyMigrations } from "../../../shared/database/migrations";
import { createHttpServer } from "../../../shared/http/server";
import { createRouter } from "../../../shared/http/router";
import {
  createSerializedTestQueryable,
  isTestDatabaseAvailable
} from "../../../testing/testDatabase";
import { requestJson } from "../../../test/testClient";
import type { AuthContext } from "../../auth/types";
import { resetParameterIdentityCutoverCache } from "../cutoverAwareIdentity";
import { registerParameterDashboardRoutes } from "./routes";
import { aggregateHotspotGroups } from "./hotspotRepository";
import {
  applyParameterIdentityCutover,
  migrateParameterIdentities,
  stableSemanticId
} from "../../parameter-topology/migration";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const migrationsDir = path.join(projectRoot, "server", "migrations");

const ORG = "org-pcd-dashboard";
const PROJECT = "project-pcd-dashboard";
const USER = "user-pcd-dashboard";
const CONFIG_SET = "dcs-pcd-dashboard";
const DEF_HIGH = "pd-pcd-high";
const DEF_LOW = "pd-pcd-low";
const PPV_HIGH = "ppv-pcd-high";
const PPV_LOW = "ppv-pcd-low";
const SCHEMA_NS = "ChargingPolicy";
const DRIVER = "sc8562";

const ORG_A = "org-pcd-hotspot-a";
const ORG_B = "org-pcd-hotspot-b";
const USER_A = "user-pcd-hotspot-a";
const USER_B = "user-pcd-hotspot-b";
const PROJECT_A = "project-pcd-hotspot-a";
const PROJECT_B = "project-pcd-hotspot-b";
const CONFIG_SET_A = "dcs-pcd-hotspot-a";
const CONFIG_SET_B = "dcs-pcd-hotspot-b";
const GLOBAL_VENDOR_PROPERTY = "vendor_gpio_int";
const ORG_OWNED_PROPERTY = "org_fast_charge";
const VENDOR_SCHEMA_NS = "VendorGpio";
const GLOBAL_SPEC_ID = stableSemanticId("parameter_spec", ["global", "dts", VENDOR_SCHEMA_NS, GLOBAL_VENDOR_PROPERTY]);

const databaseAvailable = await isTestDatabaseAvailable();
const MAINTENANCE_TOKEN = "test-maintenance-token";
const applyGates = {
  maintenanceToken: MAINTENANCE_TOKEN,
  expectedMaintenanceToken: MAINTENANCE_TOKEN,
  writeLockConfirmed: true as const
};

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
  const dbName = `wiseeff_pcd_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`.replace(
    /[^a-z0-9_]/gi,
    ""
  );
  await withAdminClient(async (admin) => {
    await admin.query(`create database ${dbName}`);
  });

  const connectionString = adminConnectionString(dbName);
  const client = new pg.Client({ connectionString });
  await client.connect();
  const db = createDatabase(
    createSerializedTestQueryable(async (text, values = []) => {
      const result = await client.query(text, values);
      return { rows: result.rows, rowCount: result.rowCount };
    })
  );

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
    user: {
      id: USER,
      organizationId: ORG,
      name: "PCD User",
      email: "pcd@example.com",
      title: "Admin",
      isActive: true
    },
    organization: { id: ORG, name: "PCD Org" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"]
  };
}

function makeDashboardServer(db: Database, auth = makeAuth()) {
  const router = createRouter();
  registerParameterDashboardRoutes(router, {
    db,
    getCurrentAuthContext: () => auth
  });
  return createHttpServer(router);
}

function expectedSpecId(module: string, propertyKey: string) {
  return stableSemanticId("parameter_spec", [ORG, "dts", module, propertyKey]);
}

async function seedPreCutoverDashboardGraph(db: Database) {
  const specHighId = expectedSpecId(SCHEMA_NS, "fast_charge_current");
  const specLowId = expectedSpecId(SCHEMA_NS, "log_level");
  const specVersionHighId = stableSemanticId("parameter_spec_version", [specHighId, "1"]);
  const specVersionLowId = stableSemanticId("parameter_spec_version", [specLowId, "1"]);
  const logicalNodeId = stableSemanticId("dts_logical_node", [PROJECT, CONFIG_SET, "/amba/i2c@FDF5E000/sc8562@6E"]);
  const configRevisionId = "rev-pcd-1";
  const fileId = "file-pcd-1";
  const fileVersionId = "fv-pcd-1";
  const content = `/dts-v1/;
/ {
	amba {
		i2c@FDF5E000 {
			sc8562@6E {
				fast_charge_current = <5000>;
				log_level = <2>;
			};
		};
	};
};
`;
  const checksum = createHash("sha256").update(content, "utf8").digest("hex");

  await db.query(`insert into organizations (id, name) values ($1, 'PCD Org')`, [ORG]);
  await db.query(
    `insert into users (id, organization_id, name, email, title, is_active)
     values ($1, $2, 'PCD User', 'pcd@example.com', 'Admin', true)`,
    [USER, ORG]
  );
  await db.query(
    `insert into projects (id, organization_id, name, code, status)
     values ($1, $2, 'PCD Project', 'PCD', 'initialized')`,
    [PROJECT, ORG]
  );
  await db.query(
    `insert into dts_config_set (id, organization_id, project_id, name, description)
     values ($1, $2, $3, 'pcd-power', 'dashboard')`,
    [CONFIG_SET, ORG, PROJECT]
  );
  await db.query(
    `insert into parameter_specs (id, organization_id, source_kind, specification_key, semantic_module, risk)
     values ($1, $2, 'dts', $3, $4, 'High'),
            ($5, $2, 'dts', $6, $4, 'Low')`,
    [
      specHighId,
      ORG,
      `${SCHEMA_NS}/fast_charge_current`,
      DRIVER,
      specLowId,
      `${SCHEMA_NS}/log_level`
    ]
  );
  await db.query(
    `insert into parameter_spec_versions (
      id, parameter_spec_id, version, display_name, description, value_shape, lifecycle
    ) values ($1, $2, 1, 'fast_charge_current', 'High risk', '{"kind":"cells"}'::jsonb, 'active'),
             ($3, $4, 1, 'log_level', 'Low risk', '{"kind":"cells"}'::jsonb, 'active')`,
    [specVersionHighId, specHighId, specVersionLowId, specLowId]
  );
  await db.query(
    `insert into dts_property_specs (id, parameter_spec_id, property_key, schema_namespace, constraints)
     values ($1, $2, 'fast_charge_current', $3, '{}'::jsonb),
            ($4, $5, 'log_level', $3, '{}'::jsonb)`,
    [
      stableSemanticId("dts_property_spec", [specHighId, "fast_charge_current"]),
      specHighId,
      SCHEMA_NS,
      stableSemanticId("dts_property_spec", [specLowId, "log_level"]),
      specLowId
    ]
  );
  await db.query(
    `insert into project_parameter_files (
      id, organization_id, project_id, file_name, format, enabled,
      config_set_id, config_set_role, config_set_sort_order
    ) values ($1, $2, $3, 'pcd-base.dts', 'dts', true, $4, 'base', 0)`,
    [fileId, ORG, PROJECT, CONFIG_SET]
  );
  await db.query(
    `insert into project_parameter_file_versions (
      id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
    ) values ($1, $2, 1, $3, $4, $5, '{}'::jsonb, 'upload', $6)`,
    [fileVersionId, fileId, `${ORG}/${checksum}-pcd-base.dts`, checksum, Buffer.byteLength(content), USER]
  );
  await db.query(`update project_parameter_files set current_version_id = $1 where id = $2`, [
    fileVersionId,
    fileId
  ]);
  await db.query(
    `insert into dts_config_revisions (
      id, organization_id, project_id, config_set_id, revision_number, status, created_by_user_id
    ) values ($1, $2, $3, $4, 1, 'compiled', $5)`,
    [configRevisionId, ORG, PROJECT, CONFIG_SET, USER]
  );
  await db.query(
    `insert into dts_config_revision_members (
      id, config_revision_id, file_id, file_version_id, role, sort_order
    ) values ($1, $2, $3, $4, 'base', 0)`,
    [`member-${configRevisionId}`, configRevisionId, fileId, fileVersionId]
  );
  await db.query(
    `insert into dts_logical_nodes (id, organization_id, project_id, config_set_id)
     values ($1, $2, $3, $4)`,
    [logicalNodeId, ORG, PROJECT, CONFIG_SET]
  );
  await db.query(
    `insert into dts_logical_node_revisions (
      id, logical_node_id, config_revision_id, node_locator, name, unit_address, parent_logical_node_id
    ) values ($1, $2, $3, '/amba/i2c@FDF5E000/sc8562@6E', 'sc8562', '6E', null)`,
    [`lnr-${logicalNodeId}`, logicalNodeId, configRevisionId]
  );

  await db.query(
    `insert into parameter_definitions (
      id, organization_id, name, description, explanation, config_format,
      module, default_range, unit, risk
    ) values ($1, $2, 'fast_charge_current', 'High risk', 'legacy', 'DTS', $3, '', '', 'High'),
             ($4, $2, 'log_level', 'Low risk', 'legacy', 'DTS', $3, '', '', 'Low')`,
    [DEF_HIGH, ORG, DRIVER, DEF_LOW]
  );
  await db.query(
    `insert into project_parameter_values (
      id, organization_id, project_id, parameter_definition_id,
      current_value, recommended_value, value_version, updated_by_user_id,
      source_file_name, source_node_path
    ) values ($1, $2, $3, $4, '<5000>', '', 1, $5, 'pcd-base.dts', $6),
             ($7, $2, $3, $8, '<2>', '', 1, $5, 'pcd-base.dts', $9)`,
    [
      PPV_HIGH,
      ORG,
      PROJECT,
      DEF_HIGH,
      USER,
      "amba/i2c@FDF5E000/sc8562@6E/fast_charge_current",
      PPV_LOW,
      DEF_LOW,
      "amba/i2c@FDF5E000/sc8562@6E/log_level"
    ]
  );

  const roundId = "round-pcd-1";
  await db.query(
    `insert into parameter_submission_rounds (
      id, organization_id, project_id, submitter_user_id, status, summary
    ) values ($1, $2, $3, $4, 'submitted', 'seed')`,
    [roundId, ORG, PROJECT, USER]
  );
  await db.query(
    `insert into parameter_change_requests (
      id, organization_id, submission_round_id, project_id, project_parameter_value_id,
      parameter_definition_id, base_version, current_value, target_value, status, submitter_user_id
    ) values ($1, $2, $3, $4, $5, $6, 1, '<5000>', '<6000>', 'submitted', $7)`,
    ["cr-pcd-seed", ORG, roundId, PROJECT, PPV_HIGH, DEF_HIGH, USER]
  );
  await db.query(
    `insert into parameter_history_entries (
      id, organization_id, project_id, parameter_definition_id, project_parameter_value_id,
      version, value, changed_by_user_id, request_id, changed_at
    ) values ($1, $2, $3, $4, $5, 1, '<5000>', $6, $7, now() - interval '2 days')`,
    ["hist-pcd-seed", ORG, PROJECT, DEF_HIGH, PPV_HIGH, USER, "cr-pcd-seed"]
  );

  return { specHighId, specLowId };
}

function makeAuthFor(organizationId: string, userId: string, organizationName: string): AuthContext {
  return {
    user: {
      id: userId,
      organizationId,
      name: "Hotspot User",
      email: `${userId}@example.com`,
      title: "Admin",
      isActive: true
    },
    organization: { id: organizationId, name: organizationName },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"]
  };
}


async function bootstrapPostCutoverDatabase(db: Database) {
  await seedPreCutoverDashboardGraph(db);
  const report = await migrateParameterIdentities(db, {
    mode: "apply",
    organizationId: ORG,
    ...applyGates,
    dbSnapshotId: "db-snap-pcd-bootstrap",
    objectSnapshotId: "obj-snap-pcd-bootstrap"
  });
  expect(report.blockers).toEqual([]);
  await applyParameterIdentityCutover(db, { migrationRunId: report.migrationRunId });
  resetParameterIdentityCutoverCache();

  const legacyTables = await db.query(
    `select table_name from information_schema.tables
     where table_schema = 'public'
       and table_name in ('parameter_definitions', 'project_parameter_values')`
  );
  expect(legacyTables.rows).toHaveLength(0);
}

async function seedSemanticHotspotTenantGraph(db: Database) {
  const orgOwnedSpecId = stableSemanticId("parameter_spec", [ORG_A, "dts", SCHEMA_NS, ORG_OWNED_PROPERTY]);
  const orgOwnedSpecVersionId = stableSemanticId("parameter_spec_version", [orgOwnedSpecId, "1"]);
  const globalSpecVersionId = stableSemanticId("parameter_spec_version", [GLOBAL_SPEC_ID, "1"]);
  const logicalNodeA = stableSemanticId("dts_logical_node", [PROJECT_A, CONFIG_SET_A, "/amba/i2c@FDF5E000/sc8562@6E"]);
  const logicalNodeB = stableSemanticId("dts_logical_node", [PROJECT_B, CONFIG_SET_B, "/amba/i2c@FDF5E000/sc8562@6E"]);
  const bindingGlobalA = stableSemanticId("project_parameter_binding", [PROJECT_A, logicalNodeA, GLOBAL_SPEC_ID]);
  const bindingGlobalB = stableSemanticId("project_parameter_binding", [PROJECT_B, logicalNodeB, GLOBAL_SPEC_ID]);
  const bindingOrgOwnedA = stableSemanticId("project_parameter_binding", [PROJECT_A, logicalNodeA, orgOwnedSpecId]);

  await db.query(
    `insert into organizations (id, name) values ($1, 'Hotspot Org A'), ($2, 'Hotspot Org B')
     on conflict (id) do update set name = excluded.name`,
    [ORG_A, ORG_B]
  );
  await db.query(
    `insert into users (id, organization_id, name, email, title, is_active)
     values ($1, $2, 'User A', 'a@example.com', 'Admin', true),
            ($3, $4, 'User B', 'b@example.com', 'Admin', true)`,
    [USER_A, ORG_A, USER_B, ORG_B]
  );
  await db.query(
    `insert into projects (id, organization_id, name, code, status)
     values ($1, $2, 'Project A', 'PRJ-A', 'initialized'),
            ($3, $4, 'Project B', 'PRJ-B', 'initialized')`,
    [PROJECT_A, ORG_A, PROJECT_B, ORG_B]
  );
  await db.query(
    `insert into dts_config_set (id, organization_id, project_id, name, description)
     values ($1, $2, $3, 'cfg-a', 'hotspot-a'),
            ($4, $5, $6, 'cfg-b', 'hotspot-b')`,
    [CONFIG_SET_A, ORG_A, PROJECT_A, CONFIG_SET_B, ORG_B, PROJECT_B]
  );
  await db.query(
    `insert into parameter_specs (id, organization_id, source_kind, specification_key, semantic_module, risk)
     values ($1, null, 'dts', $2, $3, 'Medium'),
            ($4, $5, 'dts', $6, $3, 'High')`,
    [
      GLOBAL_SPEC_ID,
      `${VENDOR_SCHEMA_NS}/${GLOBAL_VENDOR_PROPERTY}`,
      DRIVER,
      orgOwnedSpecId,
      ORG_A,
      `${SCHEMA_NS}/${ORG_OWNED_PROPERTY}`
    ]
  );
  await db.query(
    `insert into parameter_spec_versions (
      id, parameter_spec_id, version, display_name, description, value_shape, lifecycle
    ) values ($1, $2, 1, $3, 'Global vendor spec', '{"kind":"cells"}'::jsonb, 'active'),
             ($4, $5, 1, $6, 'Org-owned spec', '{"kind":"cells"}'::jsonb, 'active')`,
    [
      globalSpecVersionId,
      GLOBAL_SPEC_ID,
      GLOBAL_VENDOR_PROPERTY,
      orgOwnedSpecVersionId,
      orgOwnedSpecId,
      ORG_OWNED_PROPERTY
    ]
  );
  await db.query(
    `insert into dts_property_specs (id, parameter_spec_id, property_key, schema_namespace, constraints)
     values ($1, $2, $3, $4, '{}'::jsonb),
            ($5, $6, $7, $8, '{}'::jsonb)`,
    [
      stableSemanticId("dts_property_spec", [GLOBAL_SPEC_ID, GLOBAL_VENDOR_PROPERTY]),
      GLOBAL_SPEC_ID,
      GLOBAL_VENDOR_PROPERTY,
      VENDOR_SCHEMA_NS,
      stableSemanticId("dts_property_spec", [orgOwnedSpecId, ORG_OWNED_PROPERTY]),
      orgOwnedSpecId,
      ORG_OWNED_PROPERTY,
      SCHEMA_NS
    ]
  );
  await db.query(
    `insert into dts_logical_nodes (id, organization_id, project_id, config_set_id)
     values ($1, $2, $3, $4),
            ($5, $6, $7, $8)`,
    [logicalNodeA, ORG_A, PROJECT_A, CONFIG_SET_A, logicalNodeB, ORG_B, PROJECT_B, CONFIG_SET_B]
  );
  await db.query(
    `insert into project_parameter_bindings (id, organization_id, project_id, logical_node_id, parameter_spec_id)
     values ($1, $2, $3, $4, $5),
            ($6, $7, $8, $9, $5),
            ($10, $2, $3, $4, $11)`,
    [
      bindingGlobalA,
      ORG_A,
      PROJECT_A,
      logicalNodeA,
      GLOBAL_SPEC_ID,
      bindingGlobalB,
      ORG_B,
      PROJECT_B,
      logicalNodeB,
      bindingOrgOwnedA,
      orgOwnedSpecId
    ]
  );

  const roundA = "round-pcd-hotspot-a";
  const roundB = "round-pcd-hotspot-b";
  await db.query(
    `insert into parameter_submission_rounds (id, organization_id, project_id, submitter_user_id, status, summary)
     values ($1, $2, $3, $4, 'submitted', 'hotspot-a'),
            ($5, $6, $7, $8, 'submitted', 'hotspot-b')`,
    [roundA, ORG_A, PROJECT_A, USER_A, roundB, ORG_B, PROJECT_B, USER_B]
  );
  await db.query(
    `insert into parameter_change_requests (
      id, organization_id, submission_round_id, project_id,
      parameter_spec_id, project_parameter_binding_id,
      base_version, current_value, target_value, status, submitter_user_id, created_at
    ) values
      ($1, $2, $3, $4, $5, $6, 1, '<1>', '<2>', 'submitted', $7, now() - interval '3 days'),
      ($8, $2, $3, $4, $9, $10, 1, '<100>', '<110>', 'hardware_review', $7, now() - interval '4 days'),
      ($11, $12, $13, $14, $5, $15, 1, '<1>', '<2>', 'submitted', $16, now() - interval '5 days')`,
    [
      "cr-global-a",
      ORG_A,
      roundA,
      PROJECT_A,
      GLOBAL_SPEC_ID,
      bindingGlobalA,
      USER_A,
      "cr-org-owned-a",
      orgOwnedSpecId,
      bindingOrgOwnedA,
      "cr-global-b",
      ORG_B,
      roundB,
      PROJECT_B,
      bindingGlobalB,
      USER_B
    ]
  );
  await db.query(
    `insert into parameter_history_entries (
      id, organization_id, project_id, parameter_spec_id, project_parameter_binding_id,
      version, value, changed_by_user_id, request_id, changed_at
    ) values
      ($1, $2, $3, $4, $5, 1, '<1>', $6, $7, now() - interval '2 days'),
      ($8, $2, $3, $4, $5, 2, '<2>', $6, null, now() - interval '1 day'),
      ($9, $2, $3, $10, $11, 1, '<100>', $6, $12, now() - interval '2 days'),
      ($13, $14, $15, $4, $16, 1, '<1>', $17, $18, now() - interval '2 days')`,
    [
      "hist-global-a-1",
      ORG_A,
      PROJECT_A,
      GLOBAL_SPEC_ID,
      bindingGlobalA,
      USER_A,
      "cr-global-a",
      "hist-global-a-2",
      "hist-org-owned-a-1",
      orgOwnedSpecId,
      bindingOrgOwnedA,
      "cr-org-owned-a",
      "hist-global-b-1",
      ORG_B,
      PROJECT_B,
      bindingGlobalB,
      USER_B,
      "cr-global-b"
    ]
  );

  return {
    globalSpecId: GLOBAL_SPEC_ID,
    orgOwnedSpecId,
    bindingGlobalA,
    bindingGlobalB,
    bindingOrgOwnedA
  };
}

function hotspotWindowBounds() {
  const windowEnd = new Date();
  windowEnd.setUTCHours(0, 0, 0, 0);
  const windowStart = new Date(windowEnd);
  windowStart.setUTCDate(windowStart.getUTCDate() - 30);
  return {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString()
  };
}

describe.skipIf(!databaseAvailable)("post-cutover dashboard API (temp DB)", () => {
  it(
    "serves /dashboard/summary and /dashboard/hotspots from semantic tables only",
    async () => {
      await withTempDatabase(async (db) => {
        const seeded = await seedPreCutoverDashboardGraph(db);
        const report = await migrateParameterIdentities(db, {
          mode: "apply",
          organizationId: ORG,
          ...applyGates,
          dbSnapshotId: "db-snap-pcd",
          objectSnapshotId: "obj-snap-pcd"
        });
        expect(report.blockers).toEqual([]);

        await db.query(
          `update parameter_specs
           set risk = case id when $1 then 'High' when $2 then 'Low' end,
               semantic_module = $3
           where id in ($1, $2)`,
          [seeded.specHighId, seeded.specLowId, DRIVER]
        );

        await applyParameterIdentityCutover(db, { migrationRunId: report.migrationRunId });
        resetParameterIdentityCutoverCache();

        const legacyTables = await db.query(
          `select table_name from information_schema.tables
           where table_schema = 'public'
             and table_name in ('parameter_definitions', 'project_parameter_values')`
        );
        expect(legacyTables.rows).toHaveLength(0);

        const server = makeDashboardServer(db);
        const summaryResponse = await requestJson<{
          item: {
            kpis: {
              totalParameters: number;
              highRiskParameters: number;
              managedProjects: number;
            };
            riskBuckets: Array<{ high: number; low: number }>;
          };
        }>(server, "/api/v1/parameters/dashboard/summary?window=30d");

        expect(summaryResponse.status).toBe(200);
        expect(summaryResponse.body.item.kpis.totalParameters).toBe(2);
        expect(summaryResponse.body.item.kpis.highRiskParameters).toBe(1);
        expect(summaryResponse.body.item.kpis.managedProjects).toBe(1);
        expect(summaryResponse.body.item.riskBuckets[0]?.high).toBe(1);
        expect(summaryResponse.body.item.riskBuckets[0]?.low).toBe(1);

        const hotspotResponse = await requestJson<{
          items: Array<{ kind: string; title: string; score: number }>;
        }>(server, "/api/v1/parameters/dashboard/hotspots?window=30d&dimension=project");

        expect(hotspotResponse.status).toBe(200);
        expect(hotspotResponse.body.items.length).toBeGreaterThan(0);
        expect(hotspotResponse.body.items[0]?.kind).toBe("project");
        expect(hotspotResponse.body.items[0]?.title).toBe("PCD");
        expect(hotspotResponse.body.items[0]?.score).toBeGreaterThanOrEqual(0);

        const moduleHotspots = await requestJson<{ items: Array<{ kind: string; module: string }> }>(
          server,
          "/api/v1/parameters/dashboard/hotspots?window=30d&dimension=module"
        );
        expect(moduleHotspots.status).toBe(200);
        expect(moduleHotspots.body.items.some((item) => item.module === DRIVER)).toBe(true);
      });
    },
    120_000
  );

  it(
    "includes org-owned and global vendor specs in parameter hotspots via binding tenant scope",
    async () => {
      await withTempDatabase(async (db) => {
        await bootstrapPostCutoverDatabase(db);
        const seeded = await seedSemanticHotspotTenantGraph(db);
        const { windowStart, windowEnd } = hotspotWindowBounds();

        const groups = await aggregateHotspotGroups(db, {
          organizationId: ORG_A,
          projectId: null,
          dimension: "parameter",
          windowStart,
          windowEnd
        });

        const globalGroup = groups.find((group) => group.groupId === seeded.globalSpecId);
        const orgOwnedGroup = groups.find((group) => group.groupId === seeded.orgOwnedSpecId);
        expect(globalGroup?.title).toBe(GLOBAL_VENDOR_PROPERTY);
        expect(orgOwnedGroup?.title).toBe(ORG_OWNED_PROPERTY);
        expect(globalGroup?.relatedRequestCount).toBe(1);
        expect(globalGroup?.historyEventsInWindow).toBe(2);
        expect(globalGroup?.openRequestCount).toBe(1);
        expect(orgOwnedGroup?.relatedRequestCount).toBe(1);
        expect(orgOwnedGroup?.historyEventsInWindow).toBe(1);

        const server = makeDashboardServer(db, makeAuthFor(ORG_A, USER_A, "Hotspot Org A"));
        const hotspotResponse = await requestJson<{
          items: Array<{ id: string; kind: string; title: string; evidence: string[] }>;
        }>(server, "/api/v1/parameters/dashboard/hotspots?window=30d&dimension=parameter");

        expect(hotspotResponse.status).toBe(200);
        const titles = hotspotResponse.body.items.map((item) => item.title);
        expect(titles).toContain(GLOBAL_VENDOR_PROPERTY);
        expect(titles).toContain(ORG_OWNED_PROPERTY);
        const globalHotspot = hotspotResponse.body.items.find(
          (item) => item.id === `parameter:${seeded.globalSpecId}`
        );
        expect(globalHotspot?.evidence.some((line) => line.includes("个项目中修改"))).toBe(true);
      });
    },
    120_000
  );

  it(
    "isolates parameter hotspots across orgs sharing the same global vendor spec",
    async () => {
      await withTempDatabase(async (db) => {
        await bootstrapPostCutoverDatabase(db);
        const seeded = await seedSemanticHotspotTenantGraph(db);
        const { windowStart, windowEnd } = hotspotWindowBounds();

        const orgAGroups = await aggregateHotspotGroups(db, {
          organizationId: ORG_A,
          projectId: null,
          dimension: "parameter",
          windowStart,
          windowEnd
        });
        const orgBGroups = await aggregateHotspotGroups(db, {
          organizationId: ORG_B,
          projectId: null,
          dimension: "parameter",
          windowStart,
          windowEnd
        });

        const globalA = orgAGroups.find((group) => group.groupId === seeded.globalSpecId);
        const globalB = orgBGroups.find((group) => group.groupId === seeded.globalSpecId);
        const orgOwnedB = orgBGroups.find((group) => group.groupId === seeded.orgOwnedSpecId);

        expect(globalA?.parameterCount).toBe(1);
        expect(globalA?.historyEventsInWindow).toBe(2);
        expect(globalA?.relatedRequestCount).toBe(1);
        expect(globalB?.parameterCount).toBe(1);
        expect(globalB?.historyEventsInWindow).toBe(1);
        expect(globalB?.relatedRequestCount).toBe(1);
        expect(orgOwnedB).toBeUndefined();

        const serverA = makeDashboardServer(db, makeAuthFor(ORG_A, USER_A, "Hotspot Org A"));
        const serverB = makeDashboardServer(db, makeAuthFor(ORG_B, USER_B, "Hotspot Org B"));

        const responseA = await requestJson<{
          items: Array<{ id: string; title: string; projectCode: string }>;
        }>(serverA, "/api/v1/parameters/dashboard/hotspots?window=30d&dimension=parameter");
        const responseB = await requestJson<{
          items: Array<{ id: string; title: string; projectCode: string }>;
        }>(serverB, "/api/v1/parameters/dashboard/hotspots?window=30d&dimension=parameter");

        expect(responseA.status).toBe(200);
        expect(responseB.status).toBe(200);
        expect(responseA.body.items.some((item) => item.title === ORG_OWNED_PROPERTY)).toBe(true);
        expect(responseB.body.items.some((item) => item.title === ORG_OWNED_PROPERTY)).toBe(false);

        const globalHotspotA = responseA.body.items.find(
          (item) => item.id === `parameter:${seeded.globalSpecId}`
        );
        const globalHotspotB = responseB.body.items.find(
          (item) => item.id === `parameter:${seeded.globalSpecId}`
        );
        expect(globalHotspotA?.projectCode).toBe("1 个项目");
        expect(globalHotspotB?.projectCode).toBe("1 个项目");
        expect(globalHotspotA?.title).toBe(GLOBAL_VENDOR_PROPERTY);
        expect(globalHotspotB?.title).toBe(GLOBAL_VENDOR_PROPERTY);
      });
    },
    120_000
  );
});
