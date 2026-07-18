/**
 * Task 1–3: post-cutover activity workflow on a temp DB.
 * migrate → cutover → list/draft/submit/review/merge/writeback/debug/delete
 * plus exact locked merge/writeback and stale 409 guards.
 */
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../shared/database/client";
import { applyMigrations } from "../../shared/database/migrations";
import { ApiError } from "../../shared/http/errors";
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
  getChangeRequestWriteLock,
  listDraftsForUser,
  listParameterHistory,
  listParameters,
  mergeChangeRequest,
  updateChangeRequestStatus,
  upsertDraft
} from "../parameters/repository";
import { reviewChange, submitParameterChanges } from "../parameters/service";
import { resolveBindingWriteLock } from "./editService";
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
  const overlayFileId = "file-pcw-overlay";
  const overlayVersionId = "fv-pcw-overlay";
  const content = `/dts-v1/;
/ {
	amba {
		i2c@FDF5E000 {
			sc8562: sc8562@6E {
				compatible = "vendor,sc8562";
				gpio_int = <1>;
			};
		};
	};
};
`;
  const overlayContent = `/dts-v1/;
/plugin/;

&sc8562 {
};
`;
  const checksum = createHash("sha256").update(content, "utf8").digest("hex");
  const overlayChecksum = createHash("sha256").update(overlayContent, "utf8").digest("hex");

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
    `insert into project_parameter_files (
      id, organization_id, project_id, file_name, format, enabled,
      config_set_id, config_set_role, config_set_sort_order
    ) values ($1, $2, $3, 'pcw-overlay.dts', 'dts', true, $4, 'overlay', 1)`,
    [overlayFileId, ORG, PROJECT, CONFIG_SET]
  );
  await db.query(
    `insert into project_parameter_file_versions (
      id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
    ) values ($1, $2, 1, $3, $4, $5, $6::jsonb, 'upload', $7)`,
    [
      overlayVersionId,
      overlayFileId,
      `${ORG}/${overlayChecksum}-pcw-overlay.dts`,
      overlayChecksum,
      Buffer.byteLength(overlayContent),
      JSON.stringify({ sourceText: overlayContent }),
      USER
    ]
  );
  await db.query(`update project_parameter_files set current_version_id = $1 where id = $2`, [
    overlayVersionId,
    overlayFileId
  ]);
  await db.query(
    `insert into dts_config_revisions (
      id, organization_id, project_id, config_set_id, revision_number, status, created_by_user_id,
      entry_file, include_search_paths, overlay_order, manifest_state
    ) values ($1, $2, $3, $4, 1, 'compiled', $5, 'pcw-base.dts', $6::jsonb, $7::jsonb, 'complete')`,
    [
      configRevisionId,
      ORG,
      PROJECT,
      CONFIG_SET,
      USER,
      JSON.stringify(["."]),
      JSON.stringify(["pcw-overlay.dts"])
    ]
  );
  await db.query(
    `insert into dts_config_revision_members (
      id, config_revision_id, file_id, file_version_id, role, sort_order
    ) values ($1, $2, $3, $4, 'base', 0)`,
    [`member-${configRevisionId}-base`, configRevisionId, fileId, fileVersionId]
  );
  await db.query(
    `insert into dts_config_revision_members (
      id, config_revision_id, file_id, file_version_id, role, sort_order
    ) values ($1, $2, $3, $4, 'overlay', 1)`,
    [`member-${configRevisionId}-overlay`, configRevisionId, overlayFileId, overlayVersionId]
  );
  await db.query(
    `insert into dts_logical_nodes (id, organization_id, project_id, config_set_id)
     values ($1, $2, $3, $4)`,
    [logicalNodeId, ORG, PROJECT, CONFIG_SET]
  );
  const logicalNodeRevisionId = `lnr-${logicalNodeId}`;
  await db.query(
    `insert into dts_logical_node_revisions (
      id, logical_node_id, config_revision_id, node_locator, name, unit_address, parent_logical_node_id
    ) values ($1, $2, $3, $4, 'sc8562', '6E', null)`,
    [logicalNodeRevisionId, logicalNodeId, configRevisionId, NODE_LOCATOR]
  );
  const nodeOccurrenceId = "no-pcw-1";
  const propertyOccurrenceId = "po-pcw-gpio-int";
  await db.query(
    `insert into dts_node_occurrences (
      id, config_revision_id, file_version_id, name, labels, node_path,
      start_offset, end_offset, start_line, start_column, end_line, end_column,
      raw_text, ast_json, source_order
    ) values ($1, $2, $3, 'sc8562', '[]'::jsonb, $4, 0, 100, 1, 1, 5, 2, 'node', '{}'::jsonb, 0)`,
    [nodeOccurrenceId, configRevisionId, fileVersionId, "amba/i2c@FDF5E000/sc8562@6E"]
  );
  await db.query(
    `insert into dts_property_occurrences (
      id, config_revision_id, node_occurrence_id, file_version_id, property_name,
      start_offset, end_offset, start_line, start_column, end_line, end_column,
      raw_text, ast_json, source_order
    ) values ($1, $2, $3, $4, $5, 10, 20, 2, 3, 2, 10, '<1>', '{}'::jsonb, 0)`,
    [propertyOccurrenceId, configRevisionId, nodeOccurrenceId, fileVersionId, PROPERTY_KEY]
  );
  await db.query(
    `insert into dts_occurrence_effects (
      id, config_revision_id, logical_node_revision_id, property_occurrence_id, node_occurrence_id,
      property_name, effect_kind, source_order
    ) values ($1, $2, $3, $4, $5, $6, 'set', 1)`,
    [
      "oe-pcw-gpio-int",
      configRevisionId,
      logicalNodeRevisionId,
      propertyOccurrenceId,
      nodeOccurrenceId,
      PROPERTY_KEY
    ]
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
    overlayFileId,
    overlayVersionId,
    content,
    overlayContent,
    checksum,
    overlayChecksum,
    configRevisionId,
  };
}

describe.skipIf(!databaseAvailable)("post-cutover semantic workflow (temp DB)", () => {
  it(
    "submits an exact binding draft identity and rejects project/spec/candidate/write-lock mismatches",
    async () => {
      await withTempDatabase(async (db) => {
        const seeded = await seedPreCutoverGraph(db);
        const report = await migrateParameterIdentities(db, {
          mode: "apply",
          organizationId: ORG,
          ...applyGates,
          dbSnapshotId: "db-snap-binding-submit",
          objectSnapshotId: "obj-snap-binding-submit"
        });
        expect(report.blockers).toEqual([]);
        await applyParameterIdentityCutover(db, { migrationRunId: report.migrationRunId });
        resetParameterIdentityCutoverCache();

        await db.query(`delete from parameter_drafts where organization_id = $1 and project_id = $2`, [ORG, PROJECT]);
        const candidateRevisionId = "rev-pcw-binding-submit-candidate";
        await db.query(
          `insert into dts_config_revisions (
             id, organization_id, project_id, config_set_id, revision_number, status,
             created_by_user_id, entry_file, include_search_paths, overlay_order, manifest_state
           ) values ($1, $2, $3, $4, 2, 'draft', $5, 'pcw-base.dts', '["."]'::jsonb,
             '["pcw-overlay.dts"]'::jsonb, 'complete')`,
          [candidateRevisionId, ORG, PROJECT, CONFIG_SET, USER]
        );
        await db.query(
          `insert into project_parameter_binding_revisions (
             id, binding_id, config_revision_id, parameter_spec_version_id,
             typed_value, canonical_value, raw_value, schema_state, policy_state
           )
           select $1, binding_id, $2, parameter_spec_version_id,
             typed_value, canonical_value, raw_value, schema_state, policy_state
           from project_parameter_binding_revisions
           where binding_id = $3 and config_revision_id = $4`,
          ["bpr-pcw-binding-submit-candidate", candidateRevisionId, seeded.bindingId, seeded.configRevisionId]
        );
        const writeLock = await resolveBindingWriteLock(db, makeAuth(), {
          bindingId: seeded.bindingId,
          baseRevisionId: seeded.configRevisionId
        });
        const draftId = "draft-pcw-binding-submit";
        const targetValue = "<&gpio13 30 0>";
        const reason = "Submit the exact typed binding draft";
        await upsertDraft(db, {
          id: draftId,
          organizationId: ORG,
          projectId: PROJECT,
          parameterId: seeded.bindingId,
          userId: USER,
          targetValue,
          reason,
          projectParameterBindingId: seeded.bindingId,
          parameterSpecId: seeded.specId,
          candidateConfigRevisionId: candidateRevisionId,
          writeLock
        });

        const submit = (overrides: Record<string, string> = {}, projectId = PROJECT) =>
          submitParameterChanges(db, makeAuth(), {
            projectId,
            items: [
              {
                draftId,
                projectParameterBindingId: seeded.bindingId,
                parameterSpecId: seeded.specId,
                targetValue,
                reason,
                ...overrides
              }
            ]
          });

        await expect(submit({ parameterSpecId: "spec-mismatch" })).rejects.toMatchObject({
          code: "CONFLICT",
          status: 409
        });
        await expect(submit({}, "project-other")).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

        await db.query(`update dts_config_revisions set status = 'invalid' where id = $1`, [candidateRevisionId]);
        await expect(submit()).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
        await db.query(`update dts_config_revisions set status = 'draft' where id = $1`, [candidateRevisionId]);

        await db.query(`update parameter_drafts set expected_checksum = 'stale-checksum' where id = $1`, [draftId]);
        await expect(submit()).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
        await db.query(`update parameter_drafts set expected_checksum = $2 where id = $1`, [
          draftId,
          writeLock.expectedChecksum
        ]);

        const before = await db.query<{ requests: string; audits: string }>(
          `select
             (select count(*)::text from parameter_change_requests where project_id = $1 and id <> 'cr-pcw-seed') as requests,
             (select count(*)::text from audit_events where project_id = $1 and kind = 'parameter-submit') as audits`,
          [PROJECT]
        );
        expect(before.rows[0]).toEqual({ requests: "0", audits: "0" });

        const round = await submit();
        expect(round.items).toHaveLength(1);
        const persisted = await db.query<{
          project_parameter_binding_id: string;
          parameter_spec_id: string;
          base_config_revision_id: string;
          binding_revision_id: string;
        }>(
          `select project_parameter_binding_id, parameter_spec_id, base_config_revision_id, binding_revision_id
           from parameter_change_requests where submission_round_id = $1`,
          [round.id]
        );
        expect(persisted.rows[0]).toMatchObject({
          project_parameter_binding_id: seeded.bindingId,
          parameter_spec_id: seeded.specId,
          base_config_revision_id: writeLock.baseConfigRevisionId,
          binding_revision_id: writeLock.bindingRevisionId
        });
        const audit = await db.query<{ metadata: Record<string, unknown> }>(
          `select metadata from audit_events
           where project_id = $1 and kind = 'parameter-submit'
           order by created_at desc limit 1`,
          [PROJECT]
        );
        expect(audit.rows[0]?.metadata).toMatchObject({
          bindingDraftIds: [draftId],
          projectParameterBindingIds: [seeded.bindingId],
          parameterSpecIds: [seeded.specId]
        });
        expect((await db.query(`select 1 from parameter_drafts where id = $1`, [draftId])).rows).toHaveLength(0);
      });
    },
    90_000
  );

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

        const auth = makeAuth();
        const mergedGpioValue = "<&gpio13 30 0>";
        const writeLock = await resolveBindingWriteLock(db, auth, { bindingId: seeded.bindingId });
        expect(writeLock.baseConfigRevisionId).toBeTruthy();
        expect(writeLock.bindingRevisionId).toBeTruthy();

        const draftId = randomUUID();
        const draft = await upsertDraft(db, {
          id: draftId,
          organizationId: ORG,
          projectId: PROJECT,
          parameterId: seeded.bindingId,
          userId: USER,
          targetValue: mergedGpioValue,
          reason: "post-cutover typed draft",
          projectParameterBindingId: seeded.bindingId,
          parameterSpecId: seeded.specId,
          writeLock,
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
        expect(stored?.targetValue).toBe(mergedGpioValue);

        const draftLockRow = await db.query<{
          base_config_revision_id: string | null;
          binding_revision_id: string | null;
          source_file_version_id: string | null;
          expected_checksum: string | null;
        }>(
          `select base_config_revision_id, binding_revision_id, source_file_version_id, expected_checksum
           from parameter_drafts where id = $1`,
          [draftId]
        );
        expect(draftLockRow.rows[0]?.base_config_revision_id).toBe(writeLock.baseConfigRevisionId);
        expect(draftLockRow.rows[0]?.binding_revision_id).toBe(writeLock.bindingRevisionId);
        expect(draftLockRow.rows[0]?.source_file_version_id).toBe(writeLock.sourceFileVersionId);
        expect(draftLockRow.rows[0]?.expected_checksum).toBe(writeLock.expectedChecksum);

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
          targetValue: mergedGpioValue,
          status: "software_merge",
          submitterUserId: USER,
          parameterSpecId: seeded.specId,
          projectParameterBindingId: seeded.bindingId,
          writeLock,
        });
        await createSubmissionItem(db, {
          id: randomUUID(),
          organizationId: ORG,
          submissionRoundId: round.id,
          changeRequestId: request.id,
          parameterId: seeded.bindingId,
          currentValue: "<1>",
          targetValue: mergedGpioValue,
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
        expect(history.some((entry) => entry.value === mergedGpioValue)).toBe(true);
        expect(history.filter((entry) => entry.value === mergedGpioValue)).toHaveLength(1);

        const baseBindingRaw = await db.query<{ raw_value: string | null; config_revision_id: string }>(
          `select raw_value, config_revision_id from project_parameter_binding_revisions
           where binding_id = $1 and config_revision_id = $2`,
          [seeded.bindingId, writeLock.baseConfigRevisionId]
        );
        expect(baseBindingRaw.rows[0]?.raw_value).toBe("<1>");

        const objectStore = {
          async get(key: string) {
            if (key.includes("overlay")) {
              return Buffer.from(seeded.overlayContent, "utf8");
            }
            return Buffer.from(seeded.content, "utf8");
          },
          async put(input: { bytes: Buffer }) {
            return {
              storageKey: `${ORG}/writeback-pcw.dts`,
              checksumSha256: createHash("sha256").update(input.bytes).digest("hex"),
              fileSizeBytes: input.bytes.length
            };
          }
        };
        const writeback = await writebackMergedParameterValue(db, objectStore as never, auth, {
          projectId: PROJECT,
          parameterDefinitionId: seeded.specId,
          mergedValue: mergedGpioValue,
          projectParameterBindingId: seeded.bindingId,
          parameterSpecId: seeded.specId,
          changeRequestId: request.id,
        }, {
          toolchain: {
            async validate() {
              return {
                ok: true,
                mode: "release" as const,
                compiler: { dtc: "test", fdtoverlay: "test", dtschema: "test" },
                diagnostics: [],
                artifacts: {},
              };
            },
            async probe() {
              return {
                dtc: { path: "/usr/bin/dtc", version: "test" },
                fdtoverlay: { path: "/usr/bin/fdtoverlay", version: "test" },
                dtschema: { path: "/usr/bin/dt-validate", version: "test" },
              };
            },
          },
          skipSemanticGates: true,
        });
        expect(writeback.skipped).toBe(false);
        if (!writeback.skipped) {
          expect(writeback.candidateRevisionId).toBeTruthy();
          expect(writeback.bindingRevisionId).toBeTruthy();

          const stillBase = await db.query<{ raw_value: string | null }>(
            `select raw_value from project_parameter_binding_revisions
             where binding_id = $1 and config_revision_id = $2`,
            [seeded.bindingId, writeLock.baseConfigRevisionId]
          );
          expect(stillBase.rows[0]?.raw_value).toBe("<1>");

          const candidateBinding = await db.query<{
            raw_value: string | null;
            typed_value: unknown;
            canonical_value: unknown;
          }>(
            `select raw_value, typed_value, canonical_value from project_parameter_binding_revisions
             where binding_id = $1 and config_revision_id = $2`,
            [seeded.bindingId, writeback.candidateRevisionId]
          );
          const expectedTypedValue = {
            kind: "cells",
            bits: 32,
            groups: [[
              { kind: "phandle", label: "gpio13" },
              { kind: "integer", raw: "30", value: "30" },
              { kind: "integer", raw: "0", value: "0" },
            ]],
          };
          expect(candidateBinding.rows[0]?.raw_value).toBe(mergedGpioValue);
          expect(candidateBinding.rows[0]?.typed_value).toEqual(expectedTypedValue);
          expect(candidateBinding.rows[0]?.canonical_value).toEqual(expectedTypedValue);
        }

        const reloadedBinding = await db.query<{ raw_value: string | null; config_revision_id: string }>(
          `select raw_value, config_revision_id from project_parameter_binding_revisions
           where binding_id = $1
           order by created_at desc
           limit 1`,
          [seeded.bindingId]
        );
        expect(reloadedBinding.rows[0]?.raw_value).toBe(mergedGpioValue);
        if (!writeback.skipped) {
          expect(reloadedBinding.rows[0]?.config_revision_id).toBe(writeback.candidateRevisionId);
        }

        const overlayVersion = await db.query<{ parsed_index: { sourceText?: string } }>(
          `select parsed_index from project_parameter_file_versions
           where file_id = $1
           order by version_number desc
           limit 1`,
          [seeded.overlayFileId]
        );
        expect(overlayVersion.rows[0]?.parsed_index?.sourceText).toMatch(
          /gpio_int\s*=\s*<&gpio13 30 0>/,
        );
        expect(seeded.content).toContain("gpio_int = <1>;");

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
          readValue: mergedGpioValue,
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

  it(
    "returns 409 when merge lock is missing or stale",
    async () => {
      await withTempDatabase(async (db) => {
        const seeded = await seedPreCutoverGraph(db);
        const report = await migrateParameterIdentities(db, {
          mode: "apply",
          organizationId: ORG,
          ...applyGates,
          dbSnapshotId: "db-snap-pcw-stale",
          objectSnapshotId: "obj-snap-pcw-stale"
        });
        expect(report.blockers).toEqual([]);
        await applyParameterIdentityCutover(db, { migrationRunId: report.migrationRunId });
        resetParameterIdentityCutoverCache();

        const auth = makeAuth();
        const writeLock = await resolveBindingWriteLock(db, auth, { bindingId: seeded.bindingId });
        const round = await createSubmissionRound(db, {
          id: randomUUID(),
          organizationId: ORG,
          projectId: PROJECT,
          submitterUserId: USER,
          status: "submitted",
          summary: "stale merge"
        });
        const requestWithoutLock = await createChangeRequest(db, {
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
        const missingLockMerge = await mergeChangeRequest(db, {
          historyId: randomUUID(),
          organizationId: ORG,
          requestId: requestWithoutLock.id,
          actorUserId: USER
        });
        expect(missingLockMerge).toBeNull();

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
          projectParameterBindingId: seeded.bindingId,
          writeLock
        });
        await db.query(
          `update project_parameter_file_versions set checksum = 'stale-checksum' where id = $1`,
          [writeLock.sourceFileVersionId]
        );
        const staleMerge = await mergeChangeRequest(db, {
          historyId: randomUUID(),
          organizationId: ORG,
          requestId: request.id,
          actorUserId: USER
        });
        expect(staleMerge).toBeNull();
      });
    },
    120_000
  );

  it(
    "returns 409 when writeback checksum lock is stale",
    async () => {
      await withTempDatabase(async (db) => {
        const seeded = await seedPreCutoverGraph(db);
        const report = await migrateParameterIdentities(db, {
          mode: "apply",
          organizationId: ORG,
          ...applyGates,
          dbSnapshotId: "db-snap-pcw-wb-stale",
          objectSnapshotId: "obj-snap-pcw-wb-stale"
        });
        expect(report.blockers).toEqual([]);
        await applyParameterIdentityCutover(db, { migrationRunId: report.migrationRunId });
        resetParameterIdentityCutoverCache();

        const auth = makeAuth();
        const writeLock = await resolveBindingWriteLock(db, auth, { bindingId: seeded.bindingId });
        const round = await createSubmissionRound(db, {
          id: randomUUID(),
          organizationId: ORG,
          projectId: PROJECT,
          submitterUserId: USER,
          status: "submitted",
          summary: "stale writeback"
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
          projectParameterBindingId: seeded.bindingId,
          writeLock
        });
        await mergeChangeRequest(db, {
          historyId: randomUUID(),
          organizationId: ORG,
          requestId: request.id,
          actorUserId: USER
        });

        await db.query(
          `update project_parameter_file_versions set checksum = 'stale-checksum' where id = $1`,
          [writeLock.sourceFileVersionId]
        );

        const objectStore = {
          async get(key: string) {
            if (key.includes("overlay")) {
              return Buffer.from(seeded.overlayContent, "utf8");
            }
            return Buffer.from(seeded.content, "utf8");
          },
          async put(input: { bytes: Buffer }) {
            return {
              storageKey: `${ORG}/stale-writeback.dts`,
              checksumSha256: createHash("sha256").update(input.bytes).digest("hex"),
              fileSizeBytes: input.bytes.length
            };
          }
        };

        await expect(
          writebackMergedParameterValue(
            db,
            objectStore as never,
            auth,
            {
              projectId: PROJECT,
              parameterDefinitionId: seeded.specId,
              mergedValue: "<9>",
              projectParameterBindingId: seeded.bindingId,
              parameterSpecId: seeded.specId,
              changeRequestId: request.id
            },
            {
              toolchain: {
                async validate() {
                  return {
                    ok: true,
                    mode: "release" as const,
                    compiler: { dtc: "test", fdtoverlay: "test", dtschema: "test" },
                    diagnostics: [],
                    artifacts: {},
                  };
                },
                async probe() {
                  return {
                    dtc: { path: "/usr/bin/dtc", version: "test" },
                    fdtoverlay: { path: "/usr/bin/fdtoverlay", version: "test" },
                    dtschema: { path: "/usr/bin/dt-validate", version: "test" },
                  };
                },
              },
              skipSemanticGates: true,
            }
          )
        ).rejects.toMatchObject({
          code: "CONFLICT",
          status: 409
        } satisfies Partial<ApiError>);

        const persistedLock = await getChangeRequestWriteLock(db, {
          organizationId: ORG,
          requestId: request.id
        });
        expect(persistedLock?.expectedChecksum).toBe(writeLock.expectedChecksum);
      });
    },
    120_000
  );

  async function assertMergeRolledBack(db: Database, requestId: string, bindingId: string, baseRevisionId: string) {
    const status = await db.query<{ status: string }>(
      `select status from parameter_change_requests where id = $1`,
      [requestId]
    );
    expect(status.rows[0]?.status).toBe("software_merge");

    const history = await listParameterHistory(db, {
      organizationId: ORG,
      parameterId: bindingId
    });
    expect(history.filter((entry) => entry.value === "<9>")).toHaveLength(0);

    const candidate = await db.query<{ c: string }>(
      `select count(*)::text as c from project_parameter_binding_revisions
       where binding_id = $1 and raw_value = '<9>'`,
      [bindingId]
    );
    expect(Number(candidate.rows[0]?.c ?? 0)).toBe(0);

    const base = await db.query<{ raw_value: string | null }>(
      `select raw_value from project_parameter_binding_revisions
       where binding_id = $1 and config_revision_id = $2`,
      [bindingId, baseRevisionId]
    );
    expect(base.rows[0]?.raw_value).toBe("<1>");

    const audits = await db.query<{ c: string }>(
      `select count(*)::text as c from audit_events
       where organization_id = $1 and kind = 'parameter-merge' and target_id = $2`,
      [ORG, requestId]
    );
    expect(Number(audits.rows[0]?.c ?? 0)).toBe(0);
  }

  function failingToolchain(failureCode: "compile-failed" | "schema-failed" | "version-mismatch" | "toolchain-unavailable", stage: "dtc" | "fdtoverlay" | "dt-validate" | "toolchain") {
    return {
      async validate() {
        return {
          ok: false as const,
          mode: "release" as const,
          compiler: { dtc: "1.8.1", fdtoverlay: "1.8.1", dtschema: "2026.6" },
          diagnostics: [
            {
              file: "<toolchain>",
              severity: "error" as const,
              code: failureCode,
              message: `injected ${failureCode}`,
              stage
            }
          ],
          artifacts: {},
          failureCode
        };
      },
      async probe() {
        return {
          dtc: { path: "/usr/bin/dtc", version: "1.8.1" },
          fdtoverlay: { path: "/usr/bin/fdtoverlay", version: "1.8.1" },
          dtschema: { path: "/usr/bin/dt-validate", version: "2026.6" }
        };
      }
    };
  }

  it(
    "fail-closes semantic merge without objectStore and leaves software_merge",
    async () => {
      await withTempDatabase(async (db) => {
        const seeded = await seedPreCutoverGraph(db);
        const report = await migrateParameterIdentities(db, {
          mode: "apply",
          organizationId: ORG,
          ...applyGates,
          dbSnapshotId: "db-snap-pcw-fc-os",
          objectSnapshotId: "obj-snap-pcw-fc-os"
        });
        expect(report.blockers).toEqual([]);
        await applyParameterIdentityCutover(db, { migrationRunId: report.migrationRunId });
        resetParameterIdentityCutoverCache();

        const auth = makeAuth();
        const writeLock = await resolveBindingWriteLock(db, auth, { bindingId: seeded.bindingId });
        const round = await createSubmissionRound(db, {
          id: randomUUID(),
          organizationId: ORG,
          projectId: PROJECT,
          submitterUserId: USER,
          status: "submitted",
          summary: "fail-closed objectStore"
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
          projectParameterBindingId: seeded.bindingId,
          writeLock
        });

        await expect(
          reviewChange(db, auth, {
            requestId: request.id,
            decision: "advance",
            expectedVersion: 1
          })
        ).rejects.toMatchObject({
          code: "CONFLICT",
          message: expect.stringContaining("object storage")
        });

        await assertMergeRolledBack(db, request.id, seeded.bindingId, writeLock.baseConfigRevisionId);

        process.env.WISEEFF_WRITEBACK_SKIP_TOOLCHAIN = "1";
        try {
          await expect(
            reviewChange(db, auth, {
              requestId: request.id,
              decision: "advance",
              expectedVersion: 1
            })
          ).rejects.toMatchObject({
            code: "CONFLICT",
            message: expect.stringContaining("object storage")
          });
          await assertMergeRolledBack(db, request.id, seeded.bindingId, writeLock.baseConfigRevisionId);
        } finally {
          delete process.env.WISEEFF_WRITEBACK_SKIP_TOOLCHAIN;
        }

        const writebackSource = await fs.readFile(
          path.join(projectRoot, "server/modules/parameter-files/writebackService.ts"),
          "utf8"
        );
        const serviceSource = await fs.readFile(
          path.join(projectRoot, "server/modules/parameters/service.ts"),
          "utf8"
        );
        expect(writebackSource).not.toContain("WISEEFF_WRITEBACK_SKIP_TOOLCHAIN");
        expect(serviceSource).not.toContain("WISEEFF_WRITEBACK_SKIP_TOOLCHAIN");
      });
    },
    120_000
  );

  for (const caseDef of [
    { name: "dtc", failureCode: "compile-failed" as const, stage: "dtc" as const },
    { name: "fdtoverlay", failureCode: "compile-failed" as const, stage: "fdtoverlay" as const },
    { name: "dt-schema", failureCode: "schema-failed" as const, stage: "dt-validate" as const },
    { name: "version-mismatch", failureCode: "version-mismatch" as const, stage: "toolchain" as const },
    { name: "toolchain-unavailable", failureCode: "toolchain-unavailable" as const, stage: "toolchain" as const }
  ]) {
    it(
      `fail-closes semantic merge when toolchain ${caseDef.name} fails`,
      async () => {
        await withTempDatabase(async (db) => {
          const seeded = await seedPreCutoverGraph(db);
          const report = await migrateParameterIdentities(db, {
            mode: "apply",
            organizationId: ORG,
            ...applyGates,
            dbSnapshotId: `db-snap-pcw-fc-${caseDef.name}`,
            objectSnapshotId: `obj-snap-pcw-fc-${caseDef.name}`
          });
          expect(report.blockers).toEqual([]);
          await applyParameterIdentityCutover(db, { migrationRunId: report.migrationRunId });
          resetParameterIdentityCutoverCache();

          const auth = makeAuth();
          const writeLock = await resolveBindingWriteLock(db, auth, { bindingId: seeded.bindingId });
          const round = await createSubmissionRound(db, {
            id: randomUUID(),
            organizationId: ORG,
            projectId: PROJECT,
            submitterUserId: USER,
            status: "submitted",
            summary: `fail-closed ${caseDef.name}`
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
            projectParameterBindingId: seeded.bindingId,
            writeLock
          });

          const objectStore = {
            async get(key: string) {
              if (key.includes("overlay")) {
                return Buffer.from(seeded.overlayContent, "utf8");
              }
              return Buffer.from(seeded.content, "utf8");
            },
            async put(input: { bytes: Buffer }) {
              return {
                storageKey: `${ORG}/fc-${caseDef.name}.dts`,
                checksumSha256: createHash("sha256").update(input.bytes).digest("hex"),
                fileSizeBytes: input.bytes.length
              };
            }
          };

          await expect(
            reviewChange(
              db,
              auth,
              { requestId: request.id, decision: "advance", expectedVersion: 1 },
              {
                objectStore: objectStore as never,
                toolchain: failingToolchain(caseDef.failureCode, caseDef.stage) as never
              }
            )
          ).rejects.toMatchObject({
            code: "CONFLICT",
            status: 409
          });

          await assertMergeRolledBack(db, request.id, seeded.bindingId, writeLock.baseConfigRevisionId);
        });
      },
      120_000
    );
  }
});
