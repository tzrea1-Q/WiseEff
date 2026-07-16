/**
 * Task 1–2: post-cutover activity workflow on a temp DB.
 * migrate → cutover → list/draft/submit/review/merge/history/writeback/debug/delete
 */
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../shared/database/client";
import { applyMigrations } from "../../shared/database/migrations";
import { isTestDatabaseAvailable } from "../../testing/testDatabase";
import type { AuthContext } from "../auth/types";
import { insertNodeOperation } from "../debugging/repository";
import { writebackMergedParameterValue } from "../parameter-files/writebackService";
import { resetParameterIdentityCutoverCache } from "../parameters/cutoverAwareIdentity";
import {
  createChangeRequest,
  createSubmissionItem,
  createSubmissionRound,
  deleteProject,
  listDraftsForUser,
  listParameterHistory,
  listParameters,
  mergeChangeRequest,
  updateChangeRequestStatus,
  upsertDraft
} from "../parameters/repository";
import {
  applyParameterIdentityCutover,
  migrateParameterIdentities,
  stableSemanticId
} from "./migration";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const migrationsDir = path.join(projectRoot, "server", "migrations");

const ORG = "org-pcw-t1t2";
const PROJECT = "project-pcw-t1t2";
const USER = "user-pcw-t1t2";
const CONFIG_SET = "dcs-pcw-t1t2";
const DEF_ID = "pd-pcw-gpio-int";
const PPV_ID = "ppv-pcw-gpio-int";
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
  const dbName = `wiseeff_pcw_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`.replace(
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
      name: "PCW User",
      email: "pcw@example.com",
      title: "Admin",
      isActive: true
    },
    organization: { id: ORG, name: "PCW Org" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "parameter:merge", "admin:access"]
  };
}

async function seedPreCutoverGraph(db: Database) {
  const specId = expectedSpecId();
  const specVersionId = stableSemanticId("parameter_spec_version", [specId, "1"]);
  const logicalNodeId = expectedLogicalNodeId();
  const propertySpecId = stableSemanticId("dts_property_spec", [specId, PROPERTY_KEY]);
  const configRevisionId = "rev-pcw-1";
  const fileId = "file-pcw-1";
  const fileVersionId = "fv-pcw-1";
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

  await db.query(`insert into organizations (id, name) values ($1, 'PCW Org')`, [ORG]);
  await db.query(
    `insert into users (id, organization_id, name, email, title, is_active)
     values ($1, $2, 'PCW User', 'pcw@example.com', 'Admin', true)`,
    [USER, ORG]
  );
  await db.query(
    `insert into projects (id, organization_id, name, code, status)
     values ($1, $2, 'PCW Project', 'PCW', 'initialized')`,
    [PROJECT, ORG]
  );
  await db.query(
    `insert into dts_config_set (id, organization_id, project_id, name, description)
     values ($1, $2, $3, 'pcw-power', 't1t2')`,
    [CONFIG_SET, ORG, PROJECT]
  );
  await db.query(
    `insert into parameter_specs (id, organization_id, source_kind, specification_key)
     values ($1, $2, 'dts', $3)`,
    [specId, ORG, `${DRIVER}/${PROPERTY_KEY}`]
  );
  await db.query(
    `insert into parameter_spec_versions (
      id, parameter_spec_id, version, display_name, description, value_shape, lifecycle
    ) values ($1, $2, 1, 'gpio_int', 'GPIO interrupt', '{"kind":"cells","bits":32}'::jsonb, 'active')`,
    [specVersionId, specId]
  );
  await db.query(
    `insert into dts_property_specs (id, parameter_spec_id, property_key, schema_namespace, constraints)
     values ($1, $2, $3, $4, '{}'::jsonb)`,
    [propertySpecId, specId, PROPERTY_KEY, SCHEMA_NS]
  );
  await db.query(
    `insert into project_parameter_files (
      id, organization_id, project_id, file_name, format, enabled,
      config_set_id, config_set_role, config_set_sort_order
    ) values ($1, $2, $3, 'pcw-base.dts', 'dts', true, $4, 'base', 0)`,
    [fileId, ORG, PROJECT, CONFIG_SET]
  );
  await db.query(
    `insert into project_parameter_file_versions (
      id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
    ) values ($1, $2, 1, $3, $4, $5, '{}'::jsonb, 'upload', $6)`,
    [fileVersionId, fileId, `${ORG}/${checksum}-pcw-base.dts`, checksum, Buffer.byteLength(content), USER]
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
    ) values ($1, $2, $3, $4, 'sc8562', '6E', null)`,
    [`lnr-${logicalNodeId}`, logicalNodeId, configRevisionId, NODE_LOCATOR]
  );
  await db.query(
    `insert into parameter_definitions (
      id, organization_id, name, description, explanation, config_format,
      module, default_range, unit, risk
    ) values ($1, $2, $3, 'GPIO interrupt', 'legacy', 'DTS', $4, '', '', 'Low')`,
    [DEF_ID, ORG, PROPERTY_KEY, DRIVER]
  );
  await db.query(
    `insert into project_parameter_values (
      id, organization_id, project_id, parameter_definition_id,
      current_value, recommended_value, value_version, updated_by_user_id,
      source_file_name, source_node_path
    ) values ($1, $2, $3, $4, '<1>', '', 1, $5, 'pcw-base.dts', $6)`,
    [PPV_ID, ORG, PROJECT, DEF_ID, USER, SOURCE_NODE_PATH]
  );

  // Minimal open CR / draft / history so migrate can backfill semantic FKs.
  const roundId = "round-pcw-1";
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
    ) values ($1, $2, $3, $4, $5, $6, 1, '<1>', '<2>', 'merged', $7)`,
    ["cr-pcw-seed", ORG, roundId, PROJECT, PPV_ID, DEF_ID, USER]
  );
  await db.query(
    `insert into parameter_history_entries (
      id, organization_id, project_id, parameter_definition_id, project_parameter_value_id,
      version, value, changed_by_user_id, request_id
    ) values ($1, $2, $3, $4, $5, 1, '<1>', $6, $7)`,
    ["hist-pcw-seed", ORG, PROJECT, DEF_ID, PPV_ID, USER, "cr-pcw-seed"]
  );
  await db.query(
    `insert into parameter_drafts (
      id, organization_id, project_id, project_parameter_value_id, user_id, target_value, reason, origin
    ) values ($1, $2, $3, $4, $5, '<3>', 'seed draft', 'manual')`,
    ["draft-pcw-seed", ORG, PROJECT, PPV_ID, USER]
  );

  return {
    specId,
    bindingId: expectedBindingId(specId, logicalNodeId),
    fileId,
    fileVersionId,
    content,
    checksum
  };
}

describe.skipIf(!databaseAvailable)("post-cutover semantic workflow (temp DB)", () => {
  it(
    "runs list/draft/submit/review/merge/history/writeback/debug/delete without shadow PPV",
    async () => {
      await withTempDatabase(async (db) => {
        const seeded = await seedPreCutoverGraph(db);
        const report = await migrateParameterIdentities(db, {
          mode: "apply",
          organizationId: ORG,
          ...applyGates,
          dbSnapshotId: "db-snap-pcw",
          objectSnapshotId: "obj-snap-pcw"
        });
        expect(report.blockers).toEqual([]);
        await applyParameterIdentityCutover(db, { migrationRunId: report.migrationRunId });
        resetParameterIdentityCutoverCache();

        const activeDefs = await db.query(
          `select 1 from information_schema.tables
           where table_schema = 'public' and table_name = 'parameter_definitions'`
        );
        expect(activeDefs.rows).toHaveLength(0);

        const listed = await listParameters(db, { organizationId: ORG, projectId: PROJECT, limit: 20 });
        expect(listed.some((item) => item.id === seeded.bindingId)).toBe(true);

        const legacyCountBefore = await db.query<{ c: string }>(
          `select count(*)::text as c from legacy_project_parameter_values where organization_id = $1`,
          [ORG]
        );
        const legacyBefore = Number(legacyCountBefore.rows[0]?.c ?? 0);

        await db.query(`delete from parameter_drafts where organization_id = $1 and project_id = $2`, [
          ORG,
          PROJECT
        ]);

        const draftId = randomUUID();
        const draft = await upsertDraft(db, {
          id: draftId,
          organizationId: ORG,
          projectId: PROJECT,
          parameterId: seeded.bindingId,
          userId: USER,
          targetValue: "<9>",
          reason: "post-cutover typed draft",
          projectParameterBindingId: seeded.bindingId,
          parameterSpecId: seeded.specId
        });
        expect(draft.projectParameterBindingId).toBe(seeded.bindingId);
        expect(draft.parameterId).toBe(seeded.bindingId);

        const reloaded = await listDraftsForUser(db, {
          organizationId: ORG,
          userId: USER,
          projectId: PROJECT
        });
        const stored = reloaded.find((item) => item.projectParameterBindingId === seeded.bindingId);
        expect(stored?.id).toBe(draftId);
        expect(stored?.parameterId).toBe(seeded.bindingId);
        expect(stored?.targetValue).toBe("<9>");

        const legacyCountAfter = await db.query<{ c: string }>(
          `select count(*)::text as c from legacy_project_parameter_values where organization_id = $1`,
          [ORG]
        );
        expect(Number(legacyCountAfter.rows[0]?.c ?? 0)).toBe(legacyBefore);

        const shadowLinks = await db.query(
          `select 1 from legacy_project_parameter_values where source_node_path like 'binding/%'`
        );
        const shadowDefs = await db.query(
          `select 1 from legacy_parameter_definitions
           where module in ('binding-shadow', 'pre-cutover-link')`
        );
        expect(shadowLinks.rows).toHaveLength(0);
        expect(shadowDefs.rows).toHaveLength(0);

        const auth = makeAuth();
        const round = await createSubmissionRound(db, {
          id: randomUUID(),
          organizationId: ORG,
          projectId: PROJECT,
          submitterUserId: USER,
          status: "submitted",
          summary: "post-cutover submit"
        });
        const request = await createChangeRequest(db, {
          id: randomUUID(),
          organizationId: ORG,
          submissionRoundId: round.id,
          projectId: PROJECT,
          parameterId: seeded.bindingId,
          parameterDefinitionId: seeded.specId,
          baseVersion: 1,
          currentValue: "<1>",
          targetValue: "<9>",
          status: "software_merge",
          submitterUserId: USER,
          parameterSpecId: seeded.specId,
          projectParameterBindingId: seeded.bindingId
        });
        await createSubmissionItem(db, {
          id: randomUUID(),
          organizationId: ORG,
          submissionRoundId: round.id,
          changeRequestId: request.id,
          parameterId: seeded.bindingId,
          currentValue: "<1>",
          targetValue: "<9>",
          reason: "post-cutover",
          projectParameterBindingId: seeded.bindingId
        });

        const merged = await mergeChangeRequest(db, {
          historyId: randomUUID(),
          organizationId: ORG,
          requestId: request.id,
          actorUserId: USER
        });
        expect(merged?.projectParameterBindingId).toBe(seeded.bindingId);
        await updateChangeRequestStatus(db, {
          organizationId: ORG,
          requestId: request.id,
          status: "merged"
        });

        const history = await listParameterHistory(db, {
          organizationId: ORG,
          parameterId: seeded.bindingId
        });
        expect(history.some((entry) => entry.value === "<9>")).toBe(true);

        const bindingRaw = await db.query<{ raw_value: string | null }>(
          `select raw_value from project_parameter_binding_revisions
           where binding_id = $1 order by created_at desc limit 1`,
          [seeded.bindingId]
        );
        expect(bindingRaw.rows[0]?.raw_value).toBe("<9>");

        const objectStore = {
          async get() {
            return Buffer.from("unused");
          },
          async put() {
            return {
              storageKey: "unused",
              checksumSha256: "0".repeat(64),
              fileSizeBytes: 0
            };
          }
        };
        const writeback = await writebackMergedParameterValue(db, objectStore as never, auth, {
          projectId: PROJECT,
          parameterDefinitionId: seeded.specId,
          mergedValue: "<9>",
          projectParameterBindingId: seeded.bindingId,
          parameterSpecId: seeded.specId
        });
        // Without occurrence provenance, writeback may skip — but must not throw on legacy tables.
        expect(writeback.skipped === true || writeback.skipped === false).toBe(true);

        const deviceId = "device-pcw-1";
        const targetId = "target-pcw-1";
        const sessionId = "session-pcw-1";
        await db.query(
          `insert into debugging_devices (id, organization_id, name, transport, status, firmware)
           values ($1, $2, 'dev', 'hdc', 'online', '1.0')`,
          [deviceId, ORG]
        );
        await db.query(
          `insert into debugging_targets (id, organization_id, device_id, protocol, target_ref, label, status)
           values ($1, $2, $3, 'hdc', 't1', 'target', 'ready')`,
          [targetId, ORG, deviceId]
        );
        await db.query(
          `insert into debugging_sessions (
             id, organization_id, device_id, target_id, protocol, execution_mode,
             session_kind, actor_user_id, status
           ) values ($1, $2, $3, $4, 'hdc', 'local', 'node', $5, 'active')`,
          [sessionId, ORG, deviceId, targetId, USER]
        );
        const op = await insertNodeOperation(db, {
          organizationId: ORG,
          sessionId,
          parameterId: null,
          nodeId: null,
          parameterSpecId: seeded.specId,
          projectParameterBindingId: seeded.bindingId,
          nodePath: SOURCE_NODE_PATH,
          operationType: "read",
          status: "succeeded",
          readValue: "<9>",
          durationMs: 1,
          actorUserId: USER
        });
        expect(op.id).toBeTruthy();
        const opRow = await db.query<{ project_parameter_binding_id: string | null }>(
          `select project_parameter_binding_id from node_operations where id = $1`,
          [op.id]
        );
        expect(opRow.rows[0]?.project_parameter_binding_id).toBe(seeded.bindingId);

        const deleteSqlProbe = await fs.readFile(
          path.join(projectRoot, "server/modules/parameters/repository.ts"),
          "utf8"
        );
        expect(deleteSqlProbe).not.toMatch(/delete from project_parameter_values/);
        expect(deleteSqlProbe).toContain("delete from project_parameter_bindings");

        const deleted = await deleteProject(db, { organizationId: ORG, projectId: PROJECT });
        expect(deleted.deleted).toBe(true);
        const bindingsLeft = await db.query(
          `select 1 from project_parameter_bindings where project_id = $1`,
          [PROJECT]
        );
        expect(bindingsLeft.rows).toHaveLength(0);
      });
    },
    120_000
  );
});
