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
import { isTestDatabaseAvailable } from "../../../testing/testDatabase";
import { requestJson } from "../../../test/testClient";
import type { AuthContext } from "../../auth/types";
import { resetParameterIdentityCutoverCache } from "../cutoverAwareIdentity";
import { registerParameterDashboardRoutes } from "./routes";
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
});
