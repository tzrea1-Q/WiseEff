import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../shared/database/client";
import { applyMigrations } from "../../shared/database/migrations";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import {
  applyParameterIdentityCutover,
  checkParameterIdentityCutover,
  migrateParameterIdentities,
  stableSemanticId,
  type ParameterIdentityMigrationReport
} from "./migration";
import { resetParameterIdentityCutoverCache } from "../parameters/cutoverAwareIdentity";
import { listParameters, listChangeRequests } from "../parameters/repository";
import { ApiError } from "../../shared/http/errors";


const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cutoverSqlPath = path.join(
  projectRoot,
  "server",
  "cutovers",
  "2026-07-16-parameter-identity-cutover.sql"
);
const migrationsDir = path.join(projectRoot, "server", "migrations");

const ORG = "org-mig-14";
const PROJECT = "project-mig-14";
const USER = "user-mig-14";
const CONFIG_SET = "dcs-mig-14";
const DEF_ID = "pd-mig-gpio-int";
const PPV_ID = "ppv-mig-gpio-int";
const SCHEMA_NS = "vendor";
const PROPERTY_KEY = "gpio_int";
const DRIVER = "sc8562";
const NODE_LOCATOR = "/amba/i2c@FDF5E000/sc8562@6E";
const SOURCE_NODE_PATH = "amba/i2c@FDF5E000/sc8562@6E/gpio_int";

const databaseAvailable = await isTestDatabaseAvailable();

const MAINTENANCE_TOKEN = "test-maintenance-token";

const applyGates = {
  maintenanceToken: MAINTENANCE_TOKEN,
  expectedMaintenanceToken: MAINTENANCE_TOKEN,
  writeLockConfirmed: true as const
};

function expectedSpecId() {
  return stableSemanticId("parameter_spec", [ORG, "dts", SCHEMA_NS, PROPERTY_KEY]);
}

function expectedSpecVersionId(specId: string) {
  return stableSemanticId("parameter_spec_version", [specId, "1"]);
}

function expectedLogicalNodeId() {
  return stableSemanticId("dts_logical_node", [PROJECT, CONFIG_SET, NODE_LOCATOR]);
}

function expectedBindingId(specId: string, logicalNodeId: string) {
  return stableSemanticId("project_parameter_binding", [PROJECT, logicalNodeId, specId]);
}

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
  const dbName = `wiseeff_mig14_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`.replace(
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

function openDatabaseConnection(connectionString: string): {
  db: Database;
  close: () => Promise<void>;
} {
  const client = new pg.Client({ connectionString });
  let connected = false;
  const db = createDatabase({
    query: async (text, values = []) => {
      if (!connected) {
        await client.connect();
        connected = true;
      }
      const result = await client.query(text, values);
      return { rows: result.rows, rowCount: result.rowCount };
    }
  });
  return {
    db,
    close: async () => {
      if (connected) {
        await client.end().catch(() => undefined);
      }
    }
  };
}

async function withTempDatabaseConnection(
  fn: (ctx: { db: Database; connectionString: string }) => Promise<void>
) {
  const dbName = `wiseeff_mig14_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`.replace(
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
    await fn({ db, connectionString });
  } finally {
    await client.end().catch(() => undefined);
    await withAdminClient(async (admin) => {
      await admin.query(`drop database if exists ${dbName} with (force)`);
    });
  }
}

async function seedLegacyGraph(db: InMemoryTestDatabase | Database) {
  const specId = expectedSpecId();
  const specVersionId = expectedSpecVersionId(specId);
  const logicalNodeId = expectedLogicalNodeId();
  const propertySpecId = stableSemanticId("dts_property_spec", [specId, PROPERTY_KEY]);
  const configRevisionId = "rev-mig-14-1";
  const fileId = "file-mig-14";
  const fileVersionId = "fv-mig-14";
  const content = `/dts-v1/;
/ {
	amba {
		i2c@FDF5E000 {
			sc8562@6E {
				gpio_int = <1>;
			};
		};
	};
};
`;
  const checksum = createHash("sha256").update(content, "utf8").digest("hex");

  await db.query(
    `insert into organizations (id, name) values ($1, 'Mig Org')
     on conflict (id) do update set name = excluded.name`,
    [ORG]
  );
  await db.query(
    `
    insert into users (id, organization_id, name, email, title, is_active)
    values ($1, $2, 'Mig User', 'mig14@example.com', 'Admin', true)
    on conflict (id) do update set organization_id = excluded.organization_id
    `,
    [USER, ORG]
  );
  await db.query(
    `
    insert into projects (id, organization_id, name, code, status)
    values ($1, $2, 'Mig Project', 'MIG14', 'initialized')
    on conflict (id) do update set name = excluded.name
    `,
    [PROJECT, ORG]
  );
  await db.query(
    `
    insert into dts_config_set (id, organization_id, project_id, name, description)
    values ($1, $2, $3, 'mig-power', 'Task 14 fixture')
    on conflict (id) do update set name = excluded.name
    `,
    [CONFIG_SET, ORG, PROJECT]
  );

  // Curated schema catalog (example_value only; never from recommended_value).
  await db.query(
    `
    insert into parameter_specs (id, organization_id, source_kind, specification_key)
    values ($1, $2, 'dts', $3)
    on conflict (id) do nothing
    `,
    [specId, ORG, `${DRIVER}/${PROPERTY_KEY}`]
  );
  await db.query(
    `
    insert into parameter_spec_versions (
      id, parameter_spec_id, version, display_name, description, value_shape,
      schema_default, example_value, lifecycle
    ) values (
      $1, $2, 1, 'gpio_int', 'GPIO interrupt',
      '{"kind":"cells","bits":32}'::jsonb,
      null,
      '{"kind":"cells","bits":32,"groups":[[{"kind":"integer","raw":"0","value":"0"}]]}'::jsonb,
      'active'
    )
    on conflict (id) do nothing
    `,
    [specVersionId, specId]
  );
  await db.query(
    `
    insert into dts_property_specs (
      id, parameter_spec_id, property_key, schema_namespace, constraints
    ) values ($1, $2, $3, $4, '{}'::jsonb)
    on conflict (id) do nothing
    `,
    [propertySpecId, specId, PROPERTY_KEY, SCHEMA_NS]
  );

  await db.query(
    `
    insert into project_parameter_files (
      id, organization_id, project_id, file_name, format, enabled,
      config_set_id, config_set_role, config_set_sort_order
    ) values ($1, $2, $3, 'mig-base.dts', 'dts', true, $4, 'base', 0)
    on conflict (id) do nothing
    `,
    [fileId, ORG, PROJECT, CONFIG_SET]
  );
  await db.query(
    `
    insert into project_parameter_file_versions (
      id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
    ) values ($1, $2, 1, $3, $4, $5, '{}'::jsonb, 'upload', $6)
    on conflict (id) do nothing
    `,
    [fileVersionId, fileId, `${ORG}/${checksum}-mig-base.dts`, checksum, Buffer.byteLength(content), USER]
  );
  await db.query(`update project_parameter_files set current_version_id = $1 where id = $2`, [
    fileVersionId,
    fileId
  ]);

  await db.query(
    `
    insert into dts_config_revisions (
      id, organization_id, project_id, config_set_id, revision_number, status, created_by_user_id
    ) values ($1, $2, $3, $4, 1, 'compiled', $5)
    on conflict (id) do nothing
    `,
    [configRevisionId, ORG, PROJECT, CONFIG_SET, USER]
  );
  await db.query(
    `
    insert into dts_config_revision_members (
      id, config_revision_id, file_id, file_version_id, role, sort_order
    ) values ($1, $2, $3, $4, 'base', 0)
    on conflict (id) do nothing
    `,
    [`member-${configRevisionId}`, configRevisionId, fileId, fileVersionId]
  );
  await db.query(
    `
    insert into dts_logical_nodes (id, organization_id, project_id, config_set_id)
    values ($1, $2, $3, $4)
    on conflict (id) do nothing
    `,
    [logicalNodeId, ORG, PROJECT, CONFIG_SET]
  );
  await db.query(
    `
    insert into dts_logical_node_revisions (
      id, logical_node_id, config_revision_id, node_locator, name, unit_address, parent_logical_node_id
    ) values ($1, $2, $3, $4, 'sc8562', '6E', null)
    on conflict (id) do nothing
    `,
    [`lnr-${logicalNodeId}`, logicalNodeId, configRevisionId, NODE_LOCATOR]
  );

  await db.query(
    `
    insert into dts_release_baseline (
      id, organization_id, config_set_id, name, notes, status, created_by_user_id
    ) values ($1, $2, $3, 'mig-baseline', 'Task 14 baseline', 'released', $4)
    on conflict (id) do nothing
    `,
    ["baseline-mig-14", ORG, CONFIG_SET, USER]
  );
  await db.query(
    `
    insert into dts_release_baseline_members (
      id, baseline_id, file_id, file_version_id, version_number
    ) values ($1, $2, $3, $4, 1)
    on conflict (id) do nothing
    `,
    ["baseline-member-mig-14", "baseline-mig-14", fileId, fileVersionId]
  );

  await db.query(
    `
    insert into parameter_definitions (
      id, organization_id, name, description, explanation, config_format,
      module, default_range, unit, risk
    ) values (
      $1, $2, $3, 'GPIO interrupt', 'legacy full name path', 'DTS',
      $4, '', '', 'Low'
    ) on conflict (id) do update set name = excluded.name, module = excluded.module
    `,
    [DEF_ID, ORG, PROPERTY_KEY, DRIVER]
  );
  await db.query(
    `
    insert into project_parameter_values (
      id, organization_id, project_id, parameter_definition_id,
      current_value, recommended_value, value_version, updated_by_user_id,
      source_file_name, source_node_path
    ) values (
      $1, $2, $3, $4,
      '<1>', '<9>', 2, $5,
      'mig-base.dts', $6
    ) on conflict (id) do update set
      current_value = excluded.current_value,
      recommended_value = excluded.recommended_value,
      source_node_path = excluded.source_node_path
    `,
    [PPV_ID, ORG, PROJECT, DEF_ID, USER, SOURCE_NODE_PATH]
  );

  const openCrId = "cr-mig-open";
  const closedCrId = "cr-mig-closed";
  const roundId = "round-mig-14";
  const draftId = "draft-ui-mig-14";
  const historyId = "hist-mig-14";
  const conflictId = "conflict-mig-14";
  const auditId = "audit-mig-14";
  const debugParamId = "debug-param-mig-14";
  const deviceId = "device-mig-14";
  const targetId = "target-mig-14";
  const sessionId = "session-mig-14";
  const opId = "op-mig-14";

  await db.query(
    `
    insert into parameter_submission_rounds (
      id, organization_id, project_id, submitter_user_id, status, summary
    ) values ($1, $2, $3, $4, 'submitted', 'mig round')
    on conflict (id) do nothing
    `,
    [roundId, ORG, PROJECT, USER]
  );

  await db.query(
    `
    insert into parameter_change_requests (
      id, organization_id, submission_round_id, project_id, project_parameter_value_id,
      parameter_definition_id, base_version, current_value, target_value, status,
      submitter_user_id
    ) values
      ($1, $2, $3, $4, $5, $6, 1, '<1>', '<2>', 'pending_review', $7),
      ($8, $2, $3, $4, $5, $6, 1, '<0>', '<1>', 'merged', $7)
    on conflict (id) do nothing
    `,
    [openCrId, ORG, roundId, PROJECT, PPV_ID, DEF_ID, USER, closedCrId]
  );

  await db.query(
    `
    insert into parameter_submission_items (
      id, organization_id, submission_round_id, change_request_id,
      project_parameter_value_id, current_value, target_value, reason
    ) values ($1, $2, $3, $4, $5, '<1>', '<2>', 'submit item')
    on conflict (id) do nothing
    `,
    ["item-mig-14", ORG, roundId, openCrId, PPV_ID]
  );

  await db.query(
    `
    insert into parameter_review_decisions (
      id, organization_id, request_id, reviewer_user_id, decision, from_status, to_status, note
    ) values ($1, $2, $3, $4, 'approve', 'pending_review', 'merged', 'ok')
    on conflict (id) do nothing
    `,
    ["decision-mig-14", ORG, closedCrId, USER]
  );

  await db.query(
    `
    insert into parameter_history_entries (
      id, organization_id, project_id, parameter_definition_id, project_parameter_value_id,
      version, value, changed_by_user_id, request_id
    ) values ($1, $2, $3, $4, $5, 1, '<1>', $6, $7)
    on conflict (id) do nothing
    `,
    [historyId, ORG, PROJECT, DEF_ID, PPV_ID, USER, closedCrId]
  );

  const fileDraftId = "draft-file-mig-14";
  const fileUser = "user-mig-14-file";
  await db.query(
    `
    insert into users (id, organization_id, name, email, title, is_active)
    values ($1, $2, 'Mig File User', 'mig14-file@example.com', 'Engineer', true)
    on conflict (id) do update set organization_id = excluded.organization_id
    `,
    [fileUser, ORG]
  );
  await db.query(
    `
    insert into parameter_drafts (
      id, organization_id, project_id, project_parameter_value_id, user_id, target_value, reason, origin
    ) values
      ($1, $2, $3, $4, $5, '<3>', 'file draft', 'file_sync'),
      ($6, $2, $3, $4, $7, '<4>', 'ui draft', 'manual')
    on conflict (id) do nothing
    `,
    [fileDraftId, ORG, PROJECT, PPV_ID, fileUser, draftId, USER]
  );
  await db.query(
    `
    insert into parameter_file_sync_conflicts (
      id, organization_id, project_id, project_parameter_value_id, parameter_definition_id,
      file_version_id, file_draft_id, ui_draft_id, file_value, ui_draft_value, status
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, '<3>', '<4>', 'open')
    on conflict (id) do nothing
    `,
    [conflictId, ORG, PROJECT, PPV_ID, DEF_ID, fileVersionId, fileDraftId, draftId]
  );

  await db.query(
    `
    insert into audit_events (
      id, organization_id, project_id, actor_user_id, actor_type, app,
      kind, action, severity, target_type, target_id, metadata, trace_id
    ) values (
      $1, $2, $3, $4, 'user', 'wiseeff',
      'parameter', 'update', 'info', 'parameter_definition', $5, $6::jsonb, $7
    )
    on conflict (id) do nothing
    `,
    [
      auditId,
      ORG,
      PROJECT,
      USER,
      DEF_ID,
      JSON.stringify({ legacyParameterDefinitionId: DEF_ID, note: "immutable payload" }),
      "trace-mig-14"
    ]
  );

  await db.query(
    `
    insert into debugging_parameters (
      id, organization_id, name, key, description, module, node_path, access_mode,
      unit, range_label, risk, current_value, target_value, sort_order, parameter_definition_id
    ) values (
      $1, $2, 'gpio_int', 'gpio_int', 'debug gpio', $3, $4, 'RW',
      '', '', 'Low', '1', '1', 0, $5
    ) on conflict (id) do nothing
    `,
    [debugParamId, ORG, DRIVER, SOURCE_NODE_PATH, DEF_ID]
  );

  await db.query(
    `
    insert into debugging_devices (
      id, organization_id, name, transport, status, firmware
    ) values ($1, $2, 'dev', 'hdc', 'online', '1.0')
    on conflict (id) do nothing
    `,
    [deviceId, ORG]
  );
  await db.query(
    `
    insert into debugging_targets (
      id, organization_id, device_id, protocol, target_ref, label, status
    ) values ($1, $2, $3, 'hdc', 't1', 'target', 'ready')
    on conflict (id) do nothing
    `,
    [targetId, ORG, deviceId]
  );
  await db.query(
    `
    insert into debugging_sessions (
      id, organization_id, device_id, target_id, protocol, execution_mode,
      session_kind, actor_user_id, status
    ) values ($1, $2, $3, $4, 'hdc', 'local', 'node', $5, 'active')
    on conflict (id) do nothing
    `,
    [sessionId, ORG, deviceId, targetId, USER]
  );
  const debugNodeId = "debug-node-mig-14";
  await db.query(
    `
    insert into debug_nodes (
      id, organization_id, name, description, enabled
    ) values ($1, $2, 'gpio_int', 'mig debug node', true)
    on conflict (id) do nothing
    `,
    [debugNodeId, ORG]
  );
  await db.query(
    `
    insert into node_operations (
      id, organization_id, session_id, parameter_id, node_id, parameter_definition_id,
      protocol, node_path, operation_type, status, actor_user_id
    ) values ($1, $2, $3, $4, $5, $6, 'hdc', $7, 'read', 'succeeded', $8)
    on conflict (id) do nothing
    `,
    [opId, ORG, sessionId, debugParamId, debugNodeId, DEF_ID, SOURCE_NODE_PATH, USER]
  );

  return {
    expectedDefinitions: 1,
    expectedValues: 1,
    specId,
    specVersionId,
    logicalNodeId,
    bindingId: expectedBindingId(specId, logicalNodeId),
    configRevisionId,
    auditId,
    openCrId,
    closedCrId,
    historyId,
    draftId,
    conflictId,
    debugParamId,
    opId
  };
}

describe("stableSemanticId", () => {
  it("builds deterministic UUID-shaped ids from kind and parts", () => {
    const a = stableSemanticId("parameter_spec", [ORG, "dts", SCHEMA_NS, PROPERTY_KEY]);
    const b = stableSemanticId("parameter_spec", [ORG, "dts", SCHEMA_NS, PROPERTY_KEY]);
    expect(a).toBe(b);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/
    );
    // Spec parts must never include a project path.
    const withPath = stableSemanticId("parameter_spec", [
      ORG,
      "dts",
      SCHEMA_NS,
      "amba/i2c@FDF5E000/sc8562@6E/gpio_int"
    ]);
    expect(withPath).not.toBe(a);
  });
});

describe.skipIf(!databaseAvailable)("parameter identity migration", () => {
  let db: InMemoryTestDatabase | undefined;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
  });

  afterEach(async () => {
    await db?.rollback();
  });

  it("dry-run maps every seeded legacy record with zero blockers", async () => {
    const seeded = await seedLegacyGraph(db!);
    const report = await migrateParameterIdentities(db!, {
      mode: "dry-run",
      organizationId: ORG
    });

    expect(report).toMatchObject({
      legacyDefinitions: seeded.expectedDefinitions,
      mappedDefinitions: seeded.expectedDefinitions,
      exactMatched: seeded.expectedDefinitions,
      reviewedMatched: 0,
      inferredPendingReview: 0,
      legacyProjectValues: seeded.expectedValues,
      mappedProjectValues: seeded.expectedValues,
      unmappedRecords: 0,
      ambiguousRecords: 0,
      brokenHistoryChains: 0
    } satisfies Partial<ParameterIdentityMigrationReport>);

    expect(report.blockers).toEqual([]);
    expect(report.coverage.history).toBe(1);
    expect(report.coverage.drafts).toBeGreaterThanOrEqual(1);
    expect(report.coverage.changeRequests).toBe(2);
    expect(report.coverage.submissionItems).toBe(1);
    expect(report.coverage.decisions).toBe(1);
    expect(report.coverage.fileConflicts).toBe(1);
    expect(report.coverage.baselines).toBe(1);
    expect(report.coverage.debugReferences).toBeGreaterThanOrEqual(2);
    expect(report.coverage.auditLinks).toBe(1);
  });

  it("dry-run is read-only: no DDL/DML side effects on migration tables or evidence", async () => {
    await seedLegacyGraph(db!);
    const beforeEvidence = await db!.query<{ c: string }>(
      `select count(*)::text as c from legacy_parameter_migration_evidence`
    );
    const beforeRuns = await db!.query<{ c: string }>(
      `select count(*)::text as c from parameter_identity_migration_runs`
    );
    const beforeBindings = await db!.query<{ c: string }>(
      `select count(*)::text as c from project_parameter_bindings where project_id = $1`,
      [PROJECT]
    );

    const report = await migrateParameterIdentities(db!, {
      mode: "dry-run",
      organizationId: ORG
    });
    expect(report.mappedDefinitions).toBeGreaterThan(0);

    const afterEvidence = await db!.query<{ c: string }>(
      `select count(*)::text as c from legacy_parameter_migration_evidence`
    );
    const afterRuns = await db!.query<{ c: string }>(
      `select count(*)::text as c from parameter_identity_migration_runs`
    );
    const afterBindings = await db!.query<{ c: string }>(
      `select count(*)::text as c from project_parameter_bindings where project_id = $1`,
      [PROJECT]
    );
    expect(afterEvidence.rows[0]?.c).toBe(beforeEvidence.rows[0]?.c);
    expect(afterRuns.rows[0]?.c).toBe(beforeRuns.rows[0]?.c);
    expect(afterBindings.rows[0]?.c).toBe(beforeBindings.rows[0]?.c);
  });

  it("checker surfaces SQL failures instead of swallowing them as zero", async () => {
    const brokenDb = {
      query: async (text: string) => {
        if (/parameter_identity_migration_runs|parameter_identity_cutovers|parameter_identity_migration_phases/i.test(text) && /information_schema/i.test(text)) {
          return {
            rows: [
              { name: "parameter_identity_migration_runs" },
              { name: "parameter_identity_migration_phases" },
              { name: "parameter_identity_cutovers" }
            ]
          };
        }
        if (/from parameter_definitions/i.test(text)) {
          throw new Error('relation "parameter_definitions" does not exist');
        }
        if (/identity_mapping_tasks/i.test(text)) {
          return { rows: [{ c: "0" }] };
        }
        if (/parameter_history_entries/i.test(text)) {
          throw new Error("permission denied for table parameter_history_entries");
        }
        if (/parameter_identity_cutovers/i.test(text) || /parameter_identity_migration_runs/i.test(text)) {
          return { rows: [{ c: "0" }] };
        }
        if (/pg_constraint/i.test(text)) {
          return { rows: [{ c: "0" }] };
        }
        return { rows: [] };
      }
    };

    const result = await checkParameterIdentityCutover(brokenDb as never);
    expect(result.ok).toBe(false);
    expect(result.blockers.some((b) => /permission denied/i.test(b))).toBe(true);
  });

  it("apply writes evidence, semantic FKs, and audit links without promoting recommended_value", async () => {
    const seeded = await seedLegacyGraph(db!);
    const report = await migrateParameterIdentities(db!, {
      mode: "apply",
      organizationId: ORG,
      ...applyGates,
      dbSnapshotId: "db-snap-1",
      objectSnapshotId: "obj-snap-1"
    });

    expect(report.unmappedRecords).toBe(0);
    expect(report.ambiguousRecords).toBe(0);
    expect(report.brokenHistoryChains).toBe(0);

    const evidence = await db!.query<{
      legacy_id: string;
      legacy_name: string | null;
      legacy_path: string | null;
      legacy_current_value: string | null;
      legacy_recommended_value: string | null;
      legacy_row_hash: string | null;
      parameter_spec_id: string | null;
      project_parameter_binding_id: string | null;
    }>(
      `
      select legacy_id, legacy_name, legacy_path, legacy_current_value, legacy_recommended_value,
             legacy_row_hash, parameter_spec_id, project_parameter_binding_id
      from legacy_parameter_migration_evidence
      where legacy_kind = 'project_parameter_value' and legacy_id = $1
      `,
      [PPV_ID]
    );
    expect(evidence.rows).toHaveLength(1);
    expect(evidence.rows[0]).toMatchObject({
      legacy_id: PPV_ID,
      legacy_path: SOURCE_NODE_PATH,
      legacy_current_value: "<1>",
      legacy_recommended_value: "<9>",
      parameter_spec_id: seeded.specId,
      project_parameter_binding_id: seeded.bindingId
    });
    expect(evidence.rows[0]?.legacy_row_hash).toBeTruthy();

    const specVersion = await db!.query<{ schema_default: unknown; example_value: unknown }>(
      `select schema_default, example_value from parameter_spec_versions where id = $1`,
      [seeded.specVersionId]
    );
    expect(specVersion.rows[0]?.schema_default).toBeNull();
    expect(specVersion.rows[0]?.example_value).not.toEqual("<9>");

    const policy = await db!.query(
      `select id from parameter_policy_targets where parameter_spec_id = $1`,
      [seeded.specId]
    );
    expect(policy.rows).toHaveLength(0);

    const history = await db!.query<{
      parameter_spec_id: string | null;
      project_parameter_binding_id: string | null;
    }>(`select parameter_spec_id, project_parameter_binding_id from parameter_history_entries where id = $1`, [
      seeded.historyId
    ]);
    expect(history.rows[0]).toEqual({
      parameter_spec_id: seeded.specId,
      project_parameter_binding_id: seeded.bindingId
    });

    const drafts = await db!.query<{ c: string }>(
      `select count(*)::text as c from parameter_drafts
       where project_parameter_value_id = $1 and project_parameter_binding_id = $2`,
      [PPV_ID, seeded.bindingId]
    );
    expect(Number(drafts.rows[0]?.c)).toBeGreaterThanOrEqual(1);

    const crs = await db!.query<{ c: string }>(
      `select count(*)::text as c from parameter_change_requests
       where parameter_definition_id = $1
         and parameter_spec_id = $2
         and project_parameter_binding_id = $3`,
      [DEF_ID, seeded.specId, seeded.bindingId]
    );
    expect(Number(crs.rows[0]?.c)).toBe(2);

    const items = await db!.query<{ c: string }>(
      `select count(*)::text as c from parameter_submission_items
       where project_parameter_binding_id = $1`,
      [seeded.bindingId]
    );
    expect(Number(items.rows[0]?.c)).toBe(1);

    const conflicts = await db!.query<{
      parameter_spec_id: string | null;
      project_parameter_binding_id: string | null;
    }>(
      `select parameter_spec_id, project_parameter_binding_id from parameter_file_sync_conflicts where id = $1`,
      [seeded.conflictId]
    );
    expect(conflicts.rows[0]).toEqual({
      parameter_spec_id: seeded.specId,
      project_parameter_binding_id: seeded.bindingId
    });

    const bindingRev = await db!.query<{ c: string }>(
      `select count(*)::text as c from project_parameter_binding_revisions
       where binding_id = $1 and config_revision_id = $2`,
      [seeded.bindingId, seeded.configRevisionId]
    );
    expect(Number(bindingRev.rows[0]?.c)).toBe(1);

    const debug = await db!.query<{
      parameter_spec_id: string | null;
      project_parameter_binding_id: string | null;
    }>(
      `select parameter_spec_id, project_parameter_binding_id from debugging_parameters where id = $1`,
      [seeded.debugParamId]
    );
    expect(debug.rows[0]).toEqual({
      parameter_spec_id: seeded.specId,
      project_parameter_binding_id: seeded.bindingId
    });

    const ops = await db!.query<{
      parameter_spec_id: string | null;
      project_parameter_binding_id: string | null;
    }>(`select parameter_spec_id, project_parameter_binding_id from node_operations where id = $1`, [
      seeded.opId
    ]);
    expect(ops.rows[0]).toEqual({
      parameter_spec_id: seeded.specId,
      project_parameter_binding_id: seeded.bindingId
    });

    const auditPayload = await db!.query<{ metadata: unknown }>(
      `select metadata from audit_events where id = $1`,
      [seeded.auditId]
    );
    expect(auditPayload.rows[0]?.metadata).toEqual({
      legacyParameterDefinitionId: DEF_ID,
      note: "immutable payload"
    });

    const links = await db!.query<{ semantic_id: string; legacy_id: string | null }>(
      `select semantic_id, legacy_id from audit_subject_links where audit_event_id = $1`,
      [seeded.auditId]
    );
    expect(links.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          semantic_id: seeded.bindingId,
          legacy_id: DEF_ID
        })
      ])
    );
  });

  it("rejects apply without maintenance gates", async () => {
    await seedLegacyGraph(db!);
    await expect(
      migrateParameterIdentities(db!, {
        mode: "apply",
        organizationId: ORG,
        maintenanceToken: MAINTENANCE_TOKEN,
        expectedMaintenanceToken: MAINTENANCE_TOKEN,
        writeLockConfirmed: false
      })
    ).rejects.toThrow(/write lock|maintenance|snapshot/i);
  });

  it("rejects apply when maintenance token is not configured", async () => {
    await seedLegacyGraph(db!);
    const previous = process.env.PARAMETER_IDENTITY_MAINTENANCE_TOKEN;
    delete process.env.PARAMETER_IDENTITY_MAINTENANCE_TOKEN;
    try {
      await expect(
        migrateParameterIdentities(db!, {
          mode: "apply",
          organizationId: ORG,
          maintenanceToken: MAINTENANCE_TOKEN,
          writeLockConfirmed: true,
          dbSnapshotId: "db-snap",
          objectSnapshotId: "obj-snap"
        })
      ).rejects.toThrow(/PARAMETER_IDENTITY_MAINTENANCE_TOKEN|expectedMaintenanceToken/i);
    } finally {
      if (previous === undefined) {
        delete process.env.PARAMETER_IDENTITY_MAINTENANCE_TOKEN;
      } else {
        process.env.PARAMETER_IDENTITY_MAINTENANCE_TOKEN = previous;
      }
    }
  });

  it("dry-run does not count inferred drafts as mappedDefinitions", async () => {
    await seedLegacyGraph(db!);
    // Unique key absent from vendor catalog → must infer (not exact/ambiguous).
    const orphanDef = "pd-mig-orphan-only";
    const orphanKey = "orphan_legacy_only_param";
    await db!.query(
      `
      insert into parameter_definitions (
        id, organization_id, name, description, explanation, config_format,
        module, default_range, unit, risk
      ) values (
        $1, $2, $3, 'orphan', 'no catalog', 'DTS',
        'orphan_module', '', '', 'Low'
      )
      `,
      [orphanDef, ORG, orphanKey]
    );

    const report = await migrateParameterIdentities(db!, {
      mode: "dry-run",
      organizationId: ORG
    });

    expect(report.legacyDefinitions).toBe(2);
    expect(report.exactMatched).toBe(1);
    expect(report.reviewedMatched).toBe(0);
    expect(report.inferredPendingReview).toBe(1);
    expect(report.mappedDefinitions).toBe(1);
    expect(report.mappedDefinitions).not.toBe(report.legacyDefinitions);
    expect(report.blockers.some((b) => /inferred pending review/i.test(b))).toBe(true);
    expect(report.blockers.some((b) => b.includes(orphanDef))).toBe(true);
  });

  it("apply and cutover block unaudited inferred specs", async () => {
    await seedLegacyGraph(db!);
    const orphanDef = "pd-mig-orphan-cutover";
    const orphanKey = "orphan_cutover_only_param";
    await db!.query(
      `
      insert into parameter_definitions (
        id, organization_id, name, description, explanation, config_format,
        module, default_range, unit, risk
      ) values (
        $1, $2, $3, 'orphan', 'no catalog', 'DTS',
        'orphan_module', '', '', 'Low'
      )
      `,
      [orphanDef, ORG, orphanKey]
    );

    const dryRun = await migrateParameterIdentities(db!, {
      mode: "dry-run",
      organizationId: ORG
    });
    expect(dryRun.inferredPendingReview).toBe(1);
    expect(dryRun.mappedDefinitions).toBe(1);

    await expect(
      migrateParameterIdentities(db!, {
        mode: "apply",
        organizationId: ORG,
        ...applyGates,
        dbSnapshotId: "db-snap-inferred",
        objectSnapshotId: "obj-snap-inferred"
      })
    ).rejects.toThrow(/apply blocked|inferred pending review/i);

    // Force a completed run row with inferredPendingReview to prove cutover gate.
    const fakeRunId = "mig-run-inferred-block";
    const forgedReport = {
      ...dryRun,
      migrationRunId: fakeRunId,
      mode: "apply",
      inferredPendingReview: 1,
      mappedDefinitions: 1,
      blockers: [`inferred pending review for definition ${orphanDef}: orphan_module/${orphanKey}`]
    };
    await db!.query(
      `
      insert into parameter_identity_migration_runs (
        id, mode, status, report, db_snapshot_id, object_snapshot_id,
        write_lock_confirmed, completed_at
      ) values (
        $1, 'apply', 'finalized', $2::jsonb, 'db', 'obj', true, now()
      )
      `,
      [fakeRunId, JSON.stringify(forgedReport)]
    );

    await expect(
      applyParameterIdentityCutover(db!, { migrationRunId: fakeRunId })
    ).rejects.toThrow(/successful finalize phase/i);

    await db!.query(
      `
      insert into parameter_identity_migration_phases (
        id, migration_run_id, phase, status, report,
        db_snapshot_id, object_snapshot_id, completed_at
      ) values (
        'phase-forged-inferred', $1, 'finalize', 'finalized', $2::jsonb,
        'db', 'obj', now()
      )
      `,
      [fakeRunId, JSON.stringify(forgedReport)]
    );

    await expect(
      applyParameterIdentityCutover(db!, { migrationRunId: fakeRunId })
    ).rejects.toThrow(/cutover blocked|inferred/i);

    // Apply writes inside the shared test transaction survive the thrown apply block;
    // reuse the inferred draft + open review task that apply already staged.
    const openInferred = await db!.query<{ c: string }>(
      `
      select count(*)::text as c
      from parameter_spec_review_tasks
      where status = 'open'
        and coalesce(source_evidence->>'inferred', '') = 'true'
      `
    );
    expect(Number(openInferred.rows[0]?.c ?? 0)).toBeGreaterThan(0);

    const check = await checkParameterIdentityCutover(db!);
    expect(check.ok).toBe(false);
    expect(check.blockers.some((b) => /unaudited inferred/i.test(b))).toBe(true);
  });

  it("blocks apply when logical node mapping is ambiguous", async () => {
    await seedLegacyGraph(db!);
    const otherLogicalNodeId = stableSemanticId("dts_logical_node", [
      PROJECT,
      CONFIG_SET,
      `${NODE_LOCATOR}-alt`
    ]);
    await db!.query(
      `
      insert into dts_logical_nodes (id, organization_id, project_id, config_set_id)
      values ($1, $2, $3, $4)
      on conflict (id) do nothing
      `,
      [otherLogicalNodeId, ORG, PROJECT, CONFIG_SET]
    );
    await db!.query(
      `
      insert into dts_logical_node_revisions (
        id, logical_node_id, config_revision_id, node_locator, name, unit_address, parent_logical_node_id
      ) values ($1, $2, $3, $4, 'sc8562-alt', '6E', null)
      on conflict (id) do nothing
      `,
      [
        `lnr-${otherLogicalNodeId}`,
        otherLogicalNodeId,
        "rev-mig-14-1",
        NODE_LOCATOR
      ]
    );

    const dryRun = await migrateParameterIdentities(db!, {
      mode: "dry-run",
      organizationId: ORG
    });
    expect(dryRun.ambiguousRecords).toBeGreaterThanOrEqual(1);
    expect(dryRun.blockers.some((b) => /ambiguous logical node/i.test(b))).toBe(true);

    await expect(
      migrateParameterIdentities(db!, {
        mode: "apply",
        organizationId: ORG,
        ...applyGates,
        dbSnapshotId: "db-snap-ambiguous",
        objectSnapshotId: "obj-snap-ambiguous"
      })
    ).rejects.toThrow(/apply blocked|ambiguous logical node/i);
  });
});

describe.skipIf(!databaseAvailable)("parameter identity cutover atomicity", () => {
  it(
    "two fresh restores produce identical binding ids and counts",
    async () => {
    const reports: ParameterIdentityMigrationReport[] = [];
    const bindingIds: string[] = [];

    for (let i = 0; i < 2; i += 1) {
      await withTempDatabase(async (tempDb) => {
        await seedLegacyGraph(tempDb);
        const report = await migrateParameterIdentities(tempDb, {
          mode: "apply",
          organizationId: ORG,
          ...applyGates,
          dbSnapshotId: `db-snap-restore-${i}`,
          objectSnapshotId: `obj-snap-restore-${i}`
        });
        reports.push(report);
        const bindings = await tempDb.query<{ id: string }>(
          `select id from project_parameter_bindings where project_id = $1 order by id`,
          [PROJECT]
        );
        bindingIds.push(...bindings.rows.map((row) => row.id));
      });
    }

    expect(reports[0]?.mappedDefinitions).toBe(reports[1]?.mappedDefinitions);
    expect(reports[0]?.mappedProjectValues).toBe(reports[1]?.mappedProjectValues);
    expect(reports[0]?.coverage).toEqual(reports[1]?.coverage);
    expect(bindingIds[0]).toBe(bindingIds[1]);
    expect(bindingIds[0]).toBe(expectedBindingId(expectedSpecId(), expectedLogicalNodeId()));
  },
  20_000
  );

  it("injected cutover failure after partial writes rolls back marker and archive", async () => {
    await withTempDatabase(async (tempDb) => {
      await seedLegacyGraph(tempDb);
      const report = await migrateParameterIdentities(tempDb, {
        mode: "apply",
        organizationId: ORG,
        ...applyGates,
        dbSnapshotId: "db-snap-fail",
        objectSnapshotId: "obj-snap-fail"
      });
      expect(report.blockers).toEqual([]);

      await expect(
        applyParameterIdentityCutover(tempDb, {
          migrationRunId: report.migrationRunId,
          injectFailure: true
        })
      ).rejects.toThrow(/injected cutover failure/i);

      const marker = await tempDb.query(
        `select 1 from parameter_identity_cutovers limit 1`
      ).catch(() => ({ rows: [] as unknown[] }));
      expect(marker.rows).toHaveLength(0);

      const defs = await tempDb.query(
        `select 1 from information_schema.tables
         where table_schema = 'public' and table_name = 'parameter_definitions'`
      );
      expect(defs.rows).toHaveLength(1);

      const legacyDefs = await tempDb.query(
        `select 1 from information_schema.tables
         where table_schema = 'public' and table_name = 'legacy_parameter_definitions'`
      );
      expect(legacyDefs.rows).toHaveLength(0);

      const historyNullable = await tempDb.query<{ is_nullable: string }>(
        `
        select is_nullable
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'parameter_history_entries'
          and column_name = 'project_parameter_binding_id'
        `
      );
      expect(historyNullable.rows[0]?.is_nullable).toBe("YES");
    });
  });

  it("injected apply failure after partial writes leaves no semantic rows", async () => {
    await withTempDatabase(async (tempDb) => {
      await seedLegacyGraph(tempDb);
      await expect(
        migrateParameterIdentities(tempDb, {
          mode: "apply",
          organizationId: ORG,
          ...applyGates,
          dbSnapshotId: "db-snap-apply-fail",
          objectSnapshotId: "obj-snap-apply-fail",
          injectFailure: true
        })
      ).rejects.toThrow(/injected apply failure/i);

      const evidence = await tempDb.query(
        `select 1 from legacy_parameter_migration_evidence limit 1`
      );
      expect(evidence.rows).toHaveLength(0);

      const bindings = await tempDb.query(
        `select 1 from project_parameter_bindings where project_id = $1 limit 1`,
        [PROJECT]
      );
      expect(bindings.rows).toHaveLength(0);

      const runs = await tempDb.query(
        `select 1 from parameter_identity_migration_runs limit 1`
      );
      expect(runs.rows).toHaveLength(0);
    });
  });

  it("successful cutover archives legacy tables and records marker", async () => {
    await withTempDatabase(async (tempDb) => {
      await seedLegacyGraph(tempDb);
      const report = await migrateParameterIdentities(tempDb, {
        mode: "apply",
        organizationId: ORG,
        ...applyGates,
        dbSnapshotId: "db-snap-ok",
        objectSnapshotId: "obj-snap-ok"
      });

      await applyParameterIdentityCutover(tempDb, {
        migrationRunId: report.migrationRunId
      });

      const marker = await tempDb.query<{ migration_run_id: string }>(
        `select migration_run_id from parameter_identity_cutovers`
      );
      expect(marker.rows).toHaveLength(1);
      expect(marker.rows[0]?.migration_run_id).toBe(report.migrationRunId);

      const legacy = await tempDb.query(
        `select 1 from information_schema.tables
         where table_schema = 'public' and table_name = 'legacy_parameter_definitions'`
      );
      expect(legacy.rows).toHaveLength(1);

      const active = await tempDb.query(
        `select 1 from information_schema.tables
         where table_schema = 'public' and table_name = 'parameter_definitions'`
      );
      expect(active.rows).toHaveLength(0);

      const draftsNotNull = await tempDb.query<{ is_nullable: string }>(
        `
        select is_nullable
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'parameter_drafts'
          and column_name = 'project_parameter_binding_id'
        `
      );
      expect(draftsNotNull.rows[0]?.is_nullable).toBe("NO");

      const conflictsNotNull = await tempDb.query<{ is_nullable: string }>(
        `
        select is_nullable
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'parameter_file_sync_conflicts'
          and column_name = 'project_parameter_binding_id'
        `
      );
      expect(conflictsNotNull.rows[0]?.is_nullable).toBe("NO");

      const ppvColumns = await tempDb.query<{ column_name: string }>(
        `
        select column_name
        from information_schema.columns
        where table_schema = 'public'
          and table_name in (
            'parameter_history_entries',
            'parameter_drafts',
            'parameter_change_requests',
            'parameter_submission_items',
            'parameter_file_sync_conflicts'
          )
          and column_name = 'project_parameter_value_id'
        `
      );
      expect(ppvColumns.rows).toHaveLength(0);

      const legacyPpvFks = await tempDb.query<{ c: string }>(
        `
        select count(*)::text as c
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_namespace nsp on nsp.oid = rel.relnamespace
        where nsp.nspname = 'public'
          and con.contype = 'f'
          and pg_get_constraintdef(con.oid) ilike '%legacy_project_parameter_values%'
          and rel.relname in (
            'parameter_history_entries',
            'parameter_drafts',
            'parameter_change_requests',
            'parameter_submission_items',
            'parameter_file_sync_conflicts'
          )
        `
      );
      expect(Number(legacyPpvFks.rows[0]?.c ?? 0)).toBe(0);

      resetParameterIdentityCutoverCache();
      const params = await listParameters(tempDb, { organizationId: ORG, projectId: PROJECT, limit: 10 });
      expect(params.length).toBeGreaterThan(0);
      expect(params.some((item) => item.id === expectedBindingId(expectedSpecId(), expectedLogicalNodeId()))).toBe(
        true
      );

      const crs = await listChangeRequests(tempDb, { organizationId: ORG, projectId: PROJECT });
      expect(crs.length).toBeGreaterThan(0);

      const check = await checkParameterIdentityCutover(tempDb);
      expect(check.cutoverComplete).toBe(true);
      expect(check.blockers.filter((b) => /legacy PPV/i.test(b))).toEqual([]);

      const sql = await fs.readFile(cutoverSqlPath, "utf8");
      expect(sql).toContain("parameter_identity_cutovers");
      expect(sql).toContain("CUTOVER_FAILURE_INJECT_POINT");
      expect(sql).not.toContain("parameter_history_entries_legacy_ppv_fkey");
      expect(path.dirname(cutoverSqlPath).endsWith("cutovers")).toBe(true);
    });
  });
});

describe.skipIf(!databaseAvailable)("post-cutover API smoke (temp DB)", () => {
  it("cutover then semantic list works and legacy single-id evidence resolves to 410 contract", async () => {
    await withTempDatabase(async (tempDb) => {
      await seedLegacyGraph(tempDb);
      const report = await migrateParameterIdentities(tempDb, {
        mode: "apply",
        organizationId: ORG,
        ...applyGates,
        dbSnapshotId: "db-snap-smoke",
        objectSnapshotId: "obj-snap-smoke"
      });
      expect(report.blockers).toEqual([]);
      await applyParameterIdentityCutover(tempDb, { migrationRunId: report.migrationRunId });
      resetParameterIdentityCutoverCache();

      const activeDefs = await tempDb.query(
        `select 1 from information_schema.tables
         where table_schema = 'public' and table_name = 'parameter_definitions'`
      );
      expect(activeDefs.rows).toHaveLength(0);

      const listed = await listParameters(tempDb, { organizationId: ORG, projectId: PROJECT, limit: 20 });
      expect(listed.length).toBeGreaterThan(0);

      const evidence = await tempDb.query<{ id: string }>(
        `
        select id from legacy_parameter_migration_evidence
        where legacy_id = $1
        limit 1
        `,
        [PPV_ID]
      );
      expect(evidence.rows[0]?.id).toBeTruthy();

      // Mirror routes.rejectRetiredLegacyParameterId contract.
      const legacyLookup = await tempDb.query<{ id: string }>(
        `
        select id from legacy_parameter_migration_evidence
        where legacy_id = $1
        order by created_at asc
        limit 1
        `,
        [PPV_ID]
      );
      expect(legacyLookup.rows[0]?.id).toBeTruthy();
      const gone = new ApiError("GONE", "legacy-parameter-id-retired", 410, {
        diagnostic: "legacy-parameter-id-retired",
        migrationEvidenceId: legacyLookup.rows[0]!.id
      });
      expect(gone.status).toBe(410);
      expect(gone.details).toMatchObject({ diagnostic: "legacy-parameter-id-retired" });
    });
  });
});

describe.skipIf(!databaseAvailable)("parameter identity stage-review and finalize", () => {
  const stageGates = {
    ...applyGates,
    dbSnapshotId: "db-snap-stage",
    objectSnapshotId: "obj-snap-stage"
  };

  async function seedOrphanDefinition(db: Database) {
    await seedLegacyGraph(db);
    await db.query(
      `
      insert into parameter_definitions (
        id, organization_id, name, description, explanation, config_format,
        module, default_range, unit, risk
      ) values (
        $1, $2, $3, 'orphan', 'no catalog', 'DTS',
        'orphan_module', '', '', 'Low'
      )
      `,
      ["pd-mig-stage-orphan", ORG, "orphan_stage_only_param"]
    );
  }

  it(
    "stage-review persists inferred staging across a separate postgres connection",
    async () => {
      await withTempDatabaseConnection(async ({ db, connectionString }) => {
        await seedOrphanDefinition(db);
        const staged = await migrateParameterIdentities(db, {
          mode: "stage-review",
          organizationId: ORG,
          ...stageGates
        });
        expect(staged.mode).toBe("stage-review");
        expect(staged.inferredPendingReview).toBe(1);
        expect(staged.blockers.length).toBeGreaterThan(0);

        const run = await db.query<{ status: string; mode: string }>(
          `select status, mode from parameter_identity_migration_runs where id = $1`,
          [staged.migrationRunId]
        );
        expect(run.rows[0]).toMatchObject({ status: "staged", mode: "stage-review" });

        const stagePhase = await db.query<{ phase: string; status: string }>(
          `
          select phase, status
          from parameter_identity_migration_phases
          where migration_run_id = $1
          `,
          [staged.migrationRunId]
        );
        expect(stagePhase.rows).toHaveLength(1);
        expect(stagePhase.rows[0]).toMatchObject({ phase: "stage-review", status: "staged" });

        const bindings = await db.query(
          `select 1 from project_parameter_bindings where project_id = $1 limit 1`,
          [PROJECT]
        );
        expect(bindings.rows).toHaveLength(0);

        const reconnect = openDatabaseConnection(connectionString);
        try {
          const persistedRun = await reconnect.db.query<{ status: string }>(
            `select status from parameter_identity_migration_runs where id = $1`,
            [staged.migrationRunId]
          );
          expect(persistedRun.rows[0]?.status).toBe("staged");

          const openInferred = await reconnect.db.query<{ c: string }>(
            `
            select count(*)::text as c
            from parameter_spec_review_tasks
            where status = 'open'
              and coalesce(source_evidence->>'inferred', '') = 'true'
            `
          );
          expect(Number(openInferred.rows[0]?.c ?? 0)).toBe(1);

          const defEvidence = await reconnect.db.query<{ c: string }>(
            `
            select count(*)::text as c
            from legacy_parameter_migration_evidence
            where legacy_kind = 'parameter_definition'
              and migration_run_id = $1
            `,
            [staged.migrationRunId]
          );
          expect(Number(defEvidence.rows[0]?.c ?? 0)).toBeGreaterThan(0);
        } finally {
          await reconnect.close();
        }
      });
    },
    20_000
  );

  it(
    "finalize references staged run, requires resolved tasks, and writes activity atomically",
    async () => {
      await withTempDatabaseConnection(async ({ db }) => {
        await seedOrphanDefinition(db);
        const staged = await migrateParameterIdentities(db, {
          mode: "stage-review",
          organizationId: ORG,
          ...stageGates
        });

        await expect(
          migrateParameterIdentities(db, {
            mode: "finalize",
            migrationRunId: staged.migrationRunId,
            organizationId: ORG,
            ...applyGates
          })
        ).rejects.toThrow(/finalize blocked: open inferred/i);

        const inferredTask = await db.query<{ id: string; parameter_spec_id: string; migration_run_id: string }>(
          `
          select id, parameter_spec_id, migration_run_id
          from parameter_spec_review_tasks
          where status = 'open'
            and coalesce(source_evidence->>'inferred', '') = 'true'
          limit 1
          `
        );
        const specId = inferredTask.rows[0]?.parameter_spec_id;
        expect(specId).toBeTruthy();
        expect(inferredTask.rows[0]?.migration_run_id).toBe(staged.migrationRunId);
        await db.query(
          `
          update parameter_spec_review_tasks
          set status = 'resolved', resolved_at = now()
          where id = $1
          `,
          [inferredTask.rows[0]!.id]
        );
        await db.query(
          `update parameter_spec_versions set lifecycle = 'active' where parameter_spec_id = $1`,
          [specId]
        );

        const finalized = await migrateParameterIdentities(db, {
          mode: "finalize",
          migrationRunId: staged.migrationRunId,
          organizationId: ORG,
          ...applyGates
        });
        expect(finalized.mode).toBe("finalize");
        expect(finalized.blockers).toEqual([]);

        const run = await db.query<{ status: string; mode: string }>(
          `select status, mode from parameter_identity_migration_runs where id = $1`,
          [staged.migrationRunId]
        );
        expect(run.rows[0]).toMatchObject({ status: "finalized", mode: "stage-review" });

        const phases = await db.query<{ phase: string; status: string; report: ParameterIdentityMigrationReport }>(
          `
          select phase, status, report
          from parameter_identity_migration_phases
          where migration_run_id = $1
          order by created_at asc
          `,
          [staged.migrationRunId]
        );
        expect(phases.rows).toHaveLength(2);
        expect(phases.rows[0]).toMatchObject({ phase: "stage-review", status: "staged" });
        expect(phases.rows[1]).toMatchObject({ phase: "finalize", status: "finalized" });
        expect(phases.rows[0]!.report.inferredPendingReview).toBe(1);
        expect(phases.rows[1]!.report.inferredPendingReview).toBe(0);
        expect(phases.rows[0]!.report).not.toEqual(phases.rows[1]!.report);

        const runReport = await db.query<{ report: ParameterIdentityMigrationReport }>(
          `select report from parameter_identity_migration_runs where id = $1`,
          [staged.migrationRunId]
        );
        expect(runReport.rows[0]?.report.inferredPendingReview).toBe(1);

        const bindings = await db.query<{ c: string }>(
          `select count(*)::text as c from project_parameter_bindings where project_id = $1`,
          [PROJECT]
        );
        expect(Number(bindings.rows[0]?.c ?? 0)).toBeGreaterThan(0);

        const history = await db.query<{ c: string }>(
          `
          select count(*)::text as c
          from parameter_history_entries
          where project_parameter_binding_id is not null
          `
        );
        expect(Number(history.rows[0]?.c ?? 0)).toBeGreaterThan(0);

        await applyParameterIdentityCutover(db, { migrationRunId: staged.migrationRunId });
      });
    },
    30_000
  );

  it("finalize failure rolls back activity writes but keeps staged review artifacts", async () => {
    await withTempDatabase(async (db) => {
      await seedLegacyGraph(db);
      const staged = await migrateParameterIdentities(db, {
        mode: "stage-review",
        organizationId: ORG,
        ...stageGates
      });
      expect(staged.blockers).toEqual([]);

      await expect(
        migrateParameterIdentities(db, {
          mode: "finalize",
          migrationRunId: staged.migrationRunId,
          organizationId: ORG,
          ...applyGates,
          injectFailure: true
        })
      ).rejects.toThrow(/injected apply failure/i);

      const run = await db.query<{ status: string }>(
        `select status from parameter_identity_migration_runs where id = $1`,
        [staged.migrationRunId]
      );
      expect(run.rows[0]?.status).toBe("staged");

      const finalizePhases = await db.query<{ c: string }>(
        `
        select count(*)::text as c
        from parameter_identity_migration_phases
        where migration_run_id = $1 and phase = 'finalize'
        `,
        [staged.migrationRunId]
      );
      expect(Number(finalizePhases.rows[0]?.c ?? 0)).toBe(0);

      const stagePhase = await db.query<{ report: ParameterIdentityMigrationReport }>(
        `
        select report
        from parameter_identity_migration_phases
        where migration_run_id = $1 and phase = 'stage-review'
        `,
        [staged.migrationRunId]
      );
      expect(stagePhase.rows[0]?.report.mode).toBe("stage-review");

      const bindings = await db.query(
        `select 1 from project_parameter_bindings where project_id = $1 limit 1`,
        [PROJECT]
      );
      expect(bindings.rows).toHaveLength(0);

      const defEvidence = await db.query<{ c: string }>(
        `
        select count(*)::text as c
        from legacy_parameter_migration_evidence
        where legacy_kind = 'parameter_definition'
          and migration_run_id = $1
        `,
        [staged.migrationRunId]
      );
      expect(Number(defEvidence.rows[0]?.c ?? 0)).toBeGreaterThan(0);
    });
  }, 120_000);

  it("direct apply rollback does not remove prior stage-review tasks", async () => {
    await withTempDatabaseConnection(async ({ db, connectionString }) => {
      await seedOrphanDefinition(db);
      const staged = await migrateParameterIdentities(db, {
        mode: "stage-review",
        organizationId: ORG,
        ...stageGates
      });

      await expect(
        migrateParameterIdentities(db, {
          mode: "apply",
          organizationId: ORG,
          ...applyGates,
          dbSnapshotId: "db-snap-apply-fail-orphan",
          objectSnapshotId: "obj-snap-apply-fail-orphan"
        })
      ).rejects.toThrow(/apply blocked|inferred pending review/i);

      const reconnect = openDatabaseConnection(connectionString);
      try {
        const openInferred = await reconnect.db.query<{ c: string }>(
          `
          select count(*)::text as c
          from parameter_spec_review_tasks
          where status = 'open'
            and coalesce(source_evidence->>'inferred', '') = 'true'
          `
        );
        expect(Number(openInferred.rows[0]?.c ?? 0)).toBe(1);

        const stagedRun = await reconnect.db.query<{ status: string }>(
          `select status from parameter_identity_migration_runs where id = $1`,
          [staged.migrationRunId]
        );
        expect(stagedRun.rows[0]?.status).toBe("staged");
      } finally {
        await reconnect.close();
      }
    });
  });

  it("cutover accepts only finalized migration runs", async () => {
    await withTempDatabase(async (db) => {
      await seedLegacyGraph(db);
      const staged = await migrateParameterIdentities(db, {
        mode: "stage-review",
        organizationId: ORG,
        ...stageGates
      });

      await expect(
        applyParameterIdentityCutover(db, { migrationRunId: staged.migrationRunId })
      ).rejects.toThrow(/requires finalized migration run/i);

      await db.query(
        `
        update parameter_identity_migration_runs
        set status = 'finalized'
        where id = $1
        `,
        [staged.migrationRunId]
      );
      await expect(
        applyParameterIdentityCutover(db, { migrationRunId: staged.migrationRunId })
      ).rejects.toThrow(/successful finalize phase/i);

      await db.query(
        `
        update parameter_identity_migration_runs
        set status = 'staged'
        where id = $1
        `,
        [staged.migrationRunId]
      );

      await db.query(
        `
        update parameter_identity_migration_runs
        set status = 'completed'
        where id = $1
        `,
        [staged.migrationRunId]
      );
      await expect(
        applyParameterIdentityCutover(db, { migrationRunId: staged.migrationRunId })
      ).rejects.toThrow(/requires finalized migration run/i);

      await db.query(
        `update parameter_identity_migration_runs set status = 'staged' where id = $1`,
        [staged.migrationRunId]
      );

      const finalized = await migrateParameterIdentities(db, {
        mode: "finalize",
        migrationRunId: staged.migrationRunId,
        organizationId: ORG,
        ...applyGates
      });
      expect(finalized.blockers).toEqual([]);

      await applyParameterIdentityCutover(db, { migrationRunId: staged.migrationRunId });
    });
  });

  it("finalize ignores open review tasks from unrelated migration runs", async () => {
    await withTempDatabase(async (db) => {
      await seedLegacyGraph(db);
      const staged = await migrateParameterIdentities(db, {
        mode: "stage-review",
        organizationId: ORG,
        ...stageGates
      });
      expect(staged.blockers).toEqual([]);

      await db.query(
        `
        insert into parameter_identity_migration_runs (
          id, mode, status, report, db_snapshot_id, object_snapshot_id,
          write_lock_confirmed, completed_at
        ) values (
          'unrelated-migration-run', 'stage-review', 'staged', '{}'::jsonb,
          'db-unrelated', 'obj-unrelated', true, now()
        )
        `
      );

      await db.query(
        `
        insert into parameter_spec_review_tasks (
          id, organization_id, parameter_spec_id, source_evidence,
          candidate_schemas, project_count, status, reason, blocker_scope,
          migration_run_id
        ) values (
          'review-task-unrelated-run', $1, $2,
          '{"inferred": true}'::jsonb, '[]'::jsonb, 1, 'open',
          'unrelated inferred blocker', 'platform', 'unrelated-migration-run'
        )
        `,
        [ORG, expectedSpecId()]
      );

      const finalized = await migrateParameterIdentities(db, {
        mode: "finalize",
        migrationRunId: staged.migrationRunId,
        organizationId: ORG,
        ...applyGates
      });
      expect(finalized.blockers).toEqual([]);
    });
  });

  it(
    "concurrent finalize allows only one success for the same staged run",
    async () => {
      await withTempDatabaseConnection(async ({ db, connectionString }) => {
        await seedLegacyGraph(db);
        const staged = await migrateParameterIdentities(db, {
          mode: "stage-review",
          organizationId: ORG,
          ...stageGates
        });
        expect(staged.blockers).toEqual([]);

        const connA = openDatabaseConnection(connectionString);
        const connB = openDatabaseConnection(connectionString);
        try {
          const results = await Promise.allSettled([
            migrateParameterIdentities(connA.db, {
              mode: "finalize",
              migrationRunId: staged.migrationRunId,
              organizationId: ORG,
              ...applyGates
            }),
            migrateParameterIdentities(connB.db, {
              mode: "finalize",
              migrationRunId: staged.migrationRunId,
              organizationId: ORG,
              ...applyGates
            })
          ]);

          const fulfilled = results.filter((result) => result.status === "fulfilled");
          const rejected = results.filter((result) => result.status === "rejected");
          expect(fulfilled).toHaveLength(1);
          expect(rejected).toHaveLength(1);
          const failure = (rejected[0] as PromiseRejectedResult).reason as Error;
          expect(failure.message).toMatch(/staged|finalized/i);

          const finalizePhases = await db.query<{ c: string }>(
            `
            select count(*)::text as c
            from parameter_identity_migration_phases
            where migration_run_id = $1 and phase = 'finalize' and status = 'finalized'
            `,
            [staged.migrationRunId]
          );
          expect(Number(finalizePhases.rows[0]?.c ?? 0)).toBe(1);
        } finally {
          await connA.close();
          await connB.close();
        }
      });
    },
    30_000
  );
});
